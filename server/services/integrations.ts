/**
 * 個人整合連接：讓每個使用者「自己連自己的」外部服務——
 * - Google 雲端硬碟（OAuth 2.0，scope 僅 drive.readonly）：匯入自己雲端裡的私有文件/試算表/簡報/檔案；
 * - Notion（個人 integration token，notion.so/my-integrations 自建）：匯入自己分享給整合的頁面；
 * - 外部資料庫/API（Airtable/Supabase/自建服務…）：存一條「基底網址＋認證標頭」的具名連接，匯入時代為抓取。
 *
 * 資安設計（沿用 googleCalendar 與全站稽核確立的慣例）：
 * - 憑證屬「需重放」型→ AES-256-GCM 加密落庫（iv:tag:cipher hex），非雜湊；原文永不回傳前端。
 * - 加密金鑰種子：INTEGRATION_TOKEN_SECRET → 退回 Volume 持久檔 .integration-key（首次自動產生、0600）。
 *   金鑰與資料庫分離（DB 外洩不可解密）；嚴禁開機隨機（重啟即全部解不開）與可預測後備（審計慣例）。
 *   加密與 state 簽章用「不同分域前綴」派生，跨用途金鑰不可互換（比照 storage 的 dbfile. 分域）。
 * - OAuth state＝HMAC 簽章＋10 分鐘效期＋timingSafeEqual＋callback 比對登入者（三重繫結防 CSRF/跨帳綁定）。
 * - 外部 API 抓取：https 限定、固定同源（憑證絕不送去 baseUrl 以外的主機）、不跟隨重導向、
 *   SSRF 守衛（字面快篩＋DNS 權威判準）與 25MB/25s 上限全沿用 databaseFiles。
 * - google-drive 的 invalid_grant／持續 HTTP 401 → 連線標記 error 引導重連；快取 token 遇 401 會清除並強制刷新一次。
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { proxyFetch } from "./http";
import { STORAGE_ROOT, storageBackend } from "./storage";
import { assertPublicHostOrError, MAX_IMPORT_BYTES, readBodyCapped, ssrfGuardError } from "./databaseFiles";
import { sanitizeReturnTo } from "../../shared/returnTo";
import {
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
} from "./rateLimit";

const OAUTH_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
/** 最小權限：只讀雲端硬碟（不能改不能刪）；openid email 用來顯示連結的是哪個帳號 */
const DRIVE_SCOPES = "openid email https://www.googleapis.com/auth/drive.readonly";
/** 每人 api 連接上限（防塞爆；正常用途遠用不滿） */
export const MAX_API_CONNECTIONS = 10;
/** 外部 API 回傳內容的字數上限：與 databases.importData 的 content 上限同口徑 */
export const MAX_API_CONTENT_CHARS = 1_400_000;

export type IntegrationRow = typeof schema.userIntegrations.$inferSelect;

/* ────────────────────────── 金鑰與加解密 ────────────────────────── */

let cachedSeed: string | null = null;

/**
 * 金鑰種子解析：INTEGRATION_TOKEN_SECRET（可獨立輪替）→ Volume 持久檔（首次自動產生）。
 * 兩者皆「持久」——at-rest 加密的 token 必須重啟後仍可解（與簽名網址的開機隨機語意不同）。
 */
function keySeed(): string {
  if (process.env.INTEGRATION_TOKEN_SECRET) return process.env.INTEGRATION_TOKEN_SECRET;
  if (cachedSeed) return cachedSeed;
  // 物件儲存模式的人通常已經把 Volume 退掉，STORAGE_ROOT 落在容器暫存層——
  // 那裡「寫得進去但活不過下次部署」，於是每次部署都產生一把新種子，
  // 所有已存的 Google／Notion token 在無聲無息中變成解不開的亂碼（使用者只會看到整合突然全斷）。
  // 磁碟可寫所以下面的 catch 接不到，只能在這裡明確擋下。
  if (storageBackend() === "object") {
    throw new Error(
      "使用物件儲存時必須設定環境變數 INTEGRATION_TOKEN_SECRET（至少 32 字元，可用 openssl rand -hex 32）——" +
        "整合金鑰不能存在容器暫存層，否則每次重新部署都會換一把，已連結的 Google／Notion 帳號會全部失效且無法復原。",
    );
  }
  const file = path.join(STORAGE_ROOT, ".integration-key");
  try {
    if (existsSync(file)) {
      const s = readFileSync(file, "utf8").trim();
      if (s.length >= 32) {
        cachedSeed = s;
        return s;
      }
    }
    const fresh = randomBytes(32).toString("hex");
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, fresh, { mode: 0o600 });
    cachedSeed = fresh;
    return fresh;
  } catch (err) {
    // Volume 不可寫（極端情況）：明確拋錯而非退到不持久的值——寧可功能不可用，不可存了之後解不開
    throw new Error(`整合金鑰初始化失敗（無法寫入 ${file}）：${err instanceof Error ? err.message : err}——請設定環境變數 INTEGRATION_TOKEN_SECRET`);
  }
}

/** 分域派生：加密與 state 簽章各自一把，跨用途不可互換 */
function encKey(): Buffer {
  return createHash("sha256").update(`integrations-token:${keySeed()}`).digest();
}
function stateKey(): Buffer {
  return createHash("sha256").update(`integrations-state:${keySeed()}`).digest();
}

/**
 * 供其他外部帳號整合（#224 的 Adobe，見 services/adobe/tokenService）派生自己的金鑰：
 * 同一顆持久種子、不同分域前綴——各整合的密文與簽章互不可用，輪替種子也只需改一處環境變數。
 */
