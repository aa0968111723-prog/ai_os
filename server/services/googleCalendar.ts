/**
 * Google 日曆「直連同步」（取代手動 .ics 匯出/匯入）：
 * - OAuth 2.0 授權碼流程（offline access → refresh token 落庫，AES-256-GCM 加密）。
 * - 權限採最小範圍 calendar.app.created：只能建立並管理「本系統自建」的日曆，
 *   完全碰不到使用者原有的個人日曆——授權畫面對使用者也更安心。
 * - 同步模型：系統為每位連結者在其 Google 帳戶建立一本「AI Director OS・組排程」日曆，
 *   把該員所有所屬組的排程推進去；排程增刪改後自動觸發（debounce 合併），
 *   另有週期對帳（sweep）收斂任何漏網（離線期間的變更、成員異動、暫時性 API 失敗）。
 * - 方向性：系統是這本日曆的唯一真相來源（在 Google 端手改會在下次內容變更時被覆蓋）；
 *   使用者要改行程請回系統改——這是「組共享排程」語意的自然結果。
 * - 事件對應存 google_event_links，帶 fingerprint（內容摘要）：內容沒變就不打 API，省配額。
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { proxyFetch } from "./http";
import { recordError } from "./errlog";

/* ────────────────────────── 設定 ────────────────────────── */

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
/** 最小權限：只允許管理「應用程式自建」的日曆；openid email 用來顯示連結的是哪個帳號 */
const OAUTH_SCOPES = "openid email https://www.googleapis.com/auth/calendar.app.created";
/** 在使用者 Google 帳戶建立的專屬日曆名稱 */
const CALENDAR_SUMMARY = "AI Director OS・組排程";
/** 單人同步的排程上限（近的優先）；小型組織遠用不滿，僅防極端資料量拖垮對帳 */
const SYNC_ITEM_LIMIT = 2000;
/** 排程變更後的合併延遲：連續編輯只觸發一次同步 */
const DEBOUNCE_MS = 3000;
/** 週期對帳間隔（收斂漏網之魚） */
const SWEEP_INTERVAL_MS = 15 * 60_000;

export function isGoogleCalendarConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function clientId(): string { return process.env.GOOGLE_CLIENT_ID ?? ""; }
function clientSecret(): string { return process.env.GOOGLE_CLIENT_SECRET ?? ""; }

