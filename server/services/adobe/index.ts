/**
 * Adobe 服務層對外門面（#224 PR1–PR3）：router、Express callback 與（未來）代理步驟都只碰這裡。
 *
 * 這一層負責「把連結狀態變成可用的 access token」，並保證三件事：
 * - 一律使用者自己的帳號：每個函式第一個參數都是 userId，沒有站方共用憑證的路徑；
 * - token 該續期就續期（到期前 5 分鐘換新），Adobe 說授權失效就把連結標記 error 引導重連；
 * - mock/real 差異只存在於 client 實作，上層拿到的形狀完全一致。
 */
import type { AdobeConnectionView, AdobePhotoEditRequest, AdobeTimeline } from "../../../shared/adobe";
import { ADOBE_SCOPES } from "../../../shared/adobe";
import { MockAdobeClient } from "./mockAdobeClient";
import { RealAdobeClient } from "./adobeClient";
import {
  adobeMode,
  exchangeAdobeCode,
  isAdobeConfigured,
  refreshAdobeToken,
  revokeAdobeToken,
} from "./oauth";
import {
  decryptOrMarkError,
  findAdobeAccount,
  isAccessTokenUsable,
  markAdobeError,
  removeAdobeAccount,
  saveAdobeAccount,
  touchAdobeUsage,
  updateAdobeTokens,
  type ExternalAccountRow,
} from "./tokenService";
import { AdobeAuthError, type AdobeAsset, type AdobeClient, type AdobeJob } from "./types";

export { AdobeAuthError, AdobeUnsupportedError } from "./types";
export type { AdobeAsset, AdobeJob } from "./types";

/** 尚未連結 Adobe（呼叫端據此顯示「去連結」CTA，而不是當成系統錯誤） */
export class AdobeNotConnectedError extends Error {
  constructor(message = "尚未連結 Adobe 帳號——請到「連接資料來源」完成連結") {
    super(message);
    this.name = "AdobeNotConnectedError";
  }
}

/** 需要重新授權（憑證失效、解密失敗、或連結建立時的模式與現在不同） */
export class AdobeReauthRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdobeReauthRequiredError";
  }
}

let mockClient: MockAdobeClient | null = null;
let realClient: RealAdobeClient | null = null;

/** 依目前模式取得 client（mock 需保留同一實例——工作狀態存在它的記憶體裡） */
export function getAdobeClient(): AdobeClient {
  if (adobeMode() === "real") {
    realClient ??= new RealAdobeClient();
    return realClient;
  }
  mockClient ??= new MockAdobeClient();
  return mockClient;
}

/** 測試用：重設 client 單例（切換 ADOBE_MODE 後不留舊實例） */
export function resetAdobeClients(): void {
  mockClient = null;
  realClient = null;
}

/* ────────────────────────── 連結狀態 ────────────────────────── */

export async function adobeConnectionView(userId: string): Promise<AdobeConnectionView> {
  const mode = adobeMode();
  const client = getAdobeClient();
  const row = await findAdobeAccount(userId);
  // 模式切換後的舊連結不可沿用（mock 憑證不能拿去打 Adobe，反之亦然）——當成未連結並提示重連
  const staleMode = !!row && row.mode !== mode;
  return {
    mode,
    configured: isAdobeConfigured(),
    connected: !!row && !staleMode,
    email: row?.accountEmail ?? null,
    status: staleMode ? "error" : row?.status ?? null,
    lastError: staleMode
      ? `這條連結是在 ${row?.mode === "mock" ? "模擬" : "正式"}模式建立的，目前站方為${mode === "mock" ? "模擬" : "正式"}模式——請重新連結`
      : row?.lastError ?? null,
    scopes: ADOBE_SCOPES,
    capabilities: client.capabilities,
    connectedAt: row?.createdAt?.toISOString() ?? null,
    lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
  };
}

/** OAuth callback 收尾：換 token 並落庫（mock 與 real 同一條路徑） */
export async function completeAdobeConnection(userId: string, code: string): Promise<{ email: string | null }> {
  const { tokens, profile } = await exchangeAdobeCode(code, userId);
  await saveAdobeAccount(userId, tokens, profile, adobeMode());
  return { email: profile.email };
}

