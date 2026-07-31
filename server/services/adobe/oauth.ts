/**
 * Adobe 帳號連結的 OAuth 流程（#224 PR2）。
 *
 * 兩種模式跑同一條路徑（差別只在「誰發 token」）：
 * - mock：/start 直接把瀏覽器導回自家 callback（帶 mock 授權碼），callback 走完全相同的驗簽、
 *   換 token、落庫、稽核步驟。這樣前端連結／撤銷／狀態的每一格 UI 在沒有 Adobe 憑證時就能驗，
 *   之後切 real 不需要動任何前端與資料流。
 * - real：導去 Adobe IMS 授權頁，回來以授權碼換 token。
 *
 * 防護（比照 Google 雲端整合，三重繫結）：state 以獨立分域金鑰 HMAC 簽章、10 分鐘效期、
 * timingSafeEqual 比對，且 callback 端再比對「目前登入者」——防 CSRF，也防把授權綁到別人帳上。
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { proxyFetch } from "../http";
import { deriveIntegrationKey } from "../integrations";
import { ADOBE_SCOPE_PARAM, type AdobeMode } from "../../../shared/adobe";
import type { AdobeProfile, AdobeTokenSet } from "./tokenService";

/** Adobe Identity Management Services（北美端點；其他區域由 Adobe 自行轉導） */
const IMS_BASE = "https://ims-na1.adobelogin.com";
const IMS_AUTHORIZE_URL = `${IMS_BASE}/ims/authorize/v2`;
const IMS_TOKEN_URL = `${IMS_BASE}/ims/token/v3`;
const IMS_USERINFO_URL = `${IMS_BASE}/ims/userinfo/v2`;
const IMS_REVOKE_URL = `${IMS_BASE}/ims/revoke`;

/** mock 模式的授權碼：/start 自己發、callback 自己收，不出網 */
export const MOCK_AUTH_CODE = "mock-adobe-authorization-code";
const STATE_TTL_MS = 10 * 60_000;

/** 預設 mock——沒設環境變數的環境（含 CI 與本機）一律跑得動，且絕不會誤打 Adobe */
export function adobeMode(): AdobeMode {
  return process.env.ADOBE_MODE === "real" ? "real" : "mock";
}

/** real 模式才需要站方憑證；mock 恆為已設定 */
export function isAdobeConfigured(): boolean {
  if (adobeMode() === "mock") return true;
  return !!(process.env.ADOBE_CLIENT_ID && process.env.ADOBE_CLIENT_SECRET);
}

/**
 * callback 網址：優先吃 ADOBE_REDIRECT_URI（Adobe Developer Console 要求逐字相符），
 * 未設則由 APP_URL 推導——與 Google 雲端整合同一套推導規則。
 */