export function deriveIntegrationKey(domain: string): Buffer {
  return createHash("sha256").update(`${domain}:${keySeed()}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("憑證格式不正確");
  const decipher = createDecipheriv("aes-256-gcm", encKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

/** 解密（含失效標記）：金鑰輪替/檔案遺失導致解不開時，把連線標記 error 引導使用者重新連結 */
async function decryptOrMarkError(row: IntegrationRow): Promise<string | null> {
  try {
    return decryptSecret(row.secretEnc);
  } catch {
    await db.update(schema.userIntegrations)
      .set({ status: "error", lastError: "憑證解密失敗（伺服器金鑰可能已輪替）——請重新連結/重新輸入" })
      .where(eq(schema.userIntegrations.id, row.id))
      .catch(() => {});
    return null;
  }
}

/* ────────────────────────── OAuth state（HMAC 簽章） ────────────────────────── */

function stateSig(payload: string): string {
  return createHmac("sha256", stateKey()).update(payload).digest("hex");
}

/**
 * 授權完成後要回到哪一頁（資料中心 P2）。
 *
 * 為什麼要有這個：使用者是從「專案 → ＋加入資料 → Google」出發的，
 * 授權完卻被丟到 /integrations 這個跟他意圖無關的設定頁，得自己走回去——
 * 這正是 Golden Path 1 斷掉的地方。
 *
 * ★ 安全：returnTo 只允許**同站相對路徑**，而且它是被 **HMAC 簽進 state 一起簽的**，
 *   不是 callback 上的自由參數——外人無法偽造一個把使用者導去別處的授權連結
 *   （open redirect）。任何不合格的值一律丟掉，退回預設頁，絕不「盡量照做」。
 */
export function sanitizeIntegrationReturnTo(raw: string | null | undefined): string | null {
  // 白名單本體在 shared/returnTo——前端組連結時用的是同一支，兩邊不會漂移
  return sanitizeReturnTo(raw);
}

/** 以明確到期時刻簽發 state（可測接縫：讓測試造出「簽章正確但已過期」的樣本驗 TTL） */
export function signIntegrationStateAt(userId: string, expiresAtMs: number, returnTo?: string | null): string {
  // payload 第三段為可選的回跳路徑。舊 state（只有兩段）仍能驗過——升版不會讓
  // 正在授權中的使用者的 state 突然失效。
  const safe = sanitizeIntegrationReturnTo(returnTo);
  const base = `${userId}|${expiresAtMs}`;
  const payload = Buffer.from(safe ? `${base}|${encodeURIComponent(safe)}` : base).toString("base64url");
  return `${payload}.${stateSig(payload)}`;
}

export function signIntegrationState(userId: string, returnTo?: string | null): string {
  return signIntegrationStateAt(userId, Date.now() + 10 * 60_000, returnTo);
}

export function verifyIntegrationState(state: string): { userId: string; returnTo: string | null } | null {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expect = stateSig(payload);
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expect, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, expStr, returnRaw] = Buffer.from(payload, "base64url").toString("utf8").split("|");
  if (!userId || !expStr || Number(expStr) < Date.now()) return null;
  let returnTo: string | null = null;
  if (returnRaw) {
    try {
      // 簽章已保證這段沒被竄改，但仍再過一次白名單——沒有「因為簽過就放行」的路徑
      returnTo = sanitizeIntegrationReturnTo(decodeURIComponent(returnRaw));
    } catch {
      returnTo = null;
    }
  }
  return { userId, returnTo };
}

/* ────────────────────────── Google 雲端硬碟（OAuth drive.readonly） ────────────────────────── */

/** 與日曆同一組 GCP 憑證（GOOGLE_CLIENT_ID/SECRET）；但獨立連線、獨立 scope——不動既有日曆授權 */
export function isGoogleDriveConfigured(): boolean {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** callback 路徑與日曆不同——需在 GCP console 另外註冊這個 redirect URI */
export function driveRedirectUri(): string {
  const base = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base}/api/integrations/google-drive/callback`;
}

export function buildDriveAuthUrl(userId: string, returnTo?: string | null): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: driveRedirectUri(),
    response_type: "code",
    scope: DRIVE_SCOPES,
    access_type: "offline",
    prompt: "consent", // 重複授權時 Google 預設不再發 refresh token——強制 consent 確保拿得到
    // returnTo 簽進 state：授權完成後回到使用者原本的流程，而不是一律掉到 /integrations
    state: signIntegrationState(userId, returnTo),
  });
  return `${OAUTH_AUTH_URL}?${q}`;
}

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

