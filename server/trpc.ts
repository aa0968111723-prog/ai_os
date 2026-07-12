import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Request, Response } from "express";
import { resolveSession, loadAuthState, type AuthState } from "./services/auth";
import { db, schema } from "./db";
import { eq } from "drizzle-orm";
import { SEED_ADMIN_EMAIL } from "./services/seed";

export interface Context {
  auth: AuthState | null;
  req: Request;
  res: Response;
}

export async function createContext({ req, res }: CreateExpressContextOptions): Promise<Context> {
  // AUTH_MODE=dev：跳過登入、以種子超管身分運作（開發測功能不卡登入）。
  // 安全鎖：正式環境「絕不」允許此後門生效——否則單一環境變數即造成全站無認證、人人超管。
  if (process.env.AUTH_MODE === "dev" && process.env.NODE_ENV !== "production") {
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, SEED_ADMIN_EMAIL));
    const auth = admin ? await loadAuthState(admin.id) : null;
    return { auth, req, res };
  }
  const auth = await resolveSession(req);
  return { auth, req, res };
}

const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    // 內部錯誤（如 SQL）不外洩到前台——細節進伺服器 log，畫面給友善訊息
    if (error.code === "INTERNAL_SERVER_ERROR") {
      console.error("[trpc]", error.cause ?? error);
      return { ...shape, message: "系統暫時無法處理，請稍後再試（管理員可到 /api/ready 檢查資料庫連線）" };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** 需登入 */
export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.auth) throw new TRPCError({ code: "UNAUTHORIZED", message: "請先登入" });
  return next({ ctx: { ...ctx, auth: ctx.auth } });
});

/** 需任一團隊管理權（或超管） */
export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (!ctx.auth.user.isSuperAdmin && ctx.auth.adminTeamIds.length === 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要團隊管理權限" });
  }
  return next({ ctx });
});

/** 組存取守衛：回傳使用者在該組的角色，無權限直接擋（多組隔離的核心） */
export function requireGroup(auth: AuthState, groupId: string): "admin" | "leader" | "member" {
  const membership = auth.groups.find((g) => g.groupId === groupId);
  if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "你不屬於這個組" });
  return membership.role;
}

/** 組長以上（審批用） */
export function requireLeader(auth: AuthState, groupId: string): void {
  const role = requireGroup(auth, groupId);
  if (role === "member") throw new TRPCError({ code: "FORBIDDEN", message: "需要組長權限" });
}
