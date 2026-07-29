/**
 * Fal.ai 客戶端(定案:一切以 Fal 為主,其他先不接)。
 * - 全站一律真實模式:走 fal queue REST(送出→輪詢);多模態輸出統一由 extractResult 解析。
 *   FAL_KEY 未設定不再自動退「示範模式」——生成會回明確錯誤(呼叫端自動退點)。
 * - E2E_MOCK=1 是「僅供自動化測試」的假生成旗標(CI 六套 e2e 用,不花錢即可測完整流程);
 *   正式部署絕不設定。舊的 FAL_MOCK 旗標已移除、不再生效。
 */
import { randomUUID } from "node:crypto";
import { proxyFetch } from "./http";
import type { OutputKind } from "../../shared/models";

const MOCK = process.env.E2E_MOCK === "1";
const MOCK_DELAY_MS = Number(process.env.E2E_MOCK_DELAY_MS ?? 8000);

const mockJobs = new Map<string, { doneAt: number; kind: OutputKind; prompt: string }>();

/** 測試假素材由自家伺服器供應(/api/mock-asset/*):e2e 完全離線可測、交付包也抓得到 */
function mockResultUrl(kind: OutputKind): string {
  // 對外 base 平台中立：APP_URL 沒設時退「平台注入的公開網域」，再退 localhost——避免把
  // localhost 存進 DB 變永久壞連結。通用變數 PUBLIC_DOMAIN 優先，相容舊的 RAILWAY_PUBLIC_DOMAIN
  // 後備（未設 PUBLIC_DOMAIN 時自動沿用），不再寫死任何特定平台。
  const platformDomain = process.env.PUBLIC_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;
  const fallback = platformDomain ? `https://${platformDomain}` : "";
  const base = process.env.APP_URL?.replace(/\/$/, "") || fallback || `http://localhost:${process.env.PORT ?? 3000}`;
  const path = kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
  return `${base}/api/mock-asset/${path}`;
}

export function isMockMode(): boolean {
  return MOCK;
}

/**
 * 扣點是否略過（僅 e2e 測試模式適用）：
 * E2E_MOCK=1 預設不扣點（自動化測試不燒額度）；
 * 加設 MOCK_BILLING=1 則「假生成、真扣點」：e2e 能完整驗證額度守門與帳本（auth/models 兩套的
 * 點數斷言在此模式下恢復有效）。正式模式（真實模式）永遠走扣點、不受這兩個旗標影響。
 */
export function billingBypassed(): boolean {
  return MOCK && process.env.MOCK_BILLING !== "1";
}

export async function falSubmit(endpoint: string, kind: OutputKind, input: Record<string, unknown>): Promise<{ requestId: string }> {
  if (MOCK) {
    const requestId = `mock_${randomUUID()}`;
    mockJobs.set(requestId, { doneAt: Date.now() + MOCK_DELAY_MS, kind, prompt: String(input.prompt ?? input.text ?? "") });
    return { requestId };
  }
  // 真實模式缺金鑰＝明確失敗（呼叫端自動退點），不再靜默退示範模式
  if (!process.env.FAL_KEY) {
    throw new Error("FAL_KEY 未設定：請到部署平台的服務 Variables 填入 fal.ai 金鑰後重新部署");
  }
  const res = await proxyFetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    // 送出佇列近乎即時；45s 逾時把「連線掛起」轉成明確失敗（呼叫端退點＋請重試），不無限卡住 mutation
    timeoutMs: 45_000,
  });
  if (!res.ok) throw new Error(`fal submit 失敗 ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { request_id?: unknown };
  if (typeof data.request_id !== "string" || !data.request_id.trim()) {
    throw new Error("fal submit 回應缺少 request_id");
  }
  return { requestId: data.request_id };
}

export interface FalStatusResult {
  status: "queued" | "running" | "done" | "failed";
  resultUrl?: string;
  resultText?: string;
  error?: string;
}

export function falRequestBase(endpoint: string, requestId: string): string {
  const normalized = endpoint.trim().replace(/^\/+|\/+$/g, "");
  if (
    !normalized
    || !/^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)+$/i.test(normalized)
    || normalized.split("/").includes("..")
  ) {
    throw new Error("Fal 模型端點格式不正確");
  }
  if (!requestId.trim() || requestId.includes("/") || requestId.includes("\\")) {
    throw new Error("Fal request id 格式不正確");
  }
  // Fal accepts a full model endpoint for submission, but its real queue
  // response/status/cancel URLs use the owning app namespace (first two
  // segments). Zeabur production probes confirmed, for example:
  //   fal-ai/image-editing/expression-change -> fal-ai/image-editing/requests/...
  const queueApp = normalized.split("/").slice(0, 2).join("/");
  return `https://queue.fal.run/${queueApp}/requests/${encodeURIComponent(requestId)}`;
}