/** 授權碼換 token（email 直解 id_token payload——token 來自 Google TLS 直連，毋須再驗簽） */
export async function exchangeDriveCode(code: string): Promise<{ refreshToken: string; email: string | null }> {
  const json = await tokenRequest({
    code,
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    redirect_uri: driveRedirectUri(),
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

async function findIntegration(userId: string, kind: "google-drive" | "notion"): Promise<IntegrationRow | null> {
  const [row] = await db.select().from(schema.userIntegrations)
    .where(and(eq(schema.userIntegrations.userId, userId), eq(schema.userIntegrations.kind, kind)));
  return row ?? null;
}

/** 完成 OAuth 後落庫（重複連結＝覆蓋） */
export async function saveGoogleDrive(userId: string, refreshToken: string, email: string | null): Promise<void> {
  const secretEnc = encryptSecret(refreshToken);
  const existing = await findIntegration(userId, "google-drive");
  if (existing) {
    driveAccessCache.delete(existing.id);
    await db.update(schema.userIntegrations)
      .set({ secretEnc, meta: { email }, status: "active", lastError: null })
      .where(eq(schema.userIntegrations.id, existing.id));
  } else {
    await db.insert(schema.userIntegrations).values({ userId, kind: "google-drive", secretEnc, meta: { email } });
  }
}

/** access token 短快取（效期約 1 小時，留 5 分鐘邊際）；單容器記憶體 Map（全站慣例） */
const driveAccessCache = new Map<string, { token: string; expiresAt: number }>();

async function driveAccessToken(row: IntegrationRow, forceRefresh = false): Promise<string> {
  if (forceRefresh) driveAccessCache.delete(row.id);
  const hit = driveAccessCache.get(row.id);
  if (hit && hit.expiresAt > Date.now()) return hit.token;
  const refreshToken = await decryptOrMarkError(row);
  if (!refreshToken) throw new Error("Google 雲端連結需要重新設定——請到「連接的資料來源」頁重新連結");
  try {
    const json = await tokenRequest({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    });
    const token = String(json.access_token ?? "");
    if (!token) throw new Error("Google 未回發 access token");
    const ttl = Math.max(60, Number(json.expires_in ?? 3600) - 300) * 1000;
    driveAccessCache.set(row.id, { token, expiresAt: Date.now() + ttl });
    return token;
  } catch (err) {
    if ((err as Error & { oauthError?: string }).oauthError === "invalid_grant") {
      await db.update(schema.userIntegrations)
        .set({ status: "error", lastError: "Google 授權已失效（可能已在 Google 帳戶端撤銷或測試授權已到期）——請重新連結" })
        .where(eq(schema.userIntegrations.id, row.id));
    }
    throw err;
  }
}

export type DriveFetchResult =
  | { ok: true; buf: Buffer; mime: string; name: string | null }
  | { ok: false; reason: "not-connected" | "no-access" | "error"; message: string };

/**
 * 只有「未連結」或「已連結帳戶沒有該檔權限」才值得再試公開連結。
 * token 解密、刷新、401、Google 服務錯誤等連線問題必須直接顯示，不能被公開抓取的 401/404 蓋掉。
 */
export function shouldFallbackToPublicDrive(result: DriveFetchResult | null): boolean {
  return !result || (!result.ok && (result.reason === "not-connected" || result.reason === "no-access"));
}

/** 私有路徑與公開路徑都失敗時，保留「目前連結帳戶」線索，避免只看到無上下文的 HTTP 401/404。 */
export function driveImportFailureMessage(result: DriveFetchResult | null, publicError: string): string {
  if (!result || result.ok || result.reason === "not-connected") return publicError;
  if (result.reason === "no-access") return `${result.message}；公開連結也無法讀取（${publicError}）`;
  return result.message;
}

type DriveImportPayload = { buf: Buffer; mime: string };

/**
 * Google 私有檔與公開連結的單一退回流程。路由只傳入公開抓取函式，避免 import/refresh
 * 各自重寫判斷而漏掉憑證錯誤、限流或 Google 服務錯誤的 fail-closed 規則。
 */
export async function fetchDriveWithPublicFallback(
  result: DriveFetchResult | null,
  fetchPublic: () => Promise<DriveImportPayload>,
  publicPathLabel = "Google 公開連結抓取失敗",
): Promise<DriveImportPayload> {
  if (result?.ok) return { buf: result.buf, mime: result.mime };
  if (!shouldFallbackToPublicDrive(result)) {
    throw new Error(driveImportFailureMessage(result, publicPathLabel));
  }
  try {
    return await fetchPublic();
  } catch (err) {
    const publicError = err instanceof Error ? err.message : publicPathLabel;
    throw new Error(driveImportFailureMessage(result, publicError));
  }
}

/**
 * 將非 active 的 Drive 連線轉成匯入結果。已標記 error 的連線必須保留為 error，
 * 否則呼叫端會把它當成「未連線」並退回公開抓取，重新授權提示就會被 401/404 蓋掉。
 */
export function inactiveDriveResult(
  row: Pick<IntegrationRow, "status" | "lastError"> | null,
): DriveFetchResult | null {
  if (!row) {
    return { ok: false, reason: "not-connected", message: "尚未連結 Google 雲端" };
  }
  if (row.status === "active") return null;
  if (row.status === "error") {
    return {
      ok: false,
      reason: "error",
      message: row.lastError || DRIVE_REAUTH_MESSAGE,
    };
  }
  return { ok: false, reason: "not-connected", message: "尚未連結 Google 雲端" };
}

function connectedDriveAccount(row: IntegrationRow): string {
  return typeof row.meta?.email === "string" && row.meta.email ? `（${row.meta.email}）` : "";
}

function driveNoAccessMessage(row: IntegrationRow): string {
  return `目前連結的 Google 帳戶${connectedDriveAccount(row)}沒有這個檔案的存取權——請把檔案分享給此帳戶；若連錯帳號，請先中斷連結再重新連結`;
}

const DRIVE_REAUTH_MESSAGE = "Google 雲端授權已失效或無法使用——請到「連接的資料來源」重新連結 Google 雲端";

async function markDriveAuthError(row: IntegrationRow, message = DRIVE_REAUTH_MESSAGE): Promise<void> {
  driveAccessCache.delete(row.id);
  await db.update(schema.userIntegrations)
    .set({ status: "error", lastError: message })
    .where(eq(schema.userIntegrations.id, row.id))
    .catch(() => {});
}

/** 帶 access token 呼叫 Drive；若快取 token 提早失效，清快取並以 refresh token 強制換新後只重試一次。 */
async function driveFetchAuthorized(row: IntegrationRow, url: string, timeoutMs: number): Promise<Response> {
  const run = async (token: string) => proxyFetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeoutMs,
  });

  let res = await run(await driveAccessToken(row));
  if (res.status !== 401) return res;

  // Google 可能在本地 TTL 前撤銷 access token；丟掉 401 回應與快取，強制走 refresh token 再試一次。
  await res.body?.cancel().catch(() => {});
  res = await run(await driveAccessToken(row, true));
  if (res.status === 401) await markDriveAuthError(row);
  return res;
}

/**
 * 用「使用者自己的」Google 授權抓私有檔。normalizeImportUrl 解析出的 kind+fileId 進來：
 * - google-doc/sheet/slides 走 Drive export（txt/csv/txt——與公開匯出同格式，後續抽取邏輯不變）；
 * - google-drive 一般檔案先查中繼資料（名稱/大小預檢）再 alt=media 下載。
 * 找不到/無權限回 no-access（呼叫端可再試公開路徑）；連線/憑證異常回 error（不得用公開 401/404 蓋掉）。
 */
export async function fetchDriveFile(
  userId: string,
  kind: "google-doc" | "google-sheet" | "google-slides" | "google-drive",
  fileId: string,
): Promise<DriveFetchResult> {
  if (!isGoogleDriveConfigured()) return { ok: false, reason: "not-connected", message: "站方尚未設定 Google 整合" };
  const row = await findIntegration(userId, "google-drive");
  const unavailable = inactiveDriveResult(row);
  if (unavailable) return unavailable;
  // inactiveDriveResult 已保證這裡一定是 active row。
  if (!row) return { ok: false, reason: "not-connected", message: "尚未連結 Google 雲端" };
  try {
    const id = encodeURIComponent(fileId);
    let url: string;
    let mimeFallback: string;
    let name: string | null = null;
    if (kind === "google-drive") {
      const metaRes = await driveFetchAuthorized(row, `${DRIVE_API}/files/${id}?fields=name,mimeType,size&supportsAllDrives=true`, 15_000);
      if (metaRes.status === 401) return { ok: false, reason: "error", message: DRIVE_REAUTH_MESSAGE };
      if (metaRes.status === 404 || metaRes.status === 403) {
        return { ok: false, reason: "no-access", message: driveNoAccessMessage(row) };
      }
      if (metaRes.status === 429) return { ok: false, reason: "error", message: "Google Drive 請求過於頻繁，請稍後再試" };
      if (metaRes.status >= 500) return { ok: false, reason: "error", message: "Google Drive 服務暫時無法使用，請稍後再試" };
      if (!metaRes.ok) throw new Error(`Google Drive 中繼資料查詢失敗（HTTP ${metaRes.status}）`);
      const meta = (await metaRes.json()) as { name?: string; mimeType?: string; size?: string };
      const size = Number(meta.size ?? 0);
      if (size > MAX_IMPORT_BYTES) return { ok: false, reason: "error", message: `檔案太大（上限 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB）` };
      name = meta.name ?? null;
      mimeFallback = meta.mimeType ?? "application/octet-stream";
      url = `${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`;
    } else {
      const exportMime = kind === "google-sheet" ? "text/csv" : "text/plain";
      mimeFallback = exportMime;
      url = `${DRIVE_API}/files/${id}/export?mimeType=${encodeURIComponent(exportMime)}`;
    }
    const res = await driveFetchAuthorized(row, url, 25_000);
    if (res.status === 401) return { ok: false, reason: "error", message: DRIVE_REAUTH_MESSAGE };
    if (res.status === 404 || res.status === 403) {
      return { ok: false, reason: "no-access", message: driveNoAccessMessage(row) };
    }
    if (res.status === 429) return { ok: false, reason: "error", message: "Google Drive 請求過於頻繁，請稍後再試" };
    if (res.status >= 500) return { ok: false, reason: "error", message: "Google Drive 服務暫時無法使用，請稍後再試" };
    if (!res.ok) throw new Error(`Google Drive 讀取失敗（HTTP ${res.status}）`);
    const buf = await readBodyCapped(res, MAX_IMPORT_BYTES);
    const mime = (res.headers.get("content-type") ?? mimeFallback).split(";")[0].trim().toLowerCase();
    void db.update(schema.userIntegrations).set({ lastUsedAt: new Date(), lastError: null })
      .where(eq(schema.userIntegrations.id, row.id)).catch(() => {});
    return { ok: true, buf, mime, name };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google Drive 讀取失敗";
    void db.update(schema.userIntegrations).set({ lastError: message })
      .where(and(eq(schema.userIntegrations.id, row.id), eq(schema.userIntegrations.status, "active"))).catch(() => {});
    return { ok: false, reason: "error", message };
  }
}

/* ────────────────────────── Google 選檔器（PR-E1：使用者主路徑） ────────────────────────── */

/** 選檔清單單頁上限（防 prompt/UI 膨脹；有 nextPageToken 可續載） */
export const DRIVE_LIST_PAGE_SIZE = 30;

export interface DriveListedFile {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  modifiedTime: string | null;
  /** 資料夾列（可進入縮小範圍，不可勾選匯入） */
  isFolder: boolean;
  /** 擁有者提示：非本人檔案顯示擁有者名稱（共用進來的檔要讓使用者看得出來） */
  owner: string | null;
  ownedByMe: boolean;
}

export type DriveListResult =
  | { ok: true; email: string | null; files: DriveListedFile[]; nextPageToken: string | null }
  | { ok: false; reason: "not-connected" | "error"; message: string };

/** Drive q 字串跳脫（純函式，可測）：單引號與反斜線——防搜尋詞注入查詢語法 */
export function escapeDriveQueryTerm(term: string): string {
  return term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * 選檔器挑中的檔案 → 匯入用的來源網址與匯出類型（純函式，可測）。
 * sourceUrl 刻意產生 normalizeImportUrl 認得的形狀——匯入後「重新整理」走既有 Google 路徑，
 * 不必為選檔匯入另開一條 refresh 分支。回 null＝此 Google 類型無法匯入（資料夾／表單等）。
 */
export function drivePickedImportShape(
  fileId: string,
  mimeType: string,
): { kind: "google-doc" | "google-sheet" | "google-slides" | "google-drive"; sourceUrl: string } | null {
  const id = encodeURIComponent(fileId);
  if (mimeType === "application/vnd.google-apps.document") {
    return { kind: "google-doc", sourceUrl: `https://docs.google.com/document/d/${id}/edit` };
  }
  if (mimeType === "application/vnd.google-apps.spreadsheet") {
    return { kind: "google-sheet", sourceUrl: `https://docs.google.com/spreadsheets/d/${id}/edit` };
  }
  if (mimeType === "application/vnd.google-apps.presentation") {
    return { kind: "google-slides", sourceUrl: `https://docs.google.com/presentation/d/${id}/edit` };
  }
  // 其餘 google-apps 原生類型（資料夾、表單、繪圖…）沒有可靠的文字匯出——明確不支援
  if (mimeType.startsWith("application/vnd.google-apps.")) return null;
  return { kind: "google-drive", sourceUrl: `https://drive.google.com/file/d/${id}/view` };
}

/**
 * 列出使用者自己雲端裡可選的檔案（名稱搜尋＋分頁）。
 * 只讀中繼資料（id/名稱/類型/大小/時間），不碰內容——內容要等使用者明確選中才抓。
 * 錯誤對映與 fetchDriveFile 同一套（401 重連指引、429 限流、5xx 服務異常）。
 */
export async function listDriveFiles(
  userId: string,
  opts: { query?: string; pageToken?: string; folderId?: string } = {},
): Promise<DriveListResult> {
  if (!isGoogleDriveConfigured()) return { ok: false, reason: "not-connected", message: "站方尚未設定 Google 整合" };
  const row = await findIntegration(userId, "google-drive");
  const unavailable = inactiveDriveResult(row);
  if (unavailable && !unavailable.ok) {
    return unavailable.reason === "error"
      ? { ok: false, reason: "error", message: unavailable.message }
      : { ok: false, reason: "not-connected", message: unavailable.message };
  }
  if (!row) return { ok: false, reason: "not-connected", message: "尚未連結 Google 雲端" };
  try {
    // 資料夾也列出（可點入縮小範圍；勾選匯入仍擋資料夾）；folderId 限縮在某資料夾內
    const qParts = ["trashed = false"];
    const term = opts.query?.trim();
    if (term) qParts.push(`name contains '${escapeDriveQueryTerm(term.slice(0, 200))}'`);
    const folderId = opts.folderId?.trim();
    if (folderId) qParts.push(`'${escapeDriveQueryTerm(folderId.slice(0, 200))}' in parents`);
    const params = new URLSearchParams({
      q: qParts.join(" and "),
      pageSize: String(DRIVE_LIST_PAGE_SIZE),
      orderBy: "folder,modifiedTime desc",
      fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime,ownedByMe,owners(displayName))",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (opts.pageToken) params.set("pageToken", opts.pageToken);
    const res = await driveFetchAuthorized(row, `${DRIVE_API}/files?${params}`, 15_000);
    if (res.status === 401) return { ok: false, reason: "error", message: DRIVE_REAUTH_MESSAGE };
    if (res.status === 429) return { ok: false, reason: "error", message: "Google Drive 請求過於頻繁，請稍後再試" };
    if (res.status >= 500) return { ok: false, reason: "error", message: "Google Drive 服務暫時無法使用，請稍後再試" };
    if (!res.ok) throw new Error(`Google Drive 清單查詢失敗（HTTP ${res.status}）`);
    const json = (await res.json()) as {
      nextPageToken?: string;
      files?: Array<{
        id?: string;
        name?: string;
        mimeType?: string;
        size?: string;
        modifiedTime?: string;
        ownedByMe?: boolean;
        owners?: Array<{ displayName?: string }>;
      }>;
    };
    const files: DriveListedFile[] = (json.files ?? [])
      .filter((f): f is NonNullable<typeof f> & { id: string; name: string; mimeType: string } => !!f.id && !!f.name && !!f.mimeType)
      .map((f) => ({
        id: f.id,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size != null ? Number(f.size) : null,
        modifiedTime: f.modifiedTime ?? null,
        isFolder: f.mimeType === "application/vnd.google-apps.folder",
        owner: f.owners?.[0]?.displayName ?? null,
        ownedByMe: f.ownedByMe ?? false,
      }));
    return {
      ok: true,
      email: typeof row.meta?.email === "string" ? row.meta.email : null,
      files,
      nextPageToken: json.nextPageToken ?? null,
    };
  } catch (err) {
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : "Google Drive 清單查詢失敗" };
  }
}

export type DrivePickedResult =
  | { ok: true; buf: Buffer; mime: string; name: string; sourceUrl: string }
  | { ok: false; reason: "not-connected" | "no-access" | "error"; message: string };

/**
 * 抓「選檔器挑中的」檔案內容：先查中繼資料決定匯出型（Google 文件→txt、試算表→csv、簡報→txt、
 * 一般檔→直載），再委派給 fetchDriveFile 走同一套 token／401／大小守門。
 * 選檔路徑沒有公開退回——檔案就是從此帳戶的清單挑的，失敗訊息直接顯示（重連／分享指引）。
 */
export async function fetchDrivePickedFile(userId: string, fileId: string): Promise<DrivePickedResult> {
  if (!isGoogleDriveConfigured()) return { ok: false, reason: "not-connected", message: "站方尚未設定 Google 整合" };
  const row = await findIntegration(userId, "google-drive");
  const unavailable = inactiveDriveResult(row);
  if (unavailable && !unavailable.ok) return unavailable;
  if (!row) return { ok: false, reason: "not-connected", message: "尚未連結 Google 雲端" };
  let meta: { name?: string; mimeType?: string };
  try {
    const metaRes = await driveFetchAuthorized(row, `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=name,mimeType,size&supportsAllDrives=true`, 15_000);
    if (metaRes.status === 401) return { ok: false, reason: "error", message: DRIVE_REAUTH_MESSAGE };
    if (metaRes.status === 404 || metaRes.status === 403) {
      return { ok: false, reason: "no-access", message: driveNoAccessMessage(row) };
    }
    if (metaRes.status === 429) return { ok: false, reason: "error", message: "Google Drive 請求過於頻繁，請稍後再試" };
    if (metaRes.status >= 500) return { ok: false, reason: "error", message: "Google Drive 服務暫時無法使用，請稍後再試" };
    if (!metaRes.ok) throw new Error(`Google Drive 中繼資料查詢失敗（HTTP ${metaRes.status}）`);
    meta = (await metaRes.json()) as { name?: string; mimeType?: string };
  } catch (err) {
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : "Google Drive 讀取失敗" };
  }
  const shape = drivePickedImportShape(fileId, meta.mimeType ?? "application/octet-stream");
  if (!shape) {
    return { ok: false, reason: "error", message: "這種 Google 類型（資料夾／表單／繪圖等）無法匯入為文件——請改選文件、試算表、簡報或一般檔案" };
  }
  const fetched = await fetchDriveFile(userId, shape.kind, fileId);
  if (!fetched.ok) return fetched;
  return {
    ok: true,
    buf: fetched.buf,
    mime: fetched.mime,
    // 匯出路徑（Google 文件系）fetchDriveFile 不帶名稱——用中繼資料的真實檔名
    name: fetched.name ?? meta.name ?? "匯入文件",
    sourceUrl: shape.sourceUrl,
  };
}

/** 中斷 Google 雲端連結：盡力撤銷 token 再刪本地紀錄。
 *  ★ 例外：同一人若還有「Google 日曆」連線（同一組 GCP client）——Google 撤銷任一 refresh token
 *  可能連帶撤銷該 user×client 的整個授權，把日曆同步一起弄斷；此時只刪本地紀錄、不打撤銷端點
 *  （本地憑證已刪即不可再用；要徹底撤銷可到 Google 帳戶安全設定移除授權）。
 *  任何日曆查詢/撤銷端點錯誤都不得阻止本地刪除，避免 UI 永遠卡在「已連結」。 */
async function disconnectGoogleDrive(row: IntegrationRow): Promise<void> {
  driveAccessCache.delete(row.id);
  try {
    const [calendarConn] = await db.select({ id: schema.googleCalendarConnections.id })
      .from(schema.googleCalendarConnections)
      .where(and(eq(schema.googleCalendarConnections.userId, row.userId), eq(schema.googleCalendarConnections.status, "active")));
    if (calendarConn) return;
    const refreshToken = decryptSecret(row.secretEnc);
    await proxyFetch(OAUTH_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      timeoutMs: 10_000,
    });
  } catch { /* 日曆查詢/授權撤銷可能失敗——本地清理照做 */ }
}