/** 中斷連結：盡力在 Adobe 端撤銷，本地紀錄一定刪掉（冪等） */
export async function disconnectAdobe(userId: string): Promise<void> {
  const row = await findAdobeAccount(userId);
  if (row) {
    const refresh = row.refreshTokenEnc ? await decryptOrMarkError(row, "refresh") : null;
    if (refresh) await revokeAdobeToken(refresh);
  }
  await removeAdobeAccount(userId);
}

/* ────────────────────────── token 解析 ────────────────────────── */

async function resolveAccessToken(row: ExternalAccountRow): Promise<string> {
  if (row.mode !== adobeMode()) {
    throw new AdobeReauthRequiredError("站方 Adobe 模式已變更——請重新連結 Adobe 帳號");
  }
  if (row.status === "error") {
    throw new AdobeReauthRequiredError(row.lastError || "Adobe 授權已失效——請重新連結 Adobe 帳號");
  }
  if (isAccessTokenUsable(row)) {
    const token = await decryptOrMarkError(row, "access");
    if (token) return token;
    throw new AdobeReauthRequiredError("Adobe 憑證解密失敗——請重新連結 Adobe 帳號");
  }
  const refreshToken = await decryptOrMarkError(row, "refresh");
  if (!refreshToken) {
    await markAdobeError(row.id, "Adobe 授權已過期且沒有可用的更新憑證——請重新連結");
    throw new AdobeReauthRequiredError("Adobe 授權已過期——請重新連結 Adobe 帳號");
  }
  try {
    const tokens = await refreshAdobeToken(refreshToken, row.userId);
    await updateAdobeTokens(row.id, tokens);
    return tokens.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Adobe 授權更新失敗";
    await markAdobeError(row.id, message);
    throw new AdobeReauthRequiredError(`${message}——請重新連結 Adobe 帳號`);
  }
}

/**
 * 所有 Adobe 呼叫的統一入口：解析 token → 執行 → 記錄使用時間；
 * Adobe 明確回授權錯誤時把連結標記 error（下次進頁面就看得到「需重新連結」）。
 */
async function withAdobe<T>(userId: string, run: (client: AdobeClient, accessToken: string) => Promise<T>): Promise<T> {
  const row = await findAdobeAccount(userId);
  if (!row) throw new AdobeNotConnectedError();
  const accessToken = await resolveAccessToken(row);
  try {
    const result = await run(getAdobeClient(), accessToken);
    void touchAdobeUsage(row.id);
    return result;
  } catch (err) {
    if (err instanceof AdobeAuthError) {
      await markAdobeError(row.id, err.message);
      throw new AdobeReauthRequiredError(err.message);
    }
    throw err;
  }
}

/* ────────────────────────── 工具（供 router／代理呼叫） ────────────────────────── */

/** 單次列素材上限：選素材是「挑這一次要用的」，不是把整個雲端同步進來 */
export const ADOBE_ASSET_PAGE_SIZE = 30;

export function listAdobeAssets(userId: string, input: { query?: string; limit?: number } = {}): Promise<AdobeAsset[]> {
  const limit = Math.min(Math.max(input.limit ?? ADOBE_ASSET_PAGE_SIZE, 1), ADOBE_ASSET_PAGE_SIZE);
  return withAdobe(userId, (client, token) => client.listAssets(token, { query: input.query, limit }));
}

export function startAdobePhotoEdit(userId: string, request: AdobePhotoEditRequest): Promise<AdobeJob> {
  return withAdobe(userId, (client, token) => client.editPhoto(token, request));
}

export function startAdobeTimelineRender(userId: string, timeline: AdobeTimeline): Promise<AdobeJob> {
  return withAdobe(userId, (client, token) => client.renderTimeline(token, timeline));
}

export function getAdobeJob(userId: string, jobId: string): Promise<AdobeJob> {
  return withAdobe(userId, (client, token) => client.getJob(token, jobId));
}