/** OAuth redirect URI：以 APP_URL 為準（正式站必設；本機開發退回 localhost） */
export function redirectUri(): string {
  const base = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base}/api/google/oauth/callback`;
}

/* ────────────────────────── refresh token 加密（AES-256-GCM） ────────────────────────── */

/** 金鑰：GOOGLE_TOKEN_SECRET（可獨立輪替）→ 退回 GOOGLE_CLIENT_SECRET（開啟本功能時必存在的伺服器機密） */
function encKey(): Buffer {
  const seed = process.env.GOOGLE_TOKEN_SECRET || clientSecret();
  return createHash("sha256").update(`gcal-token:${seed}`).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("token 格式不正確");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

/* ────────────────────────── OAuth state（HMAC 簽章，防 CSRF/竄改） ────────────────────────── */

function stateSig(payload: string): string {
  return createHmac("sha256", encKey()).update(payload).digest("hex");
}

/** state = base64url(userId|exp)．sig——callback 驗簽並比對登入者，杜絕跨帳號綁定 */
export function signState(userId: string): string {
  const payload = Buffer.from(`${userId}|${Date.now() + 10 * 60_000}`).toString("base64url");
  return `${payload}.${stateSig(payload)}`;
}

export function verifyState(state: string): { userId: string } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expect = stateSig(payload);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expect, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, expStr] = Buffer.from(payload, "base64url").toString("utf8").split("|");
  if (!userId || !expStr || Number(expStr) < Date.now()) return null;
  return { userId };
}

export function buildAuthUrl(userId: string): string {
  const q = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent", // 確保每次都發 refresh token（重複授權時 Google 預設不再發）
    state: signState(userId),
  });
  return `${OAUTH_AUTH_URL}?${q}`;
}

/* ────────────────────────── OAuth token 交換／刷新 ────────────────────────── */

type ConnRow = typeof schema.googleCalendarConnections.$inferSelect;

async function tokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await proxyFetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    timeoutMs: 15_000,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(`Google OAuth ${res.status}：${String(json.error ?? "")} ${String(json.error_description ?? "")}`.trim());
    (err as Error & { oauthError?: string }).oauthError = String(json.error ?? "");
    throw err;
  }
  return json;
}

/** 授權碼換 token；email 直接解 id_token payload（token 來自 Google TLS 直連，毋須再驗簽） */
export async function exchangeCode(code: string): Promise<{ refreshToken: string; email: string | null }> {
  const json = await tokenRequest({
    code,
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : "";
  if (!refreshToken) throw new Error("Google 未回發 refresh token——請在授權畫面允許離線存取後重試");
  let email: string | null = null;
  if (typeof json.id_token === "string") {
    try {
      const payload = JSON.parse(Buffer.from(json.id_token.split(".")[1] ?? "", "base64url").toString("utf8"));
      if (typeof payload.email === "string") email = payload.email;
    } catch { /* email 僅供顯示，解不出就留空 */ }
  }
  return { refreshToken, email };
}

/** access token 短快取（Google 發的效期約 1 小時，留 5 分鐘安全邊際） */
const accessCache = new Map<string, { token: string; expiresAt: number }>();

async function getAccessToken(conn: ConnRow): Promise<string> {
  const hit = accessCache.get(conn.id);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  try {
    const json = await tokenRequest({
      refresh_token: decryptToken(conn.refreshTokenEnc),
      client_id: clientId(),
      client_secret: clientSecret(),
      grant_type: "refresh_token",
    });
    const token = String(json.access_token ?? "");
    if (!token) throw new Error("Google 未回發 access token");
    const ttl = Math.max(60, Number(json.expires_in ?? 3600) - 300) * 1000;
    accessCache.set(conn.id, { token, expiresAt: Date.now() + ttl });
    return token;
  } catch (err) {
    // invalid_grant＝使用者在 Google 端撤銷授權（或 token 過期失效）——標記連線待重連，不再重試
    if ((err as Error & { oauthError?: string }).oauthError === "invalid_grant") {
      await db.update(schema.googleCalendarConnections)
        .set({ status: "error", lastError: "Google 授權已失效（可能已在 Google 帳戶端撤銷）——請重新連結" })
        .where(eq(schema.googleCalendarConnections.id, conn.id));
    }
    throw err;
  }
}

/* ────────────────────────── Calendar API 薄封裝 ────────────────────────── */

async function gapi(conn: ConnRow, method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const token = await getAccessToken(conn);
  const res = await proxyFetch(`${CALENDAR_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeoutMs: 15_000,
  });
  const json = res.status === 204 ? {} : ((await res.json().catch(() => ({}))) as Record<string, unknown>);
  return { status: res.status, json };
}

/** 確保專屬日曆存在（被使用者手動刪掉也能自癒重建） */
async function ensureCalendar(conn: ConnRow): Promise<string> {
  if (conn.calendarId) {
    const probe = await gapi(conn, "GET", `/calendars/${encodeURIComponent(conn.calendarId)}`);
    if (probe.status === 200) return conn.calendarId;
    if (probe.status !== 404 && probe.status !== 410) {
      throw new Error(`Google 日曆檢查失敗（HTTP ${probe.status}）`);
    }
    // 404/410＝日曆被刪——往下重建，且舊事件對應已無意義，一併清掉
    await db.delete(schema.googleEventLinks).where(eq(schema.googleEventLinks.connectionId, conn.id));
  }
  const created = await gapi(conn, "POST", "/calendars", { summary: CALENDAR_SUMMARY });
  if (created.status !== 200 || typeof created.json.id !== "string") {
    throw new Error(`建立 Google 專屬日曆失敗（HTTP ${created.status}：${String(created.json.error ? JSON.stringify(created.json.error) : "")}）`);
  }
  const calendarId = created.json.id;
  await db.update(schema.googleCalendarConnections).set({ calendarId }).where(eq(schema.googleCalendarConnections.id, conn.id));
  conn.calendarId = calendarId;
  return calendarId;
}

/* ────────────────────────── 同步核心 ────────────────────────── */

