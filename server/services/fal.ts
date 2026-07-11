/**
 * Fal.ai 客戶端（定案：一切以 Fal 為主，其他先不接）。
 * - 無 FAL_KEY 或 FAL_MOCK=1 → 假生成模式：不花錢即可測完整流程（開發測試優先）。
 * - 真模式走 fal queue REST（送出→輪詢），本機開發不需要 webhook（盲點掃描定案）。
 */
import { randomUUID } from "node:crypto";
import { proxyFetch } from "./http";

const MOCK = !process.env.FAL_KEY || process.env.FAL_MOCK === "1";
const MOCK_DELAY_MS = Number(process.env.FAL_MOCK_DELAY_MS ?? 8000);

const mockJobs = new Map<string, { doneAt: number; kind: string }>();

/** 假素材由自家伺服器供應（/api/mock-asset/*）：完全離線可測、交付包也抓得到 */
function mockResultUrl(kind: string): string {
  const base = process.env.APP_URL?.replace(/\/$/, "") || `http://localhost:${process.env.PORT ?? 3000}`;
  return `${base}/api/mock-asset/${kind === "video" ? "video" : "image"}`;
}

export function isMockMode(): boolean {
  return MOCK;
}

export async function falSubmit(modelId: string, kind: string, input: Record<string, unknown>): Promise<{ requestId: string }> {
  if (MOCK) {
    const requestId = `mock_${randomUUID()}`;
    mockJobs.set(requestId, { doneAt: Date.now() + MOCK_DELAY_MS, kind });
    return { requestId };
  }
  const res = await proxyFetch(`https://queue.fal.run/${modelId}`, {
    method: "POST",
    headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`fal submit 失敗 ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { request_id: string };
  return { requestId: data.request_id };
}

export interface FalStatusResult {
  status: "queued" | "running" | "done" | "failed";
  resultUrl?: string;
  error?: string;
}

export async function falStatus(modelId: string, kind: string, requestId: string): Promise<FalStatusResult> {
  if (requestId.startsWith("mock_")) {
    const job = mockJobs.get(requestId);
    if (!job) return { status: "done", resultUrl: mockResultUrl(kind) };
    if (Date.now() < job.doneAt) return { status: "running" };
    mockJobs.delete(requestId);
    return { status: "done", resultUrl: mockResultUrl(job.kind) };
  }
  const base = `https://queue.fal.run/${modelId}/requests/${requestId}`;
  const statusRes = await proxyFetch(`${base}/status`, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  if (!statusRes.ok) return { status: "failed", error: `fal status ${statusRes.status}` };
  const s = (await statusRes.json()) as { status: string };
  if (s.status === "IN_QUEUE") return { status: "queued" };
  if (s.status === "IN_PROGRESS") return { status: "running" };
  if (s.status !== "COMPLETED") return { status: "failed", error: `fal 狀態 ${s.status}` };
  const resultRes = await proxyFetch(base, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  if (!resultRes.ok) return { status: "failed", error: `fal result ${resultRes.status}` };
  const result = (await resultRes.json()) as Record<string, unknown>;
  return { status: "done", resultUrl: extractUrl(result) };
}

/** fal 各模型輸出結構略異：images[0].url 或 video.url */
function extractUrl(result: Record<string, unknown>): string | undefined {
  const images = result.images as Array<{ url?: string }> | undefined;
  if (images?.[0]?.url) return images[0].url;
  const video = result.video as { url?: string } | undefined;
  if (video?.url) return video.url;
  return undefined;
}
