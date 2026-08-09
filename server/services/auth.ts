/**
 * 認證核心：bcrypt 密碼、session cookie、邀請制、登入防爆破。
 * 設計依據：docs/auth-design.md（任務卡 #002）
 */
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Request, Response } from "express";
import { db, schema } from "../db";
import {
  consumeRateLimits,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  settleRateLimits,
} from "./rateLimit";
import { publicAvatarUrl } from "./userAvatar";

// pg 唯一鍵衝突（23505）：驅動可能把原始錯誤包在 cause，兩層 code 與訊息都檢查。
// 在地實作（不從 generationCore 匯入）——auth.ts 於 tRPC context 建立時極早載入，
// 匯入 generationCore 會把整個生成／路由圖一併拉進來造成初始化循環（authedProcedure 尚未就緒）。
function isUniqueViolation(err: unknown): boolean {
  const codes = [(err as { code?: unknown } | null)?.code, (err as { cause?: { code?: unknown } } | null)?.cause?.code];
  if (codes.includes("23505")) return true;
  return err instanceof Error && err.message.includes("duplicate key");
}

/** Absolute session lifetime after mint / sliding renew (days). */
export const SESSION_DAYS = 30;
/** Renew when remaining lifetime falls below this (days). */
export const SESSION_SLIDE_REMAINING_DAYS = 7;
const COOKIE_NAME = "aidos_session";
const SESSION_MS = SESSION_DAYS * 86_400_000;
const SLIDE_REMAINING_MS = SESSION_SLIDE_REMAINING_DAYS * 86_400_000;

/* ── 密碼 ── */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// 帳號枚舉防護用：模組載入時預算一個永不匹配的 dummy hash（cost 與真 hash 相同）。
// 帳號不存在／停用時仍跑一次等成本的 bcrypt.compare，讓「帳號是否存在」無法由回應耗時推斷。
const DUMMY_PASSWORD_HASH = bcrypt.hashSync("account-enumeration-timing-guard", 10);

/**
 * 登入專用密碼比對：帳號存在就比對真 hash；查無帳號（hash 為 null/undefined）時
 * 改比對 dummy hash，耗時與真比對一致但必回 false。呼叫端仍要自行檢查帳號存在與狀態。
 */
export async function verifyPasswordOrDummy(plain: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    await bcrypt.compare(plain, DUMMY_PASSWORD_HASH);
    return false;
  }
  return bcrypt.compare(plain, hash);
}

/* ── 登入防爆破：PostgreSQL 滑動視窗，跨 replica／重啟持久 ── */
// ip 選填：僅 login 傳入（changePassword 等已登入情境沿用單一 email/自訂 key 限流）。
// subject 只在本行程短暫存在；rateLimit 會先以含 scope 的 HMAC-SHA-256 轉成 key，DB 不存 email/IP。
export async function checkLoginRate(
  email: string,
  ip?: string,
): Promise<{ ok: boolean; retryAfterMin?: number }> {
  const requests = [
    { scope: RATE_LIMIT_SCOPES.authEmail, subject: email, policy: RATE_LIMIT_POLICIES.authEmail },
    ...(ip ? [{ scope: RATE_LIMIT_SCOPES.authIp, subject: ip, policy: RATE_LIMIT_POLICIES.authIp }] : []),
  ];
  const decisions = await consumeRateLimits(requests);
  const retryAfterMs = decisions.reduce(
    (max, decision) => decision.allowed ? max : Math.max(max, decision.retryAfterMs),
    0,
  );
  return retryAfterMs > 0
    ? { ok: false, retryAfterMin: Math.max(1, Math.ceil(retryAfterMs / 60_000)) }
    : { ok: true };
}

export async function clearLoginRate(email: string, ip?: string): Promise<void> {
  await settleRateLimits([
    // 成功登入清除自己的帳號失敗視窗。
    { scope: RATE_LIMIT_SCOPES.authEmail, subject: email, action: "clear" },
    // IP 是多人共用出口時不能整桶清除；只回收本次成功登入在 checkLoginRate 記下的一格。
    ...(ip ? [{ scope: RATE_LIMIT_SCOPES.authIp, subject: ip, action: "release-latest" as const }] : []),
  ]);
}