type ItemRow = typeof schema.scheduleItems.$inferSelect;

/** 推送內容摘要：任一顯示欄位變動就重推；順序固定，兩端穩定 */
export function eventFingerprint(item: Pick<ItemRow, "title" | "startsAt" | "endsAt" | "note">, groupName: string): string {
  const parts = [item.title, item.startsAt.toISOString(), item.endsAt?.toISOString() ?? "", item.note ?? "", groupName];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** 事件內容：與 .ics 匯出同一口徑（無結束時間以 1 小時計；UTC 時間，Google 端依使用者時區顯示） */
export function eventBody(item: Pick<ItemRow, "title" | "startsAt" | "endsAt" | "note">, groupName: string): Record<string, unknown> {
  const end = item.endsAt ?? new Date(item.startsAt.getTime() + 60 * 60 * 1000);
  return {
    summary: `[${groupName}] ${item.title}`,
    description: [item.note?.trim() || null, "—— 由 AI Director OS 組排程自動同步（請回系統修改）"].filter(Boolean).join("\n\n"),
    start: { dateTime: item.startsAt.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

/** 同步互斥：同一人同時只跑一輪；進行中又被觸發就記 pending，跑完再補一輪 */
const inFlight = new Map<string, { pending: boolean }>();

/**
 * 全量對帳（單一使用者）：
 * 期望集合＝該員所有所屬組的排程（近的優先，上限 SYNC_ITEM_LIMIT）；
 * 相對 google_event_links 差異化——缺的建、指紋變的改、多的刪。
 */
export async function syncUserCalendar(userId: string): Promise<{ created: number; updated: number; deleted: number } | null> {
  if (!isGoogleCalendarConfigured()) return null;
  const flag = inFlight.get(userId);
  if (flag) { flag.pending = true; return null; }
  inFlight.set(userId, { pending: false });
  try {
    return await doSync(userId);
  } finally {
    const f = inFlight.get(userId);
    inFlight.delete(userId);
    if (f?.pending) void syncUserCalendar(userId).catch(() => {});
  }
}

async function doSync(userId: string): Promise<{ created: number; updated: number; deleted: number } | null> {
  const [conn] = await db.select().from(schema.googleCalendarConnections).where(eq(schema.googleCalendarConnections.userId, userId));
  if (!conn || conn.status !== "active") return null;

  try {
    // 期望集合：所屬組 × 排程（組名進事件標題）
    const memberships = await db.select({ groupId: schema.groupMembers.groupId }).from(schema.groupMembers).where(eq(schema.groupMembers.userId, userId));
    const groupIds = memberships.map((m) => m.groupId);
    const groupNames = new Map<string, string>();
    let items: ItemRow[] = [];
    if (groupIds.length > 0) {
      const groups = await db.select({ id: schema.groups.id, name: schema.groups.name }).from(schema.groups).where(inArray(schema.groups.id, groupIds));
      for (const g of groups) groupNames.set(g.id, g.name);
      items = await db.select().from(schema.scheduleItems)
        .where(inArray(schema.scheduleItems.groupId, groupIds))
        .orderBy(desc(schema.scheduleItems.startsAt))
        .limit(SYNC_ITEM_LIMIT);
    }

    const calendarId = await ensureCalendar(conn);
    const calPath = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const links = await db.select().from(schema.googleEventLinks).where(eq(schema.googleEventLinks.connectionId, conn.id));
    const linkByItem = new Map(links.map((l) => [l.scheduleItemId, l]));
    const desiredIds = new Set(items.map((i) => i.id));
    let created = 0, updated = 0, deleted = 0;

    // 多的刪：排程已刪除／已退出該組 → 移除 Google 事件與對應
    for (const link of links) {
      if (desiredIds.has(link.scheduleItemId)) continue;
      const res = await gapi(conn, "DELETE", `${calPath}/${encodeURIComponent(link.googleEventId)}`);
      if (res.status === 204 || res.status === 200 || res.status === 404 || res.status === 410) {
        await db.delete(schema.googleEventLinks).where(eq(schema.googleEventLinks.id, link.id));
        deleted += 1;
      } else {
        throw new Error(`刪除 Google 事件失敗（HTTP ${res.status}）`);
      }
    }

    // 缺的建、指紋變的改
    for (const item of items) {
      const groupName = groupNames.get(item.groupId) ?? "組排程";
      const fp = eventFingerprint(item, groupName);
      const link = linkByItem.get(item.id);
      if (link && link.fingerprint === fp) continue; // 沒變——不打 API
      const body = eventBody(item, groupName);
      if (!link) {
        const res = await gapi(conn, "POST", calPath, body);
        if (res.status !== 200 || typeof res.json.id !== "string") throw new Error(`建立 Google 事件失敗（HTTP ${res.status}）`);
        await db.insert(schema.googleEventLinks)
          .values({ connectionId: conn.id, scheduleItemId: item.id, googleEventId: res.json.id, fingerprint: fp })
          .onConflictDoUpdate({
            target: [schema.googleEventLinks.connectionId, schema.googleEventLinks.scheduleItemId],
            set: { googleEventId: res.json.id, fingerprint: fp },
          });
        created += 1;
      } else {
        const res = await gapi(conn, "PATCH", `${calPath}/${encodeURIComponent(link.googleEventId)}`, body);
        if (res.status === 404 || res.status === 410) {
          // 事件在 Google 端被手動刪掉——重建（系統是真相來源）
          const re = await gapi(conn, "POST", calPath, body);
          if (re.status !== 200 || typeof re.json.id !== "string") throw new Error(`重建 Google 事件失敗（HTTP ${re.status}）`);
          await db.update(schema.googleEventLinks).set({ googleEventId: re.json.id, fingerprint: fp }).where(eq(schema.googleEventLinks.id, link.id));
        } else if (res.status !== 200) {
          throw new Error(`更新 Google 事件失敗（HTTP ${res.status}）`);
        } else {
          await db.update(schema.googleEventLinks).set({ fingerprint: fp }).where(eq(schema.googleEventLinks.id, link.id));
        }
        updated += 1;
      }
    }

    await db.update(schema.googleCalendarConnections)
      .set({ lastSyncAt: new Date(), lastError: null })
      .where(eq(schema.googleCalendarConnections.id, conn.id));
    return { created, updated, deleted };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    recordError("gcal:sync", err);
    // invalid_grant 已在 getAccessToken 標記 error；其餘失敗保留 active、只記 lastError（sweep 會重試）
    await db.update(schema.googleCalendarConnections)
      .set({ lastError: msg })
      .where(and(eq(schema.googleCalendarConnections.id, conn.id), eq(schema.googleCalendarConnections.status, "active")))
      .catch(() => {});
    throw err;
  }
}

/* ────────────────────────── 觸發（debounce）與週期對帳 ────────────────────────── */

const debounceTimers = new Map<string, NodeJS.Timeout>();

/** 單人延遲觸發：連續操作合併為一次同步；失敗吞掉（lastError 已記，sweep 會補救） */
export function queueUserSync(userId: string): void {
  if (!isGoogleCalendarConfigured()) return;
  const prev = debounceTimers.get(userId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    debounceTimers.delete(userId);
    void syncUserCalendar(userId).catch(() => {});
  }, DEBOUNCE_MS);
  if (typeof t.unref === "function") t.unref();
  debounceTimers.set(userId, t);
}

/** 排程增刪改後呼叫：把「該組所有已連結成員」排進同步佇列（組排程是共享的——每個連結者的日曆都要動） */
export function queueGroupSync(groupId: string): void {
  if (!isGoogleCalendarConfigured()) return;
  void (async () => {
    const rows = await db
      .select({ userId: schema.googleCalendarConnections.userId })
      .from(schema.googleCalendarConnections)
      .innerJoin(schema.groupMembers, and(
        eq(schema.groupMembers.userId, schema.googleCalendarConnections.userId),
        eq(schema.groupMembers.groupId, groupId),
      ))
      .where(eq(schema.googleCalendarConnections.status, "active"));
    for (const r of rows) queueUserSync(r.userId);
  })().catch((err) => recordError("gcal:queueGroup", err));
}

let sweepStarted = false;

/** 週期對帳：每 15 分鐘把所有 active 連線各跑一輪（逐一、不並發——單人流量小，穩比快重要） */
export function startGoogleCalendarSweep(): void {
  if (sweepStarted || !isGoogleCalendarConfigured()) return;
  sweepStarted = true;
  const run = async () => {
    const conns = await db.select({ userId: schema.googleCalendarConnections.userId })
      .from(schema.googleCalendarConnections)
      .where(eq(schema.googleCalendarConnections.status, "active"));
    for (const c of conns) {
      await syncUserCalendar(c.userId).catch(() => {}); // 個別失敗不擋整輪；lastError 已記
    }
  };
  setTimeout(() => void run().catch((err) => recordError("gcal:sweep", err)), 30_000); // 開機 30 秒後先跑一輪
  const iv = setInterval(() => void run().catch((err) => recordError("gcal:sweep", err)), SWEEP_INTERVAL_MS);
  if (typeof iv.unref === "function") iv.unref();
  console.log("[gcal] ✓ Google 日曆同步已啟動（變更即推＋每 15 分鐘對帳）");
}

/* ────────────────────────── 連線管理（router 用） ────────────────────────── */

/** 完成 OAuth 後落庫（重複連結＝覆蓋舊連線並重置事件對應），隨即觸發首輪同步 */
export async function saveConnection(userId: string, refreshToken: string, email: string | null): Promise<void> {
  const enc = encryptToken(refreshToken);
  const [existing] = await db.select().from(schema.googleCalendarConnections).where(eq(schema.googleCalendarConnections.userId, userId));
  if (existing) {
    accessCache.delete(existing.id);
    // 換帳號重連：舊日曆在舊帳號裡，事件對應全部作廢重來；同帳號重連則保留（calendarId probe 會自癒）
    const sameAccount = !!email && existing.googleEmail === email;
    if (!sameAccount) await db.delete(schema.googleEventLinks).where(eq(schema.googleEventLinks.connectionId, existing.id));
    await db.update(schema.googleCalendarConnections)
      .set({ refreshTokenEnc: enc, googleEmail: email, status: "active", lastError: null, ...(sameAccount ? {} : { calendarId: null }) })
      .where(eq(schema.googleCalendarConnections.id, existing.id));
  } else {
    await db.insert(schema.googleCalendarConnections).values({ userId, refreshTokenEnc: enc, googleEmail: email });
  }
  queueUserSync(userId);
}

/** 中斷連結：先嘗試刪掉專屬日曆（清乾淨對方帳戶）與撤銷 token（皆盡力而為），再刪本地紀錄 */
export async function disconnectUser(userId: string): Promise<void> {
  const [conn] = await db.select().from(schema.googleCalendarConnections).where(eq(schema.googleCalendarConnections.userId, userId));
  if (!conn) return;
  if (conn.status === "active") {
    try {
      if (conn.calendarId) await gapi(conn, "DELETE", `/calendars/${encodeURIComponent(conn.calendarId)}`);
    } catch { /* 授權可能已失效——本地清理照做 */ }
    try {
      await proxyFetch(OAUTH_REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: decryptToken(conn.refreshTokenEnc) }).toString(),
        timeoutMs: 10_000,
      });
    } catch { /* 同上 */ }
  }
  accessCache.delete(conn.id);
  await db.delete(schema.googleEventLinks).where(eq(schema.googleEventLinks.connectionId, conn.id));
  await db.delete(schema.googleCalendarConnections).where(eq(schema.googleCalendarConnections.id, conn.id));
}

export async function getConnectionStatus(userId: string): Promise<{
  configured: boolean;
  connected: boolean;
  googleEmail: string | null;
  status: "active" | "error" | null;
  lastError: string | null;
  lastSyncAt: Date | null;
}> {
  const configured = isGoogleCalendarConfigured();
  if (!configured) return { configured, connected: false, googleEmail: null, status: null, lastError: null, lastSyncAt: null };
  const [conn] = await db.select().from(schema.googleCalendarConnections).where(eq(schema.googleCalendarConnections.userId, userId));
  if (!conn) return { configured, connected: false, googleEmail: null, status: null, lastError: null, lastSyncAt: null };
  return { configured, connected: true, googleEmail: conn.googleEmail, status: conn.status, lastError: conn.lastError, lastSyncAt: conn.lastSyncAt };
}