/* ────────────────────────── Notion（個人 integration token） ────────────────────────── */

/** 儲存前先打 Notion API 驗證 token 有效，順手取 workspace 名稱供列表顯示 */
export async function setNotionIntegration(userId: string, token: string): Promise<{ workspace: string | null }> {
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 300) throw new Error("Notion token 格式不正確");
  if (!/^[\x21-\x7E]+$/.test(trimmed)) throw new Error("Notion token 含不可見字元——請重新複製貼上");
  const res = await proxyFetch("https://api.notion.com/v1/users/me", {
    headers: { Authorization: `Bearer ${trimmed}`, "Notion-Version": "2022-06-28" },
    timeoutMs: 15_000,
  });
  if (res.status === 401) throw new Error("Notion 不認得這個 token——請到 notion.so/my-integrations 確認整合的 Internal Integration Secret");
  if (!res.ok) throw new Error(`Notion 驗證失敗（HTTP ${res.status}）——請稍後再試`);
  const me = (await res.json().catch(() => ({}))) as { name?: string; bot?: { workspace_name?: string } };
  const workspace = me.bot?.workspace_name ?? me.name ?? null;
  const secretEnc = encryptSecret(trimmed);
  const meta = { workspace, last4: trimmed.slice(-4) };
  const existing = await findIntegration(userId, "notion");
  if (existing) {
    await db.update(schema.userIntegrations)
      .set({ secretEnc, meta, status: "active", lastError: null })
      .where(eq(schema.userIntegrations.id, existing.id));
  } else {
    await db.insert(schema.userIntegrations).values({ userId, kind: "notion", secretEnc, meta });
  }
  return { workspace };
}

