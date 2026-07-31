import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, publicProcedure, authedProcedure } from "../trpc";
import { uiDensitySchema } from "@shared/uiDensity";
import { db, schema } from "../db";
import type { Request } from "express";
import {
  verifyPassword,
  verifyPasswordOrDummy,
  hashPassword,
  createSession,
  destroySession,
  destroyAllUserSessions,
  renewSessionIfNeeded,
  listUserSessions,
  revokeUserSession,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  checkLoginRate,
  clearLoginRate,
  acceptInvite,
  getInvitePreview,
  loadAuthState,
  parseCookies,
} from "../services/auth";
import { authMeCapabilities } from "../services/policyEngine";
import { revokeAllUserMcpTokens } from "../services/mcpAuth";
import { assertProjectEditable } from "../services/projectAcl";
import {
  createUploadGrant,
  UPLOAD_GRANT_MAX_TTL_SEC,
  looksLikeUuid,
} from "../services/uploadGrants";
import { MAX_FILE_BYTES } from "../services/storage";
import {
  consumeRateLimits,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  RateLimitConfigurationError,
  RateLimitUnavailableError,
} from "../services/rateLimit";
import {
  breakGlassActive,
  consumeDeviceGrace,
  consumeLoginDeviceChallenge,
  deviceIdForToken,
  getDeviceToken,
  graceActive,
  listUserDevices,
  lookupDevice,
  requestLoginDeviceChallenge,
  resolveDeviceTrustMode,
  revokeDevice,
  setDeviceCookie,
  clearDeviceCookie,
  touchDevice,
  trustDevice,
} from "../services/deviceTrust";

/**
 * 裝置被動特徵（前端送）。全部選穩定欄位、且刻意不含瀏覽器/OS 版本號——
 * Chrome 每四週自動更新，含版本號等於每個月讓全公司重驗一次（見 services/deviceTrust）。
 * 全部選填：前端沒送也能運作（退回只用 User-Agent 判斷）。
 */
const deviceHintSchema = z.object({
  // 比對用（進指紋）：硬體與環境特性，換機才會變
  screen: z.string().max(24).optional(),
  tz: z.string().max(64).optional(),
  lang: z.string().max(24).optional(),
  cores: z.number().int().min(0).max(1024).optional(),
  standalone: z.boolean().optional(),
  model: z.string().max(64).optional(),
  arch: z.string().max(16).optional(),
  bitness: z.string().max(8).optional(),
  memoryGb: z.number().min(0).max(4096).optional(),
  touchPoints: z.number().int().min(0).max(64).optional(),
  // 顯示用（★不進指紋）：會隨系統／瀏覽器／驅動更新漂移
  detailOsVersion: z.string().max(32).optional(),
  detailBrowserVersion: z.string().max(32).optional(),
  detailGpu: z.string().max(120).optional(),
  detailPixelRatio: z.number().min(0).max(16).optional(),
});

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

function clientUserAgent(req: Request): string | undefined {
  const ua = req.headers["user-agent"];
  return typeof ua === "string" ? ua : undefined;
}