/* ── Session ── */
// 匯出供邀請 token 與 index.ts 自檢共用：DB 一律存雜湊、原文只回給呼叫端組連結
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Throttle for lastSeenAt / sliding touch writes (AUTH-02 shares with AUTH-01). */
export const SESSION_TOUCH_MIN_MS = 3600_000;
const UA_MAX = 240;

export type SessionCreateMeta = {
  userAgent?: string | null;
  ip?: string | null;
  /**
   * 簽發這筆 session 的已信任裝置（user_devices.id）。裝置信任關閉或既有流程未帶時為 null。
   * 有值時「移除裝置」會連帶刪掉這筆 session（見 services/deviceTrust.revokeDevice）。
   */
  deviceId?: string | null;
};

/** Truncate UA for storage (max 240). Empty → null. */
export function truncateUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const t = ua.trim();
  if (!t) return null;
  return t.length > UA_MAX ? t.slice(0, UA_MAX) : t;
}

/**
 * Hash client IP for session meta. Never store raw IP.
 * Pepper: SESSION_IP_PEPPER || RATE_LIMIT_SECRET || dev fallback (non-production only).
 */
export function hashSessionIp(
  ip: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;
  const pepper =
    env.SESSION_IP_PEPPER?.trim() ||
    env.RATE_LIMIT_SECRET?.trim() ||
    (env.NODE_ENV === "production" ? "" : "dev-session-ip-pepper");
  if (!pepper) {
    // Production without pepper: refuse to store anything rather than reversible hash
    return null;
  }
  return sha256(`${trimmed}|${pepper}`);
}

export async function createSession(
  userId: string,
  meta?: SessionCreateMeta,
  /**
   * 交易控制代碼（結構化型別，比照 revokeAllUserMcpTokens 慣例）：
   * 裝置信任要「記裝置＋發 session」原子完成，不可留下「裝置記了但 session 沒發」的半套狀態。
   */
  exec: { insert: typeof db.insert } = db,
): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = nextSessionExpiry();
  const now = new Date();
  await exec.insert(schema.sessions).values({
    tokenHash: sha256(token),
    userId,
    expiresAt,
    lastSeenAt: now,
    userAgent: truncateUserAgent(meta?.userAgent),
    ipHash: hashSessionIp(meta?.ip),
    deviceId: meta?.deviceId ?? null,
  });
  return token;
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
}

/** Revoke every session for a user (other devices + current). Caller re-mints if current device should stay signed in. */
export async function destroyAllUserSessions(userId: string): Promise<number> {
  const deleted = await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.userId, userId))
    .returning({ id: schema.sessions.id });
  return deleted.length;
}

/** Pure: whether `expiresAt` is inside the sliding renew window. */
export function shouldRenewSession(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() - now.getTime() < SLIDE_REMAINING_MS;
}

export function nextSessionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + SESSION_MS);
}

/** Pure: whether lastSeenAt is stale enough to warrant a DB touch write. */
export function shouldTouchLastSeen(lastSeenAt: Date | null | undefined, now: Date = new Date()): boolean {
  if (!lastSeenAt) return true;
  return now.getTime() - lastSeenAt.getTime() >= SESSION_TOUCH_MIN_MS;
}

export type SessionListItem = {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  lastSeenAt: Date | null;
  userAgent: string | null;
  isCurrent: boolean;
};

/** List active (non-expired) sessions for a user. Never returns ipHash. */
export async function listUserSessions(
  userId: string,
  currentToken: string | undefined,
  now: Date = new Date(),
): Promise<SessionListItem[]> {
  const rows = await db
    .select({
      id: schema.sessions.id,
      tokenHash: schema.sessions.tokenHash,
      createdAt: schema.sessions.createdAt,
      expiresAt: schema.sessions.expiresAt,
      lastSeenAt: schema.sessions.lastSeenAt,
      userAgent: schema.sessions.userAgent,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), gt(schema.sessions.expiresAt, now)));
  const currentHash = currentToken ? sha256(currentToken) : null;
  return rows
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      lastSeenAt: r.lastSeenAt ?? null,
      userAgent: r.userAgent ?? null,
      isCurrent: currentHash != null && r.tokenHash === currentHash,
    }))
    .sort((a, b) => {
      // Current first, then most recently seen
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      const aT = (a.lastSeenAt ?? a.createdAt).getTime();
      const bT = (b.lastSeenAt ?? b.createdAt).getTime();
      return bT - aT;
    });
}

/**
 * Revoke one session by id for the owning user.
 * Returns: "revoked" | "not_found" | "current" (caller may treat current as logout).
 */
