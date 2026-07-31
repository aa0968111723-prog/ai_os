/**
 * Adobe 真實 Client（#224 PR3，real 模式）。
 *
 * 現況與邊界（刻意寫死在程式裡，不用註解粉飾）：
 * - Adobe 的影像服務是「提交工作 → 拿一個狀態網址 → 輪詢」的非同步形狀，本檔如實照做；
 *   工作 id 直接把狀態網址編碼進去（real:<base64url(href)>），伺服器不需要另外存工作狀態。
 * - 目前只接「端點與參數形狀已確定」的兩種操作：去背（sensei/cutout）與自動調色（lrService/autoTone）。
 *   其餘操作（裁切／縮放／微調）與「瀏覽 Adobe 帳號素材」「時間軸算圖」在 real 模式一律
 *   丟 AdobeUnsupportedError，而不是送出一個猜出來的請求——猜錯的後果是動到使用者自己的雲端資產。
 *   這幾項待 Adobe Developer Console 憑證與 product profile 核准後（PR6）依實際文件補上；
 *   在那之前 mock 模式已能完整驗證上層資料流，capabilities 也誠實回報 false，UI 不會給出做不到的按鈕。
 * - 時間軸交付在本系統本來就有另一條更好的路：PR4 的 FCPXML／Premiere XML／剪映草稿匯出，
 *   由使用者在自己的剪輯軟體裡接手，不必等 Adobe 開放算圖 API。
 */
import { proxyFetch } from "../http";
import type { AdobePhotoEditRequest, AdobeTimeline } from "../../../shared/adobe";
import { AdobeAuthError, AdobeUnsupportedError, type AdobeAsset, type AdobeCapabilities, type AdobeClient, type AdobeJob } from "./types";

const CUTOUT_URL = "https://image.adobe.io/sensei/cutout";
const AUTO_TONE_URL = "https://image.adobe.io/lrService/autoTone";
const REQUEST_TIMEOUT_MS = 20_000;

/** 工作 id ⇄ 狀態網址：純函式，避免呼叫端自行拼字串（也讓格式錯誤在測試就被抓到） */
export function encodeJobId(statusHref: string): string {
  return `real:${Buffer.from(statusHref, "utf8").toString("base64url")}`;
}

export function decodeJobId(jobId: string): string {
  if (!jobId.startsWith("real:")) throw new Error("Adobe 工作 id 格式不正確");
  const href = Buffer.from(jobId.slice("real:".length), "base64url").toString("utf8");
  if (!href.startsWith("https://")) throw new Error("Adobe 工作 id 格式不正確");
  return href;
}

/** Adobe 的工作狀態字彙 → 本系統的四態 */
export function mapJobStatus(raw: string): AdobeJob["status"] {
  switch (raw) {
    case "succeeded":
    case "success":
      return "succeeded";
    case "failed":
    case "error":
      return "failed";
    case "running":
    case "processing":
      return "running";
    default:
      return "queued";
  }
}

export class RealAdobeClient implements AdobeClient {
  readonly mode = "real" as const;
  /** 誠實回報：未接上的能力回 false，前端據此隱藏按鈕而不是讓人按了才失敗 */
  readonly capabilities: AdobeCapabilities = { photoEdit: true, timelineRender: false, assetBrowse: false };

  async listAssets(): Promise<AdobeAsset[]> {
    throw new AdobeUnsupportedError(
      "real 模式尚未接上 Adobe 素材瀏覽——請直接提供素材在 Adobe 雲端的路徑，或先以 mock 模式驗流程",
    );
  }

