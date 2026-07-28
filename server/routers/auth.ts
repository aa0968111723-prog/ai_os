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
import { authMeCapabilities } from "../services/policyEngine";
import { revokeAllUserMcpTokens } from "../services/mcpAuth";
import {
  RateLimitConfigurationError,
  RateLimitUnavailableError,
} from "../services/rateLimit";

// 取用戶端 IP 供 per-IP 限流。★安全：一律走 Express 的 req.ip。
// index.ts 已設 `app.set("trust proxy", 1)`，Express 會信任「最靠近本機的 1 層反代」並取
// X-Forwarded-For 中由該可信反代附加的那一段＝真實 client IP（見 mcp.ts 的失敗鎖定同口徑）。
// 舊版自行解析 XFF「最左段」是攻擊者可控值：平台反代會把真實 IP「附加在右側」，故
//   `X-Forwarded-For: 1.2.3.4`（偽造）到站後變成 `1.2.3.4, <真實IP>`，取最左＝拿到攻擊者
// 自選的 1.2.3.4，等於每次請求都換一個「新 IP」，per-IP 滑動視窗（30 次/15 分）永遠不觸發，
// 撞庫防線形同虛設；反之鎖定某受害 IP 也能惡意灌爆其額度做定向 DoS。改用 req.ip 杜絕此類偽造。
function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket?.remoteAddress ?? undefined;
}

async function guardedAuthRateLimit<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof RateLimitUnavailableError || error instanceof RateLimitConfigurationError) {
      console.error(`[auth] PostgreSQL 限流不可用（拒絕認證）：${error.name}: ${error.message}`);
      throw new TRPCError({
        code: "SERVICE_UNAVAILABLE",
        message: "登入安全檢查暫時無法使用，請稍後再試",
      });
    }
    throw error;
  }
}

export const authRouter = router({
  /**
   * 目前登入狀態（未登入回 null，前端據此顯示登入頁）。
   * 登入時附 capabilitiesByGroupId／capabilities，供 UI 依 Policy Engine 真相來源導覽，
   * 不再自行拼 isAdmin||isLeader（TD-05a）。既有 user／groups／adminTeamIds 仍完整回傳。
   */
  me: publicProcedure.query(({ ctx }) => {
    if (!ctx.auth) return null;
    return { ...ctx.auth, ...authMeCapabilities(ctx.auth) };
  }),

  /** 邀請預覽（不消耗 token）：落地頁填資料前先確認連結有效、要加入哪個組 */
  invitePreview: publicProcedure
    .input(z.object({ token: z.string().min(10) }))
    .query(async ({ input }) => getInvitePreview(input.token)),

  login: publicProcedure
    .input(z.object({ email: z.string().email("email 格式不對"), password: z.string().min(1, "請填密碼") }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();
      const ip = clientIp(ctx.req);
      const rate = await guardedAuthRateLimit(() => checkLoginRate(email, ip));
      if (!rate.ok) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `嘗試太多次，請約 ${rate.retryAfterMin} 分鐘後再試` });
      }
      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
      // 統一錯誤訊息且統一耗時：查無/停用帳號也跑一次等成本 bcrypt 比對，防帳號枚舉（時序側信道）
      const passwordOk = await verifyPasswordOrDummy(input.password, user?.passwordHash);
      if (!user || user.status !== "active" || !passwordOk) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "email 或密碼不正確" });
      }
      // 帶 IP 回收：成功登入時把 checkLoginRate 剛記下的那筆 per-IP 命中 pop 掉，維持「失敗才累積、
      // 成功不計入 per-IP 撞庫計數」——否則共用出口 IP（同辦公室/NAT）的小團隊正常登入也會把自己鎖死。
      await guardedAuthRateLimit(() => clearLoginRate(email, ip));
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
      const rate = await guardedAuthRateLimit(() => checkLoginRate(rateKey));
      if (!rate.ok) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: `嘗試太多次，請約 ${rate.retryAfterMin} 分鐘後再試` });
      }
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, ctx.auth.user.id));
      if (!user || !(await verifyPassword(input.oldPassword, user.passwordHash))) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "原密碼不正確" });
      }
      await guardedAuthRateLimit(() => clearLoginRate(rateKey));
      // bcrypt 放在交易外計算，避免昂貴 CPU 工作長時間佔住 DB 連線；真正的憑證輪替則必須原子提交。
      // 若 update／session 刪除／MCP 撤銷任一步失敗，整筆 rollback，不能留下「新密碼已生效但舊
      // session 或 token 仍可用」的混合安全狀態。
      const passwordHash = await hashPassword(input.newPassword);
      const revokedTokens = await db.transaction(async (tx) => {
        await tx
          .update(schema.users)
          .set({ passwordHash, mustChangePassword: false })
          .where(eq(schema.users.id, user.id));
        await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
        return revokeAllUserMcpTokens(user.id, tx);
      });
      if (revokedTokens > 0) console.log(`[audit] changePassword 一併撤銷 ${revokedTokens} 把 MCP 金鑰：user=${user.id}`);
      // 新 session 在安全輪替 commit 後建立；若這一步罕見失敗，使用者只會被登出，可用新密碼重登，
      // 不會把舊憑證復活或形成繞過窗口。
      const token = await createSession(user.id);
      setSessionCookie(ctx.res, token);
      console.log(`[audit] changePassword：user=${user.id}`);
      return { ok: true };
    }),

  /** 邀請連結落地：設定姓名密碼 → 建帳號＋入團隊/組 → 自動登入 */
  acceptInvite: publicProcedure
    // name 先 trim 再驗 min——否則 "   " 會通過 min(1) 建出空白顯示名
    .input(z.object({ token: z.string().min(10), name: z.string().trim().min(1, "請填姓名").max(40, "名字太長（最多 40 字）"), password: z.string().min(8, "密碼至少 8 碼") }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId } = await acceptInvite(input.token, input.name, input.password);
        const token = await createSession(userId);
        setSessionCookie(ctx.res, token);
        return loadAuthState(userId);
      } catch (err) {
        // 只放行 acceptInvite service 明確 throw 的中文 Error；DB/SQL 內部錯一律吞成泛用訊息，不外洩。
        if (err instanceof TRPCError) throw err;
        const msg = err instanceof Error ? err.message : "";
        if (isSafeAcceptInviteMessage(msg)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: msg });
        }
        console.error("[auth] acceptInvite unexpected error:", err instanceof Error ? err.message : err);
        throw new TRPCError({ code: "BAD_REQUEST", message: "邀請處理失敗，請稍後再試" });
      }
    }),
});

/**
 * acceptInvite service 已知的安全中文錯誤（見 server/services/auth.ts）。
 * 允許全文對齊＋前綴兜底；未知英文/SQL 絕不外洩。
 */
function isSafeAcceptInviteMessage(msg: string): boolean {
  if (!msg) return false;
  const knownExact = new Set([
    "邀請連結無效或已過期",
    "這個 email 已經有帳號了，請直接用原本的密碼登入；要加入新團隊時，請登入後由管理員把你加入。",
    "這個 email 已經有帳號了，請直接用原本的密碼登入。",
  ]);
  if (knownExact.has(msg)) return true;
  return msg.startsWith("邀請連結無效") || msg.startsWith("這個 email 已經有帳號了");
}