export async function revokeUserSession(
  userId: string,
  sessionId: string,
  currentToken: string | undefined,
): Promise<"revoked" | "not_found" | "current"> {
  const [row] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.id, sessionId), eq(schema.sessions.userId, userId)));
  if (!row) return "not_found";
  const isCurrent = currentToken != null && row.tokenHash === sha256(currentToken);
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  return isCurrent ? "current" : "revoked";
}

/**
 * Sliding session renew for an existing cookie token.
 * - When remaining < 7d: bump expiresAt + lastSeenAt (renewed=true).
 * - Else if lastSeen stale (>1h): only bump lastSeenAt (renewed=false, still a write).
 * - Else: no DB write.
 */
export async function renewSessionIfNeeded(
  token: string,
  now: Date = new Date(),
): Promise<{ renewed: boolean; expiresAt: Date } | null> {
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, now)));
  if (!session) return null;

  const renew = shouldRenewSession(session.expiresAt, now);
  if (renew) {
    const expiresAt = nextSessionExpiry(now);
    await db
      .update(schema.sessions)
      .set({ expiresAt, lastSeenAt: now })
      .where(eq(schema.sessions.id, session.id));
    return { renewed: true, expiresAt };
  }

  if (shouldTouchLastSeen(session.lastSeenAt, now)) {
    await db
      .update(schema.sessions)
      .set({ lastSeenAt: now })
      .where(eq(schema.sessions.id, session.id));
  }
  return { renewed: false, expiresAt: session.expiresAt };
}

export function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const raw = part.slice(idx + 1).trim();
      // 畸形值（如落單的 %）會讓 decodeURIComponent 丟 URIError，若不接會讓整個 createContext 500、
      // 該瀏覽器所有 API 全掛。解碼失敗就沿用原字串（session token 為 hex、本就無需解碼）。
      try { out[key] = decodeURIComponent(raw); } catch { out[key] = raw; }
    }
  }
  return out;
}