/** 取使用者自己的 Notion token（無連線/解密失敗回 null——呼叫端退回站方 NOTION_TOKEN） */
export async function getNotionToken(userId: string): Promise<string | null> {
  const row = await findIntegration(userId, "notion");
  if (!row || row.status !== "active") return null;
  return decryptOrMarkError(row);
}

/* ────────────────────────── Notion 選頁器（PR-E4：與 Google 同一心智模型） ────────────────────────── */

export interface NotionListedPage {
  id: string;
  title: string;
  lastEdited: string | null;
  /** 'database'＝Notion 資料庫（表格）：匯入時走 databases query 取整張表，不是讀 blocks */
  type: "page" | "database";
}

export type NotionSearchResult =
  | { ok: true; workspace: string | null; pages: NotionListedPage[] }
  | { ok: false; reason: "not-connected" | "error"; message: string };

/**
 * Notion 頁面／資料庫物件 → 標題（純函式，可測）。
 * 兩者放標題的位置不同：頁面在 properties 的 title 型欄位、資料庫在頂層 title 陣列
 *（資料庫的 properties 是欄位「定義」，title 欄的值是 {} 而非陣列——只看 properties 會全部變成未命名）。
 */
export function notionPageTitle(page: {
  object?: string;
  title?: Array<{ plain_text?: string }>;
  properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
}): string {
  if (Array.isArray(page.title)) {
    const text = page.title.map((t) => t?.plain_text ?? "").join("").trim();
    if (text) return text.slice(0, 120);
  }
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop?.type === "title" && Array.isArray(prop.title)) {
      const text = prop.title.map((t) => t.plain_text ?? "").join("").trim();
      if (text) return text.slice(0, 120);
    }
  }
  return page.object === "database" ? "（未命名資料庫）" : "（未命名頁面）";
}

