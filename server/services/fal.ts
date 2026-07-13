/**
 * Fal.ai 客戶端(定案:一切以 Fal 為主,其他先不接)。
 * - 無 FAL_KEY 或 FAL_MOCK=1 → 假生成模式:不花錢即可測完整流程(含圖/影/音/文字四種輸出)。
 * - 真模式走 fal queue REST(送出→輪詢);多模態輸出統一由 extractResult 解析。
 */
import { randomUUID } from "node:crypto";
import { proxyFetch } from "./http";
import type { OutputKind } from "../../shared/models";

const MOCK = !process.env.FAL_KEY || process.env.FAL_MOCK === "1";
const MOCK_DELAY_MS = Number(process.env.FAL_MOCK_DELAY_MS ?? 8000);

const mockJobs = new Map<string, { doneAt: number; kind: OutputKind; prompt: string }>();

/** 假素材由自家伺服器供應(/api/mock-asset/*):完全離線可測、交付包也抓得到 */
function mockResultUrl(kind: OutputKind): string {
  // APP_URL 沒設時退 Railway 內建的公開網域，再退 localhost——避免把 localhost 存進 DB 變永久壞連結
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "";
  const base = process.env.APP_URL?.replace(/\/$/, "") || railway || `http://localhost:${process.env.PORT ?? 3000}`;
  const path = kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
  return `${base}/api/mock-asset/${path}`;
}

export function isMockMode(): boolean {
  return MOCK;
}

export async function falSubmit(endpoint: string, kind: OutputKind, input: Record<string, unknown>): Promise<{ requestId: string }> {
  if (MOCK) {
    const requestId = `mock_${randomUUID()}`;
    mockJobs.set(requestId, { doneAt: Date.now() + MOCK_DELAY_MS, kind, prompt: String(input.prompt ?? input.text ?? "") });
    return { requestId };
  }
  const res = await proxyFetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
    // 送出佇列近乎即時；45s 逾時把「連線掛起」轉成明確失敗（呼叫端退點＋請重試），不無限卡住 mutation
    timeoutMs: 45_000,
  });
  if (!res.ok) throw new Error(`fal submit 失敗 ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { request_id: string };
  return { requestId: data.request_id };
}

export interface FalStatusResult {
  status: "queued" | "running" | "done" | "failed";
  resultUrl?: string;
  resultText?: string;
  error?: string;
}

export async function falStatus(endpoint: string, kind: OutputKind, requestId: string): Promise<FalStatusResult> {
  if (requestId.startsWith("mock_")) {
    const job = mockJobs.get(requestId);
    if (job && Date.now() < job.doneAt) return { status: "running" };
    const prompt = job?.prompt ?? "";
    if (job) mockJobs.delete(requestId);
    if (kind === "text") {
      return { status: "done", resultText: `(假生成示範)真實模式將由模型產出。你的輸入:「${prompt.slice(0, 120)}」` };
    }
    return { status: "done", resultUrl: mockResultUrl(kind) };
  }
  // 暫時性錯誤（429 限流、5xx、網路例外）→ 回 running 讓輪詢重試，絕不誤判失敗而退點；
  // 只有明確的終局狀態（4xx 非 429、非 COMPLETED、輸出無法解析）才回 failed。
  const isTransient = (code: number): boolean => code === 429 || code >= 500;
  // fal queue 的 status/result 只認「owner/alias」兩段 app id——子路徑模型（如 fast-sdxl/image-to-image）
  // 用全路徑會 405（實測）。送出用全路徑、查詢用兩段。
  const appId = endpoint.split("/").slice(0, 2).join("/");
  const base = `https://queue.fal.run/${appId}/requests/${requestId}`;
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
    return { status: "failed", error: `fal result ${resultRes.status}` };
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
  const media = urlOf(result.video) ?? urlOf(result.audio) ?? urlOf(result.audio_file) ?? urlOf(result.image);
  if (media) return { url: media };
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
