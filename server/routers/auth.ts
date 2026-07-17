import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import type { Request } from "express";
import {
  verifyPassword,
  verifyPasswordOrDummy,
  hashPassword,
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  checkLoginRate,
  clearLoginRate,
  acceptInvite,
  getInvitePreview,
  loadAuthState,
} from "../services/auth";

// 取用戶端 IP 供 per-IP 限流：用 Express req.ip（index.ts 已設 app.set("trust proxy", 1)）。
// 正式部署在單層反代之後，req.ip 是「反代填入的真實對端位址」，用戶端無法偽造。
// 舊版取 X-Forwarded-For 最左段——那一段完全由用戶端控制，攻擊者每次換值即可為每個請求製造
// 一個全新的 IP 鍵，讓 per-IP(30次/15分) 限流形同虛設、可從單一主機對大量帳號做密碼噴灑
// （滲透實測確認）。改用 req.ip 後，反代會把真實對端附加在信任跳點，用戶端偽造的 XFF 不被採信。
function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket?.remoteAddress ?? undefined;
}

export const authRouter = router({
  /** 目前登入狀態（未登入回 null，前端據此顯示登入頁） */
  me: publicProcedure.query(({ ctx }) => ctx.auth),

  /** 邀請預覽（不消耗 token）：落地頁填資料前先確認連結有效、要加入哪個組 */
  invitePreview: publicProcedure
    .input(z.object({ token: z.string().min(10) }))
    .query(async ({ input }) => getInvitePreview(input.token)),

  login: publicProcedure
    .input(z.object({ email: z.string().email("email 格式不對"), password: z.string().min(1, "請填密碼") }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();
      const rate = checkLoginRate(email, clientIp(ctx.req));
      if (!rate.ok) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `嘗試太多次，請約 ${rate.retryAfterMin} 分鐘後再試` });
      }
      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
      // 統一錯誤訊息且統一耗時：查無/停用帳號也跑一次等成本 bcrypt 比對，防帳號枚舉（時序側信道）
      const passwordOk = await verifyPasswordOrDummy(input.password, user?.passwordHash);
      if (!user || user.status !== "active" || !passwordOk) {
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

  /** 自助改密碼：驗舊密碼 → 換新 → 其他裝置全部登出（本裝置換發新 session 無感續用） */
  changePassword: authedProcedure
    .input(z.object({ oldPassword: z.string().min(1, "請填原密碼"), newPassword: z.string().min(8, "新密碼至少 8 碼") }))
    .mutation(async ({ ctx, input }) => {
      // 與登入同一個限流器、不同 key：被劫持的 session 也不能拿這裡暴力試出原密碼
      const rateKey = `chpw:${ctx.auth.user.email}`;
      const rate = checkLoginRate(rateKey);
      if (!rate.ok) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `嘗試太多次，請約 ${rate.retryAfterMin} 分鐘後再試` });
      }
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, ctx.auth.user.id));
      if (!user || !(await verifyPassword(input.oldPassword, user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "原密碼不正確" });
      }
      clearLoginRate(rateKey);
      // mustChangePassword 清回 false：管理員重設後的強制改密碼流程到此解除
      await db
        .update(schema.users)
        .set({ passwordHash: await hashPassword(input.newPassword), mustChangePassword: false })
        .where(eq(schema.users.id, user.id));
      // 舊 session 全部作廢（含可能外洩的），本裝置換發新的繼續用
      await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
      const token = await createSession(user.id);
      setSessionCookie(ctx.res, token);
      console.log(`[audit] changePassword：user=${user.id}`);
      return { ok: true };
    }),

  /** 邀請連結落地：設定姓名密碼 → 建帳號＋入團隊/組 → 自動登入 */
  acceptInvite: publicProcedure
    .input(z.object({ token: z.string().min(10), name: z.string().min(1, "請填姓名").max(40, "名字太長（最多 40 字）"), password: z.string().min(8, "密碼至少 8 碼") }))
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