/**
 * 搜尋使用者 token 權限內的 Notion 頁面與資料庫（連接 ≠ 授權讀全 workspace——
 * 只有分享給該整合的頁面／資料庫會出現；內容要等使用者選中、按匯入才抓）。
 * token 優先序與 fetchNotionText 一致：個人 → 站方 NOTION_TOKEN。
 */
export async function searchNotionPages(userId: string, query: string): Promise<NotionSearchResult> {
  const row = await findIntegration(userId, "notion");
  // active 才嘗試解密；error 狀態多半是金鑰輪替後舊密文——直接回 lastError，勿誤報「尚未設定」
  let personal: string | null = null;
  if (row?.status === "active") {
    personal = await decryptOrMarkError(row);
  }
  const token = personal || process.env.NOTION_TOKEN;
  if (!token) {
    if (row?.status === "error" && row.lastError) {
      return { ok: false, reason: "error", message: row.lastError };
    }
    if (row) {
      return {
        ok: false,
        reason: "error",
        message: row.lastError || "Notion 連線異常——請到「連接的資料來源」重新貼上 integration token",
      };
    }
    return { ok: false, reason: "not-connected", message: "尚未設定 Notion token——請到「連接的資料來源」貼上你的 integration token" };
  }
  try {
    const res = await proxyFetch("https://api.notion.com/v1/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // 不加 object filter：filter=page 會把「資料庫（表格）」整類濾掉，
        // 使用者把資料庫分享給整合後在選頁器裡永遠找不到它。頁面與資料庫都列出來，型別交給前端標示。
        query: query.slice(0, 200),
        sort: { direction: "descending", timestamp: "last_edited_time" },
        page_size: 50,
      }),
      timeoutMs: 15_000,
    });
    if (res.status === 401) {
      return { ok: false, reason: "error", message: "Notion 不認得這個 token——請到「連接的資料來源」重新設定" };
    }
    if (res.status === 429) return { ok: false, reason: "error", message: "Notion 請求過於頻繁，請稍後再試" };
    if (!res.ok) return { ok: false, reason: "error", message: `Notion 搜尋失敗（HTTP ${res.status}）——請稍後再試` };
    const json = (await res.json().catch(() => ({}))) as {
      results?: Array<{
        id?: string;
        object?: string;
        last_edited_time?: string;
        title?: Array<{ plain_text?: string }>;
        properties?: Record<string, { type?: string; title?: Array<{ plain_text?: string }> }>;
      }>;
    };
    const pages: NotionListedPage[] = (json.results ?? [])
      .filter((p): p is { id: string } & typeof p => !!p.id)
      .map((p) => ({
        id: p.id,
        title: notionPageTitle(p),
        lastEdited: p.last_edited_time ?? null,
        type: p.object === "database" ? "database" : "page",
      }));
    const workspace = typeof row?.meta?.workspace === "string" ? row.meta.workspace : null;
    return { ok: true, workspace, pages };
  } catch (err) {
    return { ok: false, reason: "error", message: err instanceof Error ? err.message : "Notion 搜尋失敗" };
  }
}

