/**
 * Native Gemini (Google AI) client. The key is read only from process.env.GEMINI_API_KEY
 * and is sent as the x-goog-api-key header. It is never logged, returned, or stored.
 *
 * Image: gemini-2.5-flash-image (generate + reference/edit).
 * Video: gemini-omni-flash (shortest clip). Long-running ops are polled.
 */
import { randomUUID } from "node:crypto";
import { proxyFetch } from "./http";
import type { FalStatusResult } from "./fal";
import type { OutputKind } from "../../shared/models";
import { parseStoredResultUrl, readStoredFile, saveBuffer } from "./storage";

const GEMINI_API_HOST = (process.env.GEMINI_API_HOST?.trim() || "https://generativelanguage.googleapis.com").replace(/\/$/, "");
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.5-flash-image";
const OMNI_MODEL = process.env.GEMINI_OMNI_MODEL?.trim() || "gemini-omni-flash";
const SHORTEST_VIDEO_SECONDS = 4;

const jobs = new Map<string, GeminiJob>();

type GeminiJob =
  | { kind: OutputKind; status: "running" | "failed"; error?: string; startedAt: number }
  | { kind: OutputKind; status: "done"; resultUrl: string; mime: string; startedAt: number };

export function geminiApiKeyConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GEMINI_API_KEY?.trim());
}

function geminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key) {
    throw new GeminiUnavailableError("GEMINI_API_KEY 未設定");
  }
  return key;
}

export class GeminiUnavailableError extends Error {
  readonly code = "BLOCKED_BY_EXTERNAL_DEPENDENCY";
  constructor(message: string) {
    super(message);
    this.name = "GeminiUnavailableError";
  }
}

/** Strip secrets from any diagnostic text before it can reach logs or traces. */
export function redactGeminiSecrets(text: string): string {
  return text
    .replace(/x-goog-api-key\s*[:=]\s*\S+/gi, "x-goog-api-key=[redacted]")
    .replace(/([?&]key=)[^&\s]+/gi, "$1[redacted]")
    .replace(/GEMINI_API_KEY\s*[:=]\s*\S+/gi, "GEMINI_API_KEY=[redacted]")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]");
}

function geminiHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": geminiApiKey(),
  };
}

