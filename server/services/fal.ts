/**
 * Fal.ai 客戶端（定案：一切以 Fal 為主，其他先不接）。
 * - 無 FAL_KEY 或 FAL_MOCK=1 → 假生成模式：不花錢即可測完整流程（開發測試優先）。
 * - 真模式走 fal queue REST（送出→輪詢），本機開發不需要 webhook（盲點掃描定案）。
 */
import { randomUUID } from "node:crypto";

const MOCK = !process.env.FAL_KEY || process.env.FAL_MOCK === "1";
const MOCK_DELAY_MS = 8_000;

const mockJobs = new Map<string, { doneAt: number; kind: string }>();

const MOCK_RESULTS: Record<string, string> = {
  image: "https://picsum.photos/seed/aidirector/1024/576",
  video: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4",
};

export function isMockMode(): boolean {
  return MOCK;
}

export async function falSubmit(modelId: string, kind: string, input: Record<string, unknown>): Promise<{ requestId: string }> {
  if (MOCK) {
    const requestId = `mock_${randomUUID()}`;
    mockJobs.set(requestId, { doneAt: Date.now() + MOCK_DELAY_MS, kind });
    return { requestId };
  }
  const res = await fetch(`https://queue.fal.run/${modelId}`, {
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
    if (!job) return { status: "done", resultUrl: MOCK_RESULTS[kind] ?? MOCK_RESULTS.image };
    if (Date.now() < job.doneAt) return { status: "running" };
    mockJobs.delete(requestId);
    return { status: "done", resultUrl: MOCK_RESULTS[job.kind] ?? MOCK_RESULTS.image };
  }
  const base = `https://queue.fal.run/${modelId}/requests/${requestId}`;
  const statusRes = await fetch(`${base}/status`, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
  if (!statusRes.ok) return { status: "failed", error: `fal status ${statusRes.status}` };
  const s = (await statusRes.json()) as { status: string };
  if (s.status === "IN_QUEUE") return { status: "queued" };
  if (s.status === "IN_PROGRESS") return { status: "running" };
  if (s.status !== "COMPLETED") return { status: "failed", error: `fal 狀態 ${s.status}` };
  const resultRes = await fetch(base, { headers: { Authorization: `Key ${process.env.FAL_KEY}` } });
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