/* ────────────────────────── 外部資料庫/API 連接 ────────────────────────── */

const HEADER_NAME_RE = /^[A-Za-z0-9-]{1,64}$/;
/** 這些標頭交給 fetch 自己管——使用者覆寫只會壞事或繞驗證 */
const FORBIDDEN_HEADERS = new Set(["host", "content-length", "transfer-encoding", "connection", "cookie"]);

/** 建立連接時的輸入驗證（純函式，可測）：回錯誤訊息（人話）；null＝合法 */
export function validateApiConnectionInput(input: { name: string; baseUrl: string; headerName?: string; secret: string }): string | null {
  const name = input.name.trim();
  if (!name || name.length > 60) return "請幫連接取個名字（60 字內）";
  let u: URL;
  try {
    u = new URL(input.baseUrl);
  } catch {
    return "基底網址格式不正確（要含 https:// 開頭）";
  }
  if (u.protocol !== "https:") return "基底網址必須是 https://——憑證不能走明文傳輸";
  const ssrf = ssrfGuardError(input.baseUrl);
  if (ssrf) return ssrf;
  const header = (input.headerName ?? "Authorization").trim();
  if (!HEADER_NAME_RE.test(header)) return "標頭名稱只能是英數字與連字號（1–64 字）";
  if (FORBIDDEN_HEADERS.has(header.toLowerCase())) return `不能用「${header}」當認證標頭`;
  const secret = input.secret;
  if (!secret || secret.length > 2000) return "請貼上 API 金鑰（2000 字內）";
  // 標頭值限可列印 ASCII：擋換行（標頭注入）與不可見字元
  if (!/^[\x20-\x7E]+$/.test(secret)) return "API 金鑰只能含可列印英數符號（不可有換行或全形字元）";
  return null;
}

export async function addApiConnection(
  userId: string,
  input: { name: string; baseUrl: string; headerName?: string; secret: string },
): Promise<{ id: string }> {
  const invalid = validateApiConnectionInput(input);
  if (invalid) throw new Error(invalid);
  const name = input.name.trim();
  const existing = await db.select({ id: schema.userIntegrations.id, name: schema.userIntegrations.name })
    .from(schema.userIntegrations)
    .where(and(eq(schema.userIntegrations.userId, userId), eq(schema.userIntegrations.kind, "api")));
  if (existing.length >= MAX_API_CONNECTIONS) throw new Error(`外部連接太多（上限 ${MAX_API_CONNECTIONS} 條）——先刪掉不用的`);
  if (existing.some((r) => r.name === name)) throw new Error(`已有叫「${name}」的連接——換個名字，或先刪掉舊的`);
  try {
    const [row] = await db.insert(schema.userIntegrations).values({
      userId,
      kind: "api",
      name,
      secretEnc: encryptSecret(input.secret),
      baseUrl: input.baseUrl.replace(/\/$/, ""),
      authHeader: (input.headerName ?? "Authorization").trim(),
      meta: { last4: input.secret.slice(-4) },
    }).returning();
    return { id: row.id };
  } catch (err) {
    // 併發撞唯一索引（同名同時建）：轉人話，不外洩原始約束錯誤（比照 acceptInvite 慣例）
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      throw new Error(`已有叫「${name}」的連接——換個名字，或先刪掉舊的`);
    }
    throw err;
  }
}

/**
 * 解析抓取網址（純函式，可測）：path 可為空（用 baseUrl 本身）、相對路徑、查詢字串或完整網址，
 * 但最終網址必須與 baseUrl「同源」——憑證只送去使用者當初登記的主機，杜絕
 * 「path 塞 //evil.com/x 或絕對網址」把金鑰騙去別的主機。
 */
export function resolveApiUrl(baseUrl: string, rawPath: string): string {
  const base = new URL(baseUrl);
  const path_ = rawPath.trim();
  let target: URL;
  if (!path_) {
    target = base;
  } else if (path_.startsWith("?")) {
    target = new URL(base.toString());
    target.search = path_;
  } else {
    // new URL 對 "//host/x"、"https://host/x" 都會換主機——靠下方同源比對一體擋掉
    target = new URL(path_, base.toString().endsWith("/") ? base.toString() : base.toString() + "/");
  }
  if (target.origin !== base.origin) {
    throw new Error("抓取路徑只能在連接的基底網址底下——憑證不會送去其他主機");
  }
  if (target.protocol !== "https:") throw new Error("只支援 https 網址");
  return target.toString();
}