function sessionMetaFromReq(req: Request) {
  return { userAgent: clientUserAgent(req), ip: clientIp(req) };
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

/**
 * 登入成功的回應。
 *
 * ★把 AuthState 攤在頂層（而非包在 auth 欄位裡）是刻意的相容性選擇：
 * 加裝置驗證前，login 直接回傳 AuthState，既有用戶端（含 e2e 腳本）都讀
 * `user`／`groups` 等頂層欄位。改成巢狀會無聲打壞它們——多一個 status 欄位
 * 就能表達判別聯集，不必讓每個既有讀取端跟著改。
 */
function okLogin(auth: Awaited<ReturnType<typeof loadAuthState>>) {
  return { status: "ok" as const, ...(auth ?? {}) };
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

  /**
   * 登入。回傳是判別聯集：
   * - { status: "ok" }              → 已發 session，前端 invalidate auth.me 即可
   * - { status: "device_verification_required" } → 密碼對但這台裝置沒見過，
   *   **刻意不發 session**，前端要導到輸入驗證碼的步驟（見 auth.verifyDevice）。
   *
   * 裝置閘門放在這一層（而非每支 API）的理由見 services/deviceTrust 檔頭。
   */
  login: publicProcedure
    .input(z.object({
      email: z.string().email("email 格式不對"),
      password: z.string().min(1, "請填密碼"),
      /** 裝置被動特徵（選填，缺了就只靠 UA 判斷，功能不壞） */
      device: deviceHintSchema.optional(),
    }))
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

      const mode = resolveDeviceTrustMode();
      const meta = sessionMetaFromReq(ctx.req);

      // off：完全維持既有行為，一行都不繞路（上線預設值）
      if (mode === "off") {
        const token = await createSession(user.id, meta);
        setSessionCookie(ctx.res, token);
        return okLogin(await loadAuthState(user.id));
      }

      const deviceCtx = { userAgent: clientUserAgent(ctx.req) ?? "", hint: input.device, ip };
      const deviceToken = getDeviceToken(ctx.req, parseCookies(ctx.req));
      const lookup = await lookupDevice(user.id, deviceToken, deviceCtx);

      // 已信任裝置：直接放行（一般夥伴的日常路徑，體驗與現況相同）
      if (lookup.known) {
        await touchDevice(lookup.deviceId, deviceCtx).catch((err) =>
          console.warn("[deviceTrust] touchDevice 失敗（不影響登入）：", err instanceof Error ? err.message : err),
        );
        // 指紋漂移只提醒不封鎖：瀏覽器升級／換外接螢幕／出國都會變，
        // 拿它當封鎖條件會製造大量假警報，把人訓練成無腦輸驗證碼（見設計 §6）。
        if (lookup.fingerprintChanged) {
          console.log(`[audit] deviceTrust 指紋變動（放行）：user=${user.id} device=${lookup.deviceId}`);
        }
        const token = await createSession(user.id, { ...meta, deviceId: lookup.deviceId });
        setSessionCookie(ctx.res, token);
        // 重新簽發 cookie 讓 400 天上限滾動續期——信任本身無到期日，但瀏覽器對 cookie 有硬上限
        if (deviceToken) setDeviceCookie(ctx.res, deviceToken);
        return okLogin(await loadAuthState(user.id));
      }

      // 陌生裝置。三種免驗情形：暖身期、超管 break-glass、管理員預先授信。
      const graced = graceActive(user.deviceGraceUntil);
      const bypass =
        mode === "monitor" || breakGlassActive(user.isSuperAdmin) || graced;

      if (bypass) {
        // ★暖身期照樣「記為已信任」：這樣切到 enforce 那天，大家慣用的手機電腦都已在名單上，
        // 不會全公司同時被要求驗證（那會塞爆信箱又製造大量求助）。
        const issued = await db.transaction(async (tx) => {
          const device = await trustDevice(user.id, deviceCtx, tx);
          const session = await createSession(user.id, { ...meta, deviceId: device.deviceId }, tx);
          return { device, session };
        });
        if (graced) await consumeDeviceGrace(user.id);
        setSessionCookie(ctx.res, issued.session);
        setDeviceCookie(ctx.res, issued.device.token);
        console.log(
          `[audit] deviceTrust 新裝置自動信任（mode=${mode}${graced ? " grace" : ""}）：user=${user.id} device=${issued.device.deviceId}`,
        );
        return okLogin(await loadAuthState(user.id));
      }

      // enforce：不發 session，只發一張沒有任何 API 權限的票根，並寄驗證碼。
      const challengeRate = await guardedAuthRateLimit(() =>
        consumeRateLimits([{
          scope: RATE_LIMIT_SCOPES.deviceChallenge,
          subject: user.id,
          policy: RATE_LIMIT_POLICIES.deviceChallenge,
        }]),
      );
      if (challengeRate.some((d) => !d.allowed)) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "新裝置驗證要求太頻繁，請稍後再試（若不是你本人操作，請儘快改密碼）",
        });
      }
      const challenge = await requestLoginDeviceChallenge({ id: user.id, email: user.email }, deviceCtx);
      console.log(`[audit] deviceTrust 陌生裝置要求驗證：user=${user.id} device=${challenge.deviceLabel}`);
      return {
        status: "device_verification_required" as const,
        challengeId: challenge.challengeId,
        emailMasked: challenge.emailMasked,
        deviceLabel: challenge.deviceLabel,
        expiresInSec: challenge.expiresInSec,
      };
    }),

  /**
   * 陌生裝置：輸入信箱收到的 6 碼 → 記為已信任 → 發 session。
   * 需重新驗一次帳密：challengeId 只是票根，不是身分證明——若只憑 challengeId 就換 session，
   * 拿到票根（例如共用電腦的瀏覽器紀錄）的人配上偷聽到的驗證碼即可登入，繞過密碼。
   */
  verifyDevice: publicProcedure
    .input(z.object({
      email: z.string().email("email 格式不對"),
      password: z.string().min(1, "請填密碼"),
      challengeId: z.string().uuid("驗證票據無效"),
      code: z.string().trim().regex(/^\d{6}$/, "驗證碼是 6 個數字"),
      device: deviceHintSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const email = input.email.toLowerCase().trim();
      const ip = clientIp(ctx.req);
      const rate = await guardedAuthRateLimit(() =>
        consumeRateLimits([
          { scope: RATE_LIMIT_SCOPES.deviceVerify, subject: email, policy: RATE_LIMIT_POLICIES.deviceVerify },
          ...(ip ? [{ scope: RATE_LIMIT_SCOPES.authIp, subject: ip, policy: RATE_LIMIT_POLICIES.authIp }] : []),
        ]),
      );
      if (rate.some((d) => !d.allowed)) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "嘗試太多次，請稍後再試" });
      }
      const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email));
      const passwordOk = await verifyPasswordOrDummy(input.password, user?.passwordHash);
      if (!user || user.status !== "active" || !passwordOk) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "email 或密碼不正確" });
      }

      const deviceCtx = { userAgent: clientUserAgent(ctx.req) ?? "", hint: input.device, ip };
      // 驗碼失敗會自行丟出帶剩餘次數的訊息；成功才往下走
      await consumeLoginDeviceChallenge({
        userId: user.id,
        challengeId: input.challengeId,
        code: input.code,
        ctx: deviceCtx,
      });

      const issued = await db.transaction(async (tx) => {
        const device = await trustDevice(user.id, deviceCtx, tx);
        const session = await createSession(
          user.id,
          { ...sessionMetaFromReq(ctx.req), deviceId: device.deviceId },
          tx,
        );
        return { device, session };
      });
      setSessionCookie(ctx.res, issued.session);
      setDeviceCookie(ctx.res, issued.device.token);
      console.log(`[audit] deviceTrust 新裝置通過驗證：user=${user.id} device=${issued.device.deviceId}`);
      return okLogin(await loadAuthState(user.id));
    }),

  /** 介面密度偏好上行（P1c）：本機 localStorage 仍是即時來源，這裡只負責
   *  跨裝置帶著走——下行採用發生在登入後第一次拿到 me 時（見 AppShell）。 */
  setUiDensity: authedProcedure
    .input(z.object({ density: uiDensitySchema }))
    .mutation(async ({ ctx, input }) => {
      await db.update(schema.users).set({ uiDensity: input.density }).where(eq(schema.users.id, ctx.auth.user.id));
      return { ok: true as const };
    }),

  logout: authedProcedure.mutation(async ({ ctx }) => {
    const token = getSessionToken(ctx.req);
    if (token) await destroySession(token);
    clearSessionCookie(ctx.res);
    return { ok: true };
  }),

  /**
   * 登出全部裝置：刪該使用者所有 sessions，本裝置立即換發新 session 無感續用。
   * 刻意不撤銷 MCP 金鑰（避免誤傷自動化／外部工具）；改密碼仍會撤 MCP。
   */
  logoutAll: authedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.auth.user.id;
    await destroyAllUserSessions(userId);
    // 沿用裝置歸屬：新 session 若不帶 deviceId，之後「移除這台裝置」就踢不掉它了
    const deviceId = await deviceIdForToken(userId, getDeviceToken(ctx.req, parseCookies(ctx.req)));
    const token = await createSession(userId, { ...sessionMetaFromReq(ctx.req), deviceId });
    setSessionCookie(ctx.res, token);
    console.log(`[audit] logoutAll：user=${userId}`);
    return { ok: true };
  }),

  /**
   * Session 滑動續期：活躍使用者在剩餘 < 7 天時延長至 30 天並刷新 cookie Max-Age。
   * 由前端 AppShell 節流呼叫（掛載／visibility + 本地 6h 上限），避免每請求寫 DB。
   * 未進入續期窗時：僅節流更新 lastSeenAt（>1h）；其餘不寫庫。
   */
  touchSession: authedProcedure.mutation(async ({ ctx }) => {
    const token = getSessionToken(ctx.req);
    if (!token) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "尚未登入" });
    }
    const result = await renewSessionIfNeeded(token);
    if (!result) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "工作階段已失效，請重新登入" });
    }
    if (result.renewed) {
      setSessionCookie(ctx.res, token);
    }
    return { ok: true as const, renewed: result.renewed, expiresAt: result.expiresAt };
  }),

  /**
   * AUTH-02：目前帳號的有效登入裝置列表（不含 ipHash）。
   * isCurrent 標示本 cookie 對應的那一筆。
   */
  listSessions: authedProcedure.query(async ({ ctx }) => {
    const token = getSessionToken(ctx.req);
    return listUserSessions(ctx.auth.user.id, token);
  }),

  /**
   * AUTH-02：撤銷單筆 session。撤銷本機時等同登出（清 cookie）。
   * 不可撤銷他人 session（以 userId 範圍限定）。
   */
  revokeSession: authedProcedure
    .input(z.object({ id: z.string().uuid("工作階段 id 無效") }))
    .mutation(async ({ ctx, input }) => {
      const token = getSessionToken(ctx.req);
      const result = await revokeUserSession(ctx.auth.user.id, input.id, token);
      if (result === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個登入工作階段（可能已過期或已撤銷）" });
      }
      if (result === "current") {
        clearSessionCookie(ctx.res);
        console.log(`[audit] revokeSession current：user=${ctx.auth.user.id}`);
        return { ok: true as const, self: true };
      }
      console.log(`[audit] revokeSession：user=${ctx.auth.user.id} session=${input.id}`);
      return { ok: true as const, self: false };
    }),

  /**
   * 「我的裝置」清單：已通過信箱驗證、可直接登入的手機／電腦。
   * 永不回傳裝置憑證雜湊、IP 雜湊或特徵雜湊。
   */
  listDevices: authedProcedure.query(async ({ ctx }) => {
    const deviceToken = getDeviceToken(ctx.req, parseCookies(ctx.req));
    return {
      mode: resolveDeviceTrustMode(),
      devices: await listUserDevices(ctx.auth.user.id, deviceToken),
    };
  }),

  /**
   * 移除一台已信任裝置。信任是「永久直到手動移除」，所以這支是唯一的解除信任途徑，
   * 且會連帶登出該裝置（否則移除只影響下次登入，那台現在還開著的照樣能用）。
   */
  revokeDevice: authedProcedure
    .input(z.object({ id: z.string().uuid("裝置 id 無效") }))
    .mutation(async ({ ctx, input }) => {
      const deviceToken = getDeviceToken(ctx.req, parseCookies(ctx.req));
      const result = await revokeDevice(ctx.auth.user.id, input.id, deviceToken);
      if (result === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到這台裝置（可能已經移除了）" });
      }
      console.log(`[audit] revokeDevice：user=${ctx.auth.user.id} device=${input.id} self=${result === "revoked_current"}`);
      if (result === "revoked_current") {
        // 移除的是自己這台：連 session 都被刪了，清掉兩個 cookie 讓前端回到登入頁
        clearSessionCookie(ctx.res);
        clearDeviceCookie(ctx.res);
        return { ok: true as const, self: true };
      }
      return { ok: true as const, self: false };
    }),

  /**
   * AUTH-03：簽發單次上傳授權（桌面 handoff／長時間上傳可與 cookie 解耦）。
   * 回傳 token 僅此一次（前綴 aidup_）；之後只存雜湊。
   * 上傳時以 Authorization: Bearer aidup_… 或既有 session cookie。
   */
  createUploadGrant: authedProcedure
    .input(z.object({
      projectId: z.string().uuid("專案 id 無效"),
      sourceAssetId: z.string().uuid("來源素材 id 無效").optional(),
      handoffId: z.string().trim().min(1).max(120).optional(),
      /** 秒；預設 24h，上限 7 天，下限 60 秒 */
      ttlSeconds: z.number().int().min(60).max(UPLOAD_GRANT_MAX_TTL_SEC).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      }
      if (!ctx.auth.groups.some((g) => g.groupId === project.groupId)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "你不屬於這個組" });
      }
      try {
        await assertProjectEditable(ctx.auth, project);
      } catch {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "你在此專案是「檢視者」（唯讀）——無法簽發上傳授權",
        });
      }
      if (input.sourceAssetId) {
        if (!looksLikeUuid(input.sourceAssetId)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "來源素材 id 無效" });
        }
        const [src] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.sourceAssetId));
        if (!src || src.projectId !== project.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "來源素材不在此專案" });
        }
      }
      const grant = await createUploadGrant({
        userId: ctx.auth.user.id,
        projectId: project.id,
        groupId: project.groupId,
        sourceAssetId: input.sourceAssetId ?? null,
        handoffId: input.handoffId ?? null,
        maxBytes: MAX_FILE_BYTES,
        ttlSeconds: input.ttlSeconds,
      });
      // 不把 token 原文寫進 log
      console.log(
        `[audit] createUploadGrant：user=${ctx.auth.user.id} project=${project.id} grant=${grant.id}`,
      );
      return {
        id: grant.id,
        token: grant.token,
        expiresAt: grant.expiresAt,
        maxBytes: grant.maxBytes,
        projectId: grant.projectId,
      };
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
      // 沿用裝置歸屬（本裝置本來就已通過驗證，改密碼不需重驗；但要保留 deviceId 才踢得掉）
      const deviceId = await deviceIdForToken(user.id, getDeviceToken(ctx.req, parseCookies(ctx.req)));
      const token = await createSession(user.id, { ...sessionMetaFromReq(ctx.req), deviceId });
      setSessionCookie(ctx.res, token);
      console.log(`[audit] changePassword：user=${user.id}`);
      return { ok: true };
    }),

  /** 邀請連結落地：設定姓名密碼 → 建帳號＋入團隊/組 → 自動登入 */
  acceptInvite: publicProcedure
    // name 先 trim 再驗 min——否則 "   " 會通過 min(1) 建出空白顯示名
    .input(z.object({
      token: z.string().min(10),
      name: z.string().trim().min(1, "請填姓名").max(40, "名字太長（最多 40 字）"),
      password: z.string().min(8, "密碼至少 8 碼"),
      device: deviceHintSchema.optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { userId } = await acceptInvite(input.token, input.name, input.password);
        // 落地即信任這台裝置：邀請 token 本來就寄到本人信箱，能兌換＝已證明持有該信箱，
        // 與陌生裝置驗證碼是同一種證明。不這樣做的話新人建完帳號會立刻被要求再驗一次信箱。
        const deviceCtx = { userAgent: clientUserAgent(ctx.req) ?? "", hint: input.device, ip: clientIp(ctx.req) };
        const issued = await db.transaction(async (tx) => {
          const device = await trustDevice(userId, deviceCtx, tx);
          const session = await createSession(
            userId,
            { ...sessionMetaFromReq(ctx.req), deviceId: device.deviceId },
            tx,
          );
          return { device, session };
        });
        setSessionCookie(ctx.res, issued.session);
        setDeviceCookie(ctx.res, issued.device.token);
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
