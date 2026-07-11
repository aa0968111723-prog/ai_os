import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import {
  verifyPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  checkLoginRate,
  clearLoginRate,
  acceptInvite,
  loadAuthState,
} from "../services/auth";

export const authRouter = router({
  /** 目前登入狀態（未登入回 null，前端據此顯示登入頁） */
  me: publicProcedure.query(({ ctx }) => ctx.auth),

  login: publicProcedure
    .input(z.object({ email: z.string().email("email 格式不對"), password: z.string().min(1, "請填密碼") }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();
      if (!checkLoginRate(email)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "嘗試太多次，請 15 分鐘後再試" });
      }
      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
      // 統一錯誤訊息：不洩漏帳號是否存在
      if (!user || user.status !== "active" || !(await verifyPassword(input.password, user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "email 或密碼不正確" });
      }
      clearLoginRate(email);
      const token = await createSession(user.id);
      setSessionCookie(ctx.res, token);
      return loadAuthState(user.id);
    }),

  logout: authedProcedure.mutation(async ({ ctx }) => {
    const token = getSessionToken(ctx.req);
    if (token) await destroySession(token);
    clearSessionCookie(ctx.res);
    return { ok: true };
  }),

  /** 邀請連結落地：設定姓名密碼 → 建帳號＋入團隊/組 → 自動登入 */
  acceptInvite: publicProcedure
    .input(z.object({ token: z.string().min(10), name: z.string().min(1, "請填姓名"), password: z.string().min(8, "密碼至少 8 碼") }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId } = await acceptInvite(input.token, input.name.trim(), input.password);
        const token = await createSession(userId);
        setSessionCookie(ctx.res, token);
        return loadAuthState(userId);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "邀請無效" });
      }
    }),
});
