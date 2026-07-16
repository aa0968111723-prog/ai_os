import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { ZodError } from "zod";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { Request, Response } from "express";
import { resolveSession, loadAuthState, type AuthState } from "./services/auth";
import { isBootReady } from "./services/boot";
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
    // 輸入驗證失敗時，預設 message 是整包 issues 的 JSON——改給第一條的人話訊息
    if (error.cause instanceof ZodError) {
      return { ...shape, message: error.cause.issues[0]?.message ?? shape.message };
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** 強制改密碼期間仍放行的 procedure（點記法完整路徑）；auth.me 是 publicProcedure 本不經此關，列入是保險 */
const MUST_CHANGE_PW_ALLOWED = ["auth.changePassword", "auth.me", "auth.logout"];

/** 需登入 */
export const authedProcedure = t.procedure.use(async ({ ctx, path, type, next, getRawInput }) => {
  // 開機初始化（建表/種子）完成前，回可理解的訊息而不是 relation does not exist 500
  if (!isBootReady()) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "系統正在初始化（約一分鐘內完成），請稍候重試" });
  }
  if (!ctx.auth) throw new TRPCError({ code: "UNAUTHORIZED", message: "請先登入" });
  // 強制改密碼閘門：前端對話框擋不住直接打 API 的請求，後端也要擋
  if (ctx.auth.user.mustChangePassword && !MUST_CHANGE_PW_ALLOWED.includes(path)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "管理員重設了你的密碼——請先在頁面上設定新密碼再繼續使用" });
  }
  const auth = ctx.auth;
  const result = await next({ ctx: { ...ctx, auth } });
  // 審計（需求 2.2）：所有登入後 mutation 集中記錄——成功與失敗都記（失敗含錯誤訊息）。
  // 放在 next() 之後：只記「真的執行過」的呼叫；query 不記（唯讀且量大）。
  // getRawInput 是驗證前的原始輸入——sanitizeAuditInput 會脫敏截斷，壞輸入也記得下來。
  if (type === "mutation") {
    const raw = await getRawInput().catch(() => undefined);
    const { recordAudit } = await import("./services/audit");
    recordAudit(auth, path, raw, {
      ok: result.ok,
      error: result.ok ? undefined : (result.error instanceof Error ? result.error.message : String(result.error)),
    });
  }
  return result;
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