export async function falStatus(endpoint: string, kind: OutputKind, requestId: string): Promise<FalStatusResult> {
  if (requestId.startsWith("mock_")) {
    if (!MOCK) {
      return {
        status: "failed",
        error: "測試生成工作不可在正式模式收尾，請重新送出真實生成",
      };
    }
    const job = mockJobs.get(requestId);
    if (job && Date.now() < job.doneAt) return { status: "running" };
    const prompt = job?.prompt ?? "";
    if (job) mockJobs.delete(requestId);
    if (kind === "text") {
      return { status: "done", resultText: `(測試假素材)正式模式將由模型實際產出。你的輸入:「${prompt.slice(0, 120)}」` };
    }
    return { status: "done", resultUrl: mockResultUrl(kind) };
  }
  // 暫時性錯誤（429 限流、5xx、網路例外）→ 回 running 讓輪詢重試，絕不誤判失敗而退點；
  // 只有明確的終局狀態（4xx 非 429、非 COMPLETED、輸出無法解析）才回 failed。
  const isTransient = (code: number): boolean => code === 408 || code === 425 || code === 429 || code >= 500;
  const base = falRequestBase(endpoint, requestId);
  let statusRes: Awaited<ReturnType<typeof proxyFetch>>;
  try {
    statusRes = await proxyFetch(`${base}/status`, { headers: { Authorization: `Key ${process.env.FAL_KEY}` }, timeoutMs: 30_000 });
  } catch (err) {
    console.warn("[fal] status 網路錯誤（暫時，續輪詢）：", err instanceof Error ? err.message : err);
    return { status: "running" };
  }
  if (!statusRes.ok) {
    if (isTransient(statusRes.status)) {
      console.warn(`[fal] status ${statusRes.status}（暫時，續輪詢）`);
      return { status: "running" };
    }
    return { status: "failed", error: `fal status ${statusRes.status}` };
  }
  const s = (await statusRes.json()) as { status: string };
  if (s.status === "IN_QUEUE") return { status: "queued" };
  if (s.status === "IN_PROGRESS") return { status: "running" };
  if (s.status !== "COMPLETED") return { status: "failed", error: `fal 狀態 ${s.status}` };
  let resultRes: Awaited<ReturnType<typeof proxyFetch>>;
  try {
    resultRes = await proxyFetch(base, { headers: { Authorization: `Key ${process.env.FAL_KEY}` }, timeoutMs: 30_000 });
  } catch (err) {
    console.warn("[fal] result 網路錯誤（暫時，續輪詢）：", err instanceof Error ? err.message : err);
    return { status: "running" };
  }
  if (!resultRes.ok) {
    if (isTransient(resultRes.status)) return { status: "running" };
    // 4xx 終局失敗：帶上回應內文片段＋常見原因，避免只剩「fal result 422」無法排查
    // （實測：image-to-image 用失效 mock 佔位圖／404 來源網址時 fal 常回 422）
    let body = "";
    try {
      body = (await resultRes.text()).slice(0, 240).trim();
    } catch {
      body = "";
    }
    const hint =
      resultRes.status === 422
        ? "——常見原因：來源圖網址無法被生成服務抓取、格式不支援或只是測試佔位圖。請改用素材庫中真實可開啟的圖片"
        : "";
    const detail = body ? `：${body}` : "";
    return { status: "failed", error: `fal result ${resultRes.status}${detail}${hint}` };
  }
  const result = (await resultRes.json()) as Record<string, unknown>;
  const extracted = extractResult(result);
  if (!extracted.url && !extracted.text) return { status: "failed", error: "無法解析模型輸出(請回報,我們會補上這個模型的解析)" };
  return { status: "done", resultUrl: extracted.url, resultText: extracted.text };
}

/**
 * fal 各模型輸出結構略異,統一解析:
 * 媒體:images[0].url / video.url / audio.url / audio_url / audio_file.url /
 *       diffusers_lora_file.url(訓練產物)
 * 文字:output / text / transcription.text / results(視覺任務物件)
 */
export function extractResult(result: Record<string, unknown>): { url?: string; text?: string } {
  const urlOf = (v: unknown): string | undefined =>
    v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string" ? (v as { url: string }).url : undefined;

  const images = result.images as Array<{ url?: string }> | undefined;
  if (images?.[0]?.url) return { url: images[0].url };
  const media =
    urlOf(result.video)
    ?? urlOf(result.audio)
    ?? urlOf(result.audio_file)
    ?? urlOf(result.image)
    ?? urlOf(result.file)
    ?? urlOf(result.model_file);
  if (media) return { url: media };
  if (typeof result.image_url === "string") return { url: result.image_url };
  if (typeof result.audio_url === "string") return { url: result.audio_url };
  if (typeof result.video_url === "string") return { url: result.video_url };
  const lora = urlOf(result.diffusers_lora_file) ?? urlOf(result.lora_file);
  if (lora) return { text: `訓練完成 ✓ LoRA 模型檔:${lora}\n(在支援 LoRA 的生成模型設定中引用此網址)`, url: undefined };

  if (typeof result.output === "string" && result.output.trim()) return { text: result.output };
  if (typeof result.text === "string" && result.text.trim()) return { text: result.text };
  const transcription = result.transcription as { text?: string } | undefined;
  if (transcription?.text) return { text: transcription.text };
  if (result.results !== undefined) {
    const r = result.results;
    return { text: typeof r === "string" ? r : JSON.stringify(r, null, 2) };
  }
  const chunks = result.chunks as Array<{ text?: string }> | undefined;
  if (chunks?.length) return { text: chunks.map((c) => c.text ?? "").join("\n") };
  return {};
}
