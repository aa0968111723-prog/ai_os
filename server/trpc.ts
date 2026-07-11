import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { getDevUser, type DevUser } from "./services/seed";

export interface Context {
  user: DevUser;
}

export async function createContext(_opts: CreateExpressContextOptions): Promise<Context> {
  // 開發模式假身分（定案：登入系統最後做，先測功能）
  const user = await getDevUser();
  return { user };
}

const t = initTRPC.context<Context>().create({ transformer: superjson });

export const router = t.router;
export const publicProcedure = t.procedure;

export const memberProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx });
});

export const leaderProcedure = t.procedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "leader" && ctx.user.role !== "admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要組長權限" });
  }
  return next({ ctx });
});