  async editPhoto(accessToken: string, request: AdobePhotoEditRequest): Promise<AdobeJob> {
    if (request.operations.length !== 1) {
      throw new AdobeUnsupportedError("real 模式目前一次只支援一項修圖操作（多步串接待 PR6 接上正式 API）");
    }
    const [operation] = request.operations;
    const output = {
      href: request.outputName ?? `${request.assetId}-edited.${request.outputFormat}`,
      storage: "adobe",
      type: mimeOf(request.outputFormat),
    };
    if (operation.op === "remove_background") {
      return this.submit(accessToken, CUTOUT_URL, {
        input: { href: request.assetId, storage: "adobe" },
        output,
      });
    }
    if (operation.op === "auto_tone") {
      return this.submit(accessToken, AUTO_TONE_URL, {
        inputs: { href: request.assetId, storage: "adobe" },
        outputs: [output],
      });
    }
    throw new AdobeUnsupportedError(
      `real 模式尚未接上「${operation.op}」——待 Adobe 憑證與 product profile 核准後補上（可先用 mock 模式驗流程）`,
    );
  }

  async renderTimeline(_accessToken: string, _timeline: AdobeTimeline): Promise<AdobeJob> {
    throw new AdobeUnsupportedError(
      "Adobe 未提供公開的時間軸算圖 API——請改用本系統的剪輯交付（FCPXML／Premiere XML／剪映草稿）在剪輯軟體內完成",
    );
  }

  async getJob(accessToken: string, jobId: string): Promise<AdobeJob> {
    const res = await this.authorized(accessToken, decodeJobId(jobId), { method: "GET" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const outputs = Array.isArray(json.outputs) ? (json.outputs as Array<Record<string, unknown>>) : [];
    const rawStatus = String(json.status ?? outputs[0]?.status ?? "pending");
    const status = mapJobStatus(rawStatus);
    const now = new Date().toISOString();
    return {
      id: jobId,
      kind: "photo",
      status,
      progress: status === "succeeded" ? 100 : status === "running" ? 50 : 0,
      resultAsset: status === "succeeded" ? outputAsset(outputs[0]) : undefined,
      error: status === "failed" ? String(json.errors ?? json.message ?? "Adobe 工作失敗") : undefined,
      createdAt: typeof json.created === "string" ? json.created : now,
      updatedAt: now,
    };
  }

  private async submit(accessToken: string, url: string, body: unknown): Promise<AdobeJob> {
    const res = await this.authorized(accessToken, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const href = statusHref(json);
    if (!href) throw new Error("Adobe 未回發工作狀態網址");
    const now = new Date().toISOString();
    return { id: encodeJobId(href), kind: "photo", status: "queued", progress: 0, createdAt: now, updatedAt: now };
  }

  /** 所有呼叫共用：Bearer ＋ x-api-key（Adobe 兩者都要），401/403 轉成可辨識的授權錯誤 */
  private async authorized(accessToken: string, url: string, init: RequestInit): Promise<Response> {
    const res = await proxyFetch(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${accessToken}`,
        "x-api-key": process.env.ADOBE_CLIENT_ID ?? "",
      },
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    if (res.status === 401 || res.status === 403) {
      throw new AdobeAuthError("Adobe 拒絕了這次請求（授權可能已失效或權限不足）——請重新連結 Adobe 帳號");
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Adobe API ${res.status}：${text.slice(0, 300)}`);
    }
    return res;
  }
}

function statusHref(json: Record<string, unknown>): string | null {
  const links = json._links as { self?: { href?: unknown } } | undefined;
  const href = links?.self?.href;
  if (typeof href === "string" && href.startsWith("https://")) return href;
  return null;
}

function outputAsset(output: Record<string, unknown> | undefined): AdobeAsset | undefined {
  if (!output) return undefined;
  const links = output._links as { self?: { href?: unknown } } | undefined;
  const href = typeof links?.self?.href === "string" ? links.self.href : undefined;
  return {
    id: href ?? "adobe-output",
    name: typeof output.name === "string" ? output.name : "Adobe 輸出",
    mime: typeof output.type === "string" ? output.type : "application/octet-stream",
    previewUrl: href,
  };
}

function mimeOf(format: AdobePhotoEditRequest["outputFormat"]): string {
  return format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
}