async function geminiFetch(path: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const url = `${GEMINI_API_HOST}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = { ...geminiHeaders(), ...(init.headers as Record<string, string> | undefined) };
  const { timeoutMs, ...rest } = init;
  return proxyFetch(url, { ...rest, headers, timeoutMs: timeoutMs ?? 60_000 });
}

async function readError(res: Response): Promise<string> {
  const raw = await res.text().catch(() => "");
  return redactGeminiSecrets(raw.slice(0, 400) || `HTTP ${res.status}`);
}

export function isGeminiModelId(modelId: string): boolean {
  return modelId.startsWith("google/gemini") || modelId.startsWith("gemini-");
}

function imageModelFor(input: Record<string, unknown>): string {
  return typeof input.geminiModel === "string" && input.geminiModel.trim()
    ? input.geminiModel.trim()
    : IMAGE_MODEL;
}

function videoModelFor(input: Record<string, unknown>): string {
  return typeof input.geminiModel === "string" && input.geminiModel.trim()
    ? input.geminiModel.trim()
    : OMNI_MODEL;
}

async function fetchSourceBytes(sourceUrl: string): Promise<{ mime: string; data: string }> {
  const stored = parseStoredResultUrl(sourceUrl);
  if (stored) {
    const buf = await readStoredFile(stored.storagePath);
    if (buf.length < 32) throw new Error("參考圖內容為空");
    return { mime: stored.mime || "image/png", data: buf.toString("base64") };
  }
  const res = await proxyFetch(sourceUrl, { timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`無法讀取參考圖（${res.status}）`);
  const mime = (res.headers.get("content-type") ?? "image/png").split(";")[0].trim() || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) throw new Error("參考圖內容為空");
  return { mime, data: buf.toString("base64") };
}

function extractInlineMedia(payload: unknown): { mime: string; bytes: Buffer } | null {
  if (!payload || typeof payload !== "object") return null;
  const walk = (value: unknown): { mime: string; bytes: Buffer } | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    const inline = (row.inlineData ?? row.inline_data) as Record<string, unknown> | undefined;
    if (inline && typeof inline.data === "string") {
      return {
        mime: typeof inline.mimeType === "string" ? inline.mimeType : "image/png",
        bytes: Buffer.from(inline.data, "base64"),
      };
    }
    if (typeof row.bytesBase64Encoded === "string") {
      return {
        mime: typeof row.mimeType === "string" ? row.mimeType : "video/mp4",
        bytes: Buffer.from(row.bytesBase64Encoded, "base64"),
      };
    }
    for (const child of Object.values(row)) {
      if (Array.isArray(child)) {
        for (const item of child) {
          const hit = walk(item);
          if (hit) return hit;
        }
      } else {
        const hit = walk(child);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(payload);
}

function extractOperationName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const name = (payload as { name?: unknown }).name;
  return typeof name === "string" && name.includes("operations/") ? name : null;
}

async function persistMedia(kind: OutputKind, mime: string, bytes: Buffer): Promise<string> {
  const stored = await saveBuffer(bytes, mime || (kind === "video" ? "video/mp4" : "image/png"));
  return `stored:${stored.storagePath}|${mime}|${stored.sizeBytes}`;
}

async function generateImage(input: Record<string, unknown>): Promise<string> {
  const prompt = String(input.prompt ?? input.text ?? "").trim();
  if (!prompt) throw new Error("缺少生成提示詞");
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  const sourceUrl = typeof input.image_url === "string" ? input.image_url : typeof input.sourceUrl === "string" ? input.sourceUrl : "";
  if (sourceUrl) {
    const source = await fetchSourceBytes(sourceUrl);
    parts.unshift({ inlineData: { mimeType: source.mime, data: source.data } });
  }
  const res = await geminiFetch(`/v1beta/models/${encodeURIComponent(imageModelFor(input))}:generateContent`, {
    method: "POST",
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
    timeoutMs: 90_000,
  });
  if (!res.ok) throw new Error(`Gemini Image 失敗：${await readError(res)}`);
  const body = await res.json();
  const media = extractInlineMedia(body);
  if (!media) throw new Error("Gemini Image 沒有回傳圖片");
  return persistMedia("image", media.mime, media.bytes);
}

async function generateOmniVideo(input: Record<string, unknown>): Promise<string> {
  const prompt = String(input.prompt ?? input.text ?? "").trim();
  if (!prompt) throw new Error("缺少影片提示詞");
  const parts: Array<Record<string, unknown>> = [{ text: `${prompt}\nDuration: ${SHORTEST_VIDEO_SECONDS} seconds.` }];
  const sourceUrl = typeof input.image_url === "string" ? input.image_url : typeof input.sourceUrl === "string" ? input.sourceUrl : "";
  if (sourceUrl) {
    const source = await fetchSourceBytes(sourceUrl);
    parts.unshift({ inlineData: { mimeType: source.mime, data: source.data } });
  }
  const model = videoModelFor(input);
  const res = await geminiFetch(`/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["VIDEO"], durationSeconds: SHORTEST_VIDEO_SECONDS },
    }),
    timeoutMs: 120_000,
  });
  if (res.status === 404 || res.status === 400) {
    return generateVeoFallback(input, sourceUrl);
  }
  if (!res.ok) throw new Error(`Gemini Omni 失敗：${await readError(res)}`);
  const body = await res.json();
  const op = extractOperationName(body);
  if (op) return pollOperation(op);
  const media = extractInlineMedia(body);
  if (!media) throw new Error("Gemini Omni 沒有回傳影片");
  return persistMedia("video", media.mime || "video/mp4", media.bytes);
}