// ★用 res.append 不用 res.setHeader：裝置綁定（services/deviceTrust）會在同一個回應裡
// 再設一個 aidos_device cookie，而 setHeader 會覆寫整個 Set-Cookie 標頭——先設裝置再設
// session 會把裝置 cookie 洗掉（下次登入又被當陌生裝置），反之亦然。append 疊加後兩者
// 並存且與呼叫順序無關。每條回應路徑最多設一次 session cookie，故對既有行為無影響。
export function setSessionCookie(res: Response, token: string): void {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}${secure}`,
  );
}

export function clearSessionCookie(res: Response): void {
  // #269：production 必須帶 Secure，否則瀏覽器可能保留舊 cookie（與 setSessionCookie 對稱）
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export function getSessionToken(req: Request): string | undefined {
  return parseCookies(req)[COOKIE_NAME];
}

/* ── 目前使用者＋成員關係（每請求重查 → 移出即失效） ── */
export interface AuthState {
  /** mustChangePassword：管理員重設密碼後為 true，前端據此強制顯示改密碼對話框 */
  user: {
    id: string;
    name: string;
    email: string;
    isSuperAdmin: boolean;
    mustChangePassword: boolean;
    avatarUrl?: string | null;
  };
  /** 可用組（含角色）：直接組員＋團隊管理展開＋開發者展開全部 */
  groups: Array<{ groupId: string; groupName: string; teamId: string; teamName: string; role: "admin" | "leader" | "member" }>;
  /** 有團隊管理權的團隊 id */
  adminTeamIds: string[];
}

/**
 * Development-only authentication bypass shared by tRPC and ordinary HTTP routes.
 * Production always ignores AUTH_MODE=dev, even when the variable was left behind.
 */
export function isDevAuthBypassEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AUTH_MODE === "dev" && env.NODE_ENV !== "production";
}

export async function loadAuthState(userId: string): Promise<AuthState | null> {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || user.status !== "active") return null;

  const allTeams = await db.select().from(schema.teams);
  const allGroups = await db.select().from(schema.groups);
  const teamName = (id: string) => allTeams.find((t) => t.id === id)?.name ?? "";

  const teamRows = await db.select().from(schema.teamMembers).where(eq(schema.teamMembers.userId, userId));
  const adminTeamIds = user.isSuperAdmin ? allTeams.map((t) => t.id) : teamRows.filter((r) => r.role === "admin").map((r) => r.teamId);

  const groupRows = await db.select().from(schema.groupMembers).where(eq(schema.groupMembers.userId, userId));
  const map = new Map<string, AuthState["groups"][number]>();

  // 直接組員身分
  for (const row of groupRows) {
    const group = allGroups.find((g) => g.id === row.groupId);
    if (!group) continue;
    map.set(group.id, { groupId: group.id, groupName: group.name, teamId: group.teamId, teamName: teamName(group.teamId), role: row.role });
  }
  // 團隊管理（含開發者）→ 該團隊所有組以 admin 身分展開
  for (const group of allGroups) {
    if (adminTeamIds.includes(group.teamId)) {
      map.set(group.id, { groupId: group.id, groupName: group.name, teamId: group.teamId, teamName: teamName(group.teamId), role: "admin" });
    }
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      isSuperAdmin: user.isSuperAdmin,
      mustChangePassword: user.mustChangePassword,
      avatarUrl: publicAvatarUrl(user.id, user.avatarUrl),
    },
    groups: [...map.values()],
    adminTeamIds,
  };
}

export async function resolveSession(req: Request): Promise<AuthState | null> {
  const token = getSessionToken(req);
  if (!token) return null;
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.tokenHash, sha256(token)), gt(schema.sessions.expiresAt, new Date())));
  if (!session) return null;
  return loadAuthState(session.userId);
}

/** Resolve one request identity consistently for tRPC, uploads, and file downloads. */
export async function resolveRequestAuth(req: Request): Promise<AuthState | null> {
  if (isDevAuthBypassEnabled()) {
    const seedAdminEmail = process.env.SEED_ADMIN_EMAIL ?? "aa0968111723@gmail.com";
    const [admin] = await db.select().from(schema.users).where(eq(schema.users.email, seedAdminEmail));
    return admin ? loadAuthState(admin.id) : null;
  }
  return resolveSession(req);
}

/**
 * resolveSession ＋ 強制改密碼閘門（修 AUTH2-003）：mustChangePassword 的帳號在改密碼前一律視為未認證（回 null），
 * 與 tRPC authedProcedure／MCP／restApi 同口徑。index.ts 的 REST 端點（上傳／下載／匯出／個資匯出等）應改用本函式，
 * 讓臨時密碼窗口不再等於「完整讀寫窗口」。改密碼本身走 tRPC auth.changePassword（用原始 resolveSession，不受此擋）。
 */
export async function resolveActiveSession(req: Request): Promise<AuthState | null> {
  const auth = await resolveSession(req);
  if (!auth || auth.user.mustChangePassword) return null;
  return auth;
}

/* ── 邀請 ── */
export async function createInvite(input: {
  email: string;
  teamId: string;
  teamRole: "admin" | "member";
  groupId?: string;
  groupRole: "leader" | "member";
  invitedBy: string;
}): Promise<{ token: string }> {
  const token = randomBytes(24).toString("hex");
  await db.insert(schema.invites).values({
    email: input.email.toLowerCase().trim(),
    teamId: input.teamId,
    teamRole: input.teamRole,
    groupId: input.groupId,
    groupRole: input.groupRole,
    // DB 只存 SHA-256（與 sessions.tokenHash 同級保護）：DB 外洩時邀請 token 不可直接兌換
    token: sha256(token),
    invitedBy: input.invitedBy,
    expiresAt: new Date(Date.now() + 72 * 3_600_000), // 72 小時
  });
  return { token };
}

/**
 * 管理員把「已存在的帳號」直接加入團隊/組（既有成員跨團隊時用）。
 * 不發可兌換連結、不建立 session——純粹補上成員關係，避免邀請連結被拿去接管帳號。
 * 冪等：已在該團隊/組則略過。回傳被加入的使用者名稱供前端顯示。
 */
export async function attachExistingUser(input: {
  userId: string;
  teamId: string;
  teamRole: "admin" | "member";
  groupId?: string;
  groupRole: "leader" | "member";
}): Promise<void> {
  const existingTeam = await db
    .select()
    .from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, input.teamId), eq(schema.teamMembers.userId, input.userId)));
  if (existingTeam.length === 0) {
    // 修 R6-CONC-01：查後插無鎖，併發把既有帳號重複入團隊；靠 team_members(team_id,user_id) 唯一索引＋onConflictDoNothing 兜底
    await db.insert(schema.teamMembers).values({ teamId: input.teamId, userId: input.userId, role: input.teamRole }).onConflictDoNothing();
  }
  if (input.groupId) {
    const existingGroup = await db
      .select()
      .from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.userId)));
    if (existingGroup.length === 0) {
      await db.insert(schema.groupMembers).values({ groupId: input.groupId, userId: input.userId, role: input.groupRole }).onConflictDoNothing();
    }
  }
}

/**
 * 邀請預覽（不消耗 token）：讓落地頁在填資料前就知道「這個連結有效嗎、要加入哪個組、給誰的」。
 * 只回可安全顯示的資訊（收件 email 是本人的、由持有 token 證明）；查不到/過期/用過都回清楚原因。
 */
export async function getInvitePreview(token: string): Promise<{
  valid: boolean;
  reason?: string;
  email?: string;
  teamName?: string;
  groupName?: string;
  teamRole?: "admin" | "member";
  groupRole?: "leader" | "member";
  alreadyHasAccount?: boolean;
}> {
  const [invite] = await db.select().from(schema.invites).where(eq(schema.invites.token, sha256(token)));
  if (!invite) return { valid: false, reason: "邀請連結無效——請確認連結完整，或向管理員索取新連結" };
  if (invite.acceptedAt) return { valid: false, reason: "這個邀請連結已經用過了——如果你已建立帳號，請直接登入" };
  if (invite.expiresAt <= new Date()) return { valid: false, reason: "邀請連結已過期（超過 72 小時），請向管理員索取新連結" };
  const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, invite.teamId));
  let groupName: string | undefined;
  if (invite.groupId) {
    const [g] = await db.select().from(schema.groups).where(eq(schema.groups.id, invite.groupId));
    groupName = g?.name;
  }
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
  return {
    valid: true,
    email: invite.email,
    teamName: team?.name,
    groupName,
    teamRole: invite.teamRole,
    groupRole: invite.groupRole,
    alreadyHasAccount: !!existing,
  };
}

export async function acceptInvite(token: string, name: string, password: string): Promise<{ userId: string }> {
  const [invite] = await db
    .select()
    .from(schema.invites)
    // token 欄存的是 SHA-256（見 createInvite），查詢時把使用者帶來的原文先雜湊再比對
    .where(and(eq(schema.invites.token, sha256(token)), isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())));
  if (!invite) throw new Error("邀請連結無效或已過期");

  // 安全關鍵：既有帳號「不得」透過邀請連結落地。
  // 舊版對既有 email 直接附掛並在 router 端發 session，等於任何拿到 token 的人
  // 可免密碼登入成該既有帳號（含開發者）→ 帳號接管／提權。既有成員要加入新團隊，
  // 改由管理員在後台直接加入（admin.invite 對既有 email 會直接處理，不發可兌換連結）。
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, invite.email));
  if (existing) {
    throw new Error("這個 email 已經有帳號了，請直接用原本的密碼登入；要加入新團隊時，請登入後由管理員把你加入。");
  }
  // bcrypt 先算好再進交易，避免在交易中佔住 DB 連線做 CPU 密集雜湊
  const passwordHash = await hashPassword(password);
  // 建帳號＋入團隊/組＋標記邀請已用一次做完：中途任一步失敗整批回滾，不留「有帳號沒入組」的半套資料。
  // 併發用同一 token 落地時，第二筆會撞 users.email 唯一鍵而整筆回滾，只有一筆成功。
  return db.transaction(async (tx) => {
    let user;
    try {
      [user] = await tx
        .insert(schema.users)
        .values({ name, email: invite.email, passwordHash })
        .returning();
    } catch (err) {
      // 併發用同一 token 落地時，輸家會撞 users.email 唯一鍵。整批仍回滾（只有一筆成功），
      // 但把原始 pg 23505 包成友善訊息，不讓 router 的泛用 catch 把原始約束錯誤（含欄位名）回給用戶端。
      if (isUniqueViolation(err)) throw new Error("這個 email 已經有帳號了，請直接用原本的密碼登入。");
      throw err;
    }
    const userId = user.id;
    await tx.insert(schema.teamMembers).values({ teamId: invite.teamId, userId, role: invite.teamRole });
    if (invite.groupId) {
      await tx.insert(schema.groupMembers).values({ groupId: invite.groupId, userId, role: invite.groupRole });
    }
    await tx.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
    return { userId };
  });
}