export function adobeRedirectUri(): string {
  if (process.env.ADOBE_REDIRECT_URI) return process.env.ADOBE_REDIRECT_URI;
  const base = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base}/api/integrations/adobe/callback`;
}

/* ────────────────────────── state 簽章 ────────────────────────── */

function stateSig(payload: string): string {
  return createHmac("sha256", deriveIntegrationKey("adobe-state")).update(payload).digest("hex");
}

/** 明確到期時刻的簽發（可測接縫：讓測試造出「簽章正確但已過期」的樣本驗 TTL） */
export function signAdobeStateAt(userId: string, expiresAtMs: number): string {
  const payload = Buffer.from(`${userId}|${expiresAtMs}`).toString("base64url");
  return `${payload}.${stateSig(payload)}`;
}

export function signAdobeState(userId: string): string {
  return signAdobeStateAt(userId, Date.now() + STATE_TTL_MS);
}

export function verifyAdobeState(state: string): { userId: string } | null {
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

/* ────────────────────────── 授權入口 ────────────────────────── */

/** mock 模式回自家 callback（同站相對網址）；real 模式回 Adobe IMS 授權頁 */
export function buildAdobeAuthUrl(userId: string): string {
  const state = signAdobeState(userId);
  if (adobeMode() === "mock") {
    return `/api/integrations/adobe/callback?code=${encodeURIComponent(MOCK_AUTH_CODE)}&state=${encodeURIComponent(state)}`;
  }
  const q = new URLSearchParams({
    client_id: process.env.ADOBE_CLIENT_ID ?? "",
    redirect_uri: adobeRedirectUri(),
    response_type: "code",
    scope: ADOBE_SCOPE_PARAM,
    state,
  });
  return `${IMS_AUTHORIZE_URL}?${q}`;
}

/* ────────────────────────── token 交換 ────────────────────────── */

async function imsTokenRequest(params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await proxyFetch(IMS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    timeoutMs: 15_000,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = new Error(`Adobe OAuth ${res.status}：${String(json.error ?? "")} ${String(json.error_description ?? "")}`.trim());
    (err as Error & { oauthError?: string }).oauthError = String(json.error ?? "");
    throw err;
  }
  return json;
}

/** IMS 回應 → 內部 token 形狀（欄位缺漏一律當失敗，不要半套 token 落庫） */
export function parseTokenResponse(json: Record<string, unknown>): AdobeTokenSet {
  const accessToken = typeof json.access_token === "string" ? json.access_token : "";
  if (!accessToken) throw new Error("Adobe 未回發 access token");
  return {
    accessToken,
    refreshToken: typeof json.refresh_token === "string" && json.refresh_token ? json.refresh_token : undefined,
    expiresInSec: Number(json.expires_in ?? 3600),
    scope: typeof json.scope === "string" ? json.scope : undefined,
  };
}

/** mock token：帶使用者前綴，方便在 log／稽核一眼看出是模擬憑證，且絕不會被誤當成真憑證 */
export function mockTokenSet(userId: string): AdobeTokenSet {
  return {
    accessToken: `mock-adobe-access-${userId}`,
    refreshToken: `mock-adobe-refresh-${userId}`,
    expiresInSec: 3600,
    scope: ADOBE_SCOPE_PARAM.replace(/,/g, " "),
  };
}

export function mockProfile(userId: string): AdobeProfile {
  return { email: "mock-user@adobe.example", accountId: `mock-ims-${userId}` };
}

/** 授權碼換 token（mock 模式不出網，直接發模擬憑證） */
export async function exchangeAdobeCode(code: string, userId: string): Promise<{ tokens: AdobeTokenSet; profile: AdobeProfile }> {
  if (adobeMode() === "mock") {
    if (code !== MOCK_AUTH_CODE) throw new Error("模擬授權碼不正確");
    return { tokens: mockTokenSet(userId), profile: mockProfile(userId) };
  }
  const json = await imsTokenRequest({
    grant_type: "authorization_code",
    code,
    client_id: process.env.ADOBE_CLIENT_ID ?? "",
    client_secret: process.env.ADOBE_CLIENT_SECRET ?? "",
    redirect_uri: adobeRedirectUri(),
  });
  const tokens = parseTokenResponse(json);
  const profile = await fetchAdobeProfile(tokens.accessToken).catch(() => ({ email: null, accountId: null }));
  return { tokens, profile };
}

/** refresh token 換新 access token（mock 模式直接發新的模擬憑證） */
export async function refreshAdobeToken(refreshToken: string, userId: string): Promise<AdobeTokenSet> {
  if (adobeMode() === "mock") return mockTokenSet(userId);
  const json = await imsTokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: process.env.ADOBE_CLIENT_ID ?? "",
    client_secret: process.env.ADOBE_CLIENT_SECRET ?? "",
  });
  return parseTokenResponse(json);
}

/** 顯示用的帳號資訊（email 只為了讓使用者確認「連的是哪個 Adobe 帳號」） */
export async function fetchAdobeProfile(accessToken: string): Promise<AdobeProfile> {
  const res = await proxyFetch(`${IMS_USERINFO_URL}?client_id=${encodeURIComponent(process.env.ADOBE_CLIENT_ID ?? "")}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeoutMs: 10_000,
  });
  if (!res.ok) throw new Error(`Adobe userinfo ${res.status}`);
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    email: typeof json.email === "string" ? json.email : null,
    accountId: typeof json.userId === "string" ? json.userId : typeof json.sub === "string" ? json.sub : null,
  };
}

/**
 * 在 Adobe 端撤銷授權（中斷連結時盡力而為）。撤銷失敗不阻擋本地刪除——
 * 使用者按了「中斷連結」，本地憑證就必須消失；Adobe 端殘留由使用者在 Adobe 帳戶頁自行移除。
 */
export async function revokeAdobeToken(token: string): Promise<void> {
  if (adobeMode() === "mock") return;
  await proxyFetch(IMS_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token,
      client_id: process.env.ADOBE_CLIENT_ID ?? "",
      client_secret: process.env.ADOBE_CLIENT_SECRET ?? "",
    }).toString(),
    timeoutMs: 10_000,
  }).catch(() => undefined);
}