async function generateVeoFallback(input: Record<string, unknown>, sourceUrl: string): Promise<string> {
  const prompt = String(input.prompt ?? input.text ?? "").trim();
  const instance: Record<string, unknown> = { prompt };
  if (sourceUrl) {
    const source = await fetchSourceBytes(sourceUrl);
    instance.image = { bytesBase64Encoded: source.data, mimeType: source.mime };
  }
  const res = await geminiFetch("/v1beta/models/veo-3.1-fast-generate-preview:predictLongRunning", {
    method: "POST",
    body: JSON.stringify({
      instances: [instance],
      parameters: { durationSeconds: SHORTEST_VIDEO_SECONDS, aspectRatio: "16:9" },
    }),
    timeoutMs: 60_000,
  });
  if (!res.ok) throw new Error(`Gemini 影片失敗：${await readError(res)}`);
  const body = await res.json();
  const op = extractOperationName(body);
  if (!op) {
    const media = extractInlineMedia(body);
    if (!media) throw new Error("Gemini 影片沒有回傳 operation");
    return persistMedia("video", media.mime || "video/mp4", media.bytes);
  }
  return pollOperation(op);
}

async function pollOperation(name: string): Promise<string> {
  const path = name.startsWith("operations/") ? `/v1beta/${name}` : `/v1beta/operations/${name}`;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const res = await geminiFetch(path, { method: "GET", timeoutMs: 30_000 });
    if (!res.ok) throw new Error(`Gemini operation 失敗：${await readError(res)}`);
    const body = await res.json() as { done?: boolean; error?: { message?: string } };
    if (body.error?.message) throw new Error(redactGeminiSecrets(body.error.message));
    if (body.done) {
      const media = extractInlineMedia(body);
      if (!media) throw new Error("Gemini operation 完成但沒有媒體");
      return persistMedia("video", media.mime || "video/mp4", media.bytes);
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error("Gemini 影片等候逾時");
}

export async function geminiSubmit(
  kind: OutputKind,
  input: Record<string, unknown>,
): Promise<{ requestId: string }> {
  if (!geminiApiKeyConfigured()) {
    throw new GeminiUnavailableError("GEMINI_API_KEY 未設定");
  }
  const requestId = `gemini_${randomUUID()}`;
  jobs.set(requestId, { kind, status: "running", startedAt: Date.now() });
  void (async () => {
    try {
      const resultUrl = kind === "video" ? await generateOmniVideo(input) : await generateImage(input);
      jobs.set(requestId, {
        kind,
        status: "done",
        resultUrl,
        mime: kind === "video" ? "video/mp4" : "image/png",
        startedAt: Date.now(),
      });
    } catch (err) {
      const message = redactGeminiSecrets(err instanceof Error ? err.message : String(err));
      console.warn("[gemini] 生成失敗：", message);
      jobs.set(requestId, { kind, status: "failed", error: message, startedAt: Date.now() });
    }
  })();
  return { requestId };
}

export function geminiStatus(requestId: string): FalStatusResult {
  if (!requestId.startsWith("gemini_")) {
    return { status: "failed", error: "不是 Gemini 生成工作" };
  }
  const job = jobs.get(requestId);
  if (!job) return { status: "failed", error: "找不到這筆 Gemini 生成（程序可能已重啟，請重試）" };
  if (job.status === "running") return { status: "running" };
  if (job.status === "failed") return { status: "failed", error: job.error ?? "Gemini 生成失敗" };
  if (job.status === "done") return { status: "done", resultUrl: job.resultUrl };
  return { status: "failed", error: "Gemini 生成狀態不明" };
}

export function parseStoredGeminiUrl(resultUrl: string): { storagePath: string; mime: string; sizeBytes: number } | null {
  return parseStoredResultUrl(resultUrl);
}