export async function fetchApiConnection(
  userId: string,
  connectionId: string,
  rawPath: string,
): Promise<{ status: number; mime: string; content: string; truncated: boolean }> {
  // 每人每分鐘 20 次，PostgreSQL 滑動視窗跨 replicas 共用；DB 不可用時服務丟錯並 fail closed。
  const rate = await consumeRateLimit(
    RATE_LIMIT_SCOPES.apiFetch,
    userId,
    RATE_LIMIT_POLICIES.apiFetch,
  );
  if (!rate.allowed) {
    throw new Error("外部抓取太頻繁——請一分鐘後再試");
  }

  const [row] = await db.select().from(schema.userIntegrations)
    .where(and(
      eq(schema.userIntegrations.id, connectionId),
      eq(schema.userIntegrations.userId, userId),
      eq(schema.userIntegrations.kind, "api"),
    ));
  // 查無＝不存在或不是你的——同一句話，不洩漏存在性（全站慣例）
  if (!row || !row.baseUrl) throw new Error("找不到這條外部連接");
  const secret = await decryptOrMarkError(row);
  if (!secret) throw new Error("這條連接的憑證需要重新設定——請刪除後重新建立");

  const url = resolveApiUrl(row.baseUrl, rawPath);
  const ssrf = ssrfGuardError(url);
  if (ssrf) throw new Error(ssrf);
  const dns = await assertPublicHostOrError(new URL(url).hostname);
  if (dns) throw new Error(dns);

  const markError = (msg: string) =>
    db.update(schema.userIntegrations).set({ lastError: msg })
      .where(eq(schema.userIntegrations.id, row.id)).catch(() => {});

  let res: Response;
  try {
    res = await proxyFetch(url, {
      headers: {
        [row.authHeader || "Authorization"]: secret,
        Accept: "application/json, text/csv, text/tab-separated-values, text/plain;q=0.9, */*;q=0.5",
      },
      timeoutMs: 25_000,
      redirect: "manual", // 不跟隨：302 換主機會把憑證外送、換路徑也可能繞過同源檢查
    });
  } catch (err) {
    const msg = `連線失敗：${err instanceof Error ? err.message : "網路錯誤"}`;
    void markError(msg);
    throw new Error(msg);
  }
  if (res.status >= 300 && res.status < 400) {
    const msg = "外部 API 回應重導向——為避免憑證外流不跟隨重導向，請改用最終網址當基底";
    void markError(msg);
    throw new Error(msg);
  }
  const buf = await readBodyCapped(res, MAX_IMPORT_BYTES);
  const text = buf.toString("utf8");
  if (!res.ok) {
    const msg = `外部 API 回應 HTTP ${res.status}${text ? `：${text.slice(0, 200)}` : ""}`;
    void markError(msg);
    throw new Error(msg);
  }
  void db.update(schema.userIntegrations).set({ lastUsedAt: new Date(), lastError: null })
    .where(eq(schema.userIntegrations.id, row.id)).catch(() => {});
  const mime = (res.headers.get("content-type") ?? "text/plain").split(";")[0].trim().toLowerCase();
  return {
    status: res.status,
    mime,
    content: text.slice(0, MAX_API_CONTENT_CHARS),
    truncated: text.length > MAX_API_CONTENT_CHARS,
  };
}

/* ────────────────────────── 列表與移除（router 用） ────────────────────────── */

/** 我的整合清單（絕不回憑證原文/密文——只給顯示用中繼資料） */
export async function listIntegrations(userId: string): Promise<{
  googleDrive: { configured: boolean; connected: boolean; email: string | null; status: string | null; lastError: string | null };
  notion: { connected: boolean; workspace: string | null; last4: string | null; status: string | null; lastError: string | null; siteTokenAvailable: boolean };
  apis: Array<{ id: string; name: string; baseUrl: string; authHeader: string; last4: string | null; status: string; lastError: string | null; lastUsedAt: Date | null; createdAt: Date }>;
}> {
  const rows = await db.select().from(schema.userIntegrations).where(eq(schema.userIntegrations.userId, userId));
  const drive = rows.find((r) => r.kind === "google-drive") ?? null;
  const notion = rows.find((r) => r.kind === "notion") ?? null;
  return {
    googleDrive: {
      configured: isGoogleDriveConfigured(),
      connected: !!drive,
      email: typeof drive?.meta?.email === "string" ? drive.meta.email : null,
      status: drive?.status ?? null,
      lastError: drive?.lastError ?? null,
    },
    notion: {
      connected: !!notion,
      workspace: typeof notion?.meta?.workspace === "string" ? notion.meta.workspace : null,
      last4: typeof notion?.meta?.last4 === "string" ? notion.meta.last4 : null,
      status: notion?.status ?? null,
      lastError: notion?.lastError ?? null,
      siteTokenAvailable: !!process.env.NOTION_TOKEN,
    },
    apis: rows.filter((r) => r.kind === "api").map((r) => ({
      id: r.id,
      name: r.name,
      baseUrl: r.baseUrl ?? "",
      authHeader: r.authHeader ?? "Authorization",
      last4: typeof r.meta?.last4 === "string" ? r.meta.last4 : null,
      status: r.status,
      lastError: r.lastError,
      lastUsedAt: r.lastUsedAt,
      createdAt: r.createdAt,
    })),
  };
}

/** 移除連線（只能移自己的）：google-drive 先盡力撤銷 token */
export async function removeIntegration(userId: string, id: string): Promise<void> {
  const [row] = await db.select().from(schema.userIntegrations)
    .where(and(eq(schema.userIntegrations.id, id), eq(schema.userIntegrations.userId, userId)));
  if (!row) throw new Error("找不到這條連接");
  if (row.kind === "google-drive") await disconnectGoogleDrive(row);
  await db.delete(schema.userIntegrations).where(eq(schema.userIntegrations.id, row.id));
}

/** kind 專屬移除（google-drive/notion 一人一條、前端不經手 id）；冪等——沒有連線也算成功 */
export async function removeIntegrationByKind(userId: string, kind: "google-drive" | "notion"): Promise<void> {
  const row = await findIntegration(userId, kind);
  if (!row) return;
  if (row.kind === "google-drive") await disconnectGoogleDrive(row);
  await db.delete(schema.userIntegrations).where(eq(schema.userIntegrations.id, row.id));
}
