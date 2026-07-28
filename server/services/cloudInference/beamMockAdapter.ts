/**
 * Beam Serverless GPU 的 in-memory mock adapter（GPU-00）。
 * - 不連真實 Beam、不讀 API key、不發網路請求。
 * - status 每次輪詢推進一 tick：queued → running → done（預設 2 ticks 完成）。
 * - E2E_MOCK=1 時首次 status 即 done（立即完成，方便 e2e）。
 * - cancel 冪等：已取消／已終態再 cancel 為 no-op。
 */
import { randomUUID } from "node:crypto";
import type { CloudInferenceProvider } from "./provider";
import type { CloudOutputKind, GenerationInput, JobStatus } from "./types";

export interface BeamMockAdapterOptions {
  /** 注入環境（測試用）；預設 process.env */
  env?: NodeJS.ProcessEnv;
  /**
   * 從 queued 到 done 需要的 status 輪詢次數（不含初始 queued）。
   * 預設 2：第 1 次 status → running，第 2 次 → done。
   * E2E_MOCK=1 時忽略，改為立即 done。
   */
  ticksToDone?: number;
}

interface MockJob {
  id: string;
  input: GenerationInput;
  phase: JobStatus["status"];
  /** 已推進的 status 次數 */
  ticks: number;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  resultUrl?: string;
  resultText?: string;
  coldStartMs?: number;
  gpuSeconds?: number;
  actualCostUsd?: number;
}

const TERMINAL: ReadonlySet<JobStatus["status"]> = new Set([
  "done",
  "failed",
  "cancelled",
]);

function mockResultUrl(kind: CloudOutputKind): string {
  const platformDomain = process.env.PUBLIC_DOMAIN || process.env.RAILWAY_PUBLIC_DOMAIN;
  const fallback = platformDomain ? `https://${platformDomain}` : "";
  const base =
    process.env.APP_URL?.replace(/\/$/, "") ||
    fallback ||
    `http://localhost:${process.env.PORT ?? 3000}`;
  const path = kind === "video" ? "video" : kind === "audio" ? "audio" : "image";
  return `${base}/api/mock-asset/${path}`;
}

function toStatus(job: MockJob): JobStatus {
  const out: JobStatus = {
    status: job.phase,
    queuedAt: job.queuedAt.toISOString(),
  };
  if (job.startedAt) out.startedAt = job.startedAt.toISOString();
  if (job.completedAt) out.completedAt = job.completedAt.toISOString();
  if (job.error) out.error = job.error;
  if (job.resultUrl) out.resultUrl = job.resultUrl;
  if (job.resultText) out.resultText = job.resultText;
  if (job.coldStartMs != null) out.coldStartMs = job.coldStartMs;
  if (job.gpuSeconds != null) out.gpuSeconds = job.gpuSeconds;
  if (job.actualCostUsd != null) out.actualCostUsd = job.actualCostUsd;
  return out;
}

function completeAsDone(job: MockJob): void {
  const kind: CloudOutputKind = job.input.kind ?? "image";
  const now = new Date();
  if (!job.startedAt) job.startedAt = now;
  job.completedAt = now;
  job.phase = "done";
  // 假 metrics：固定可斷言的數值，方便單元測試
  job.coldStartMs = 120;
  job.gpuSeconds = 1.5;
  job.actualCostUsd = 0;
  if (kind === "text") {
    const prompt = job.input.prompt ?? "";
    job.resultText = `(beam_mock) 假文字結果。輸入:「${prompt.slice(0, 120)}」`;
  } else {
    job.resultUrl = mockResultUrl(kind);
  }
}

/**
 * 建立獨立 in-memory mock（每次 create 有自己的 job map，利於測試隔離）。
 * getCloudInferenceProvider 會快取與否由呼叫端決定；此函式本身無模組單例。
 */
export function createBeamMockAdapter(
  options: BeamMockAdapterOptions = {},
): CloudInferenceProvider {
  const env = options.env ?? process.env;
  const e2eImmediate = env.E2E_MOCK === "1";
  const ticksToDone = Math.max(1, options.ticksToDone ?? 2);

  const jobs = new Map<string, MockJob>();
  /** idempotencyKey → providerJobId */
  const byIdempotency = new Map<string, string>();

  return {
    name: "beam_mock",

    async submit(input: GenerationInput): Promise<{ providerJobId: string }> {
      const key = input.idempotencyKey?.trim();
      if (key) {
        const existing = byIdempotency.get(key);
        if (existing && jobs.has(existing)) {
          return { providerJobId: existing };
        }
      }

      const id = `beam_mock_${randomUUID()}`;
      const job: MockJob = {
        id,
        input,
        phase: "queued",
        ticks: 0,
        queuedAt: new Date(),
      };
      jobs.set(id, job);
      if (key) byIdempotency.set(key, id);
      return { providerJobId: id };
    },

    async status(providerJobId: string): Promise<JobStatus> {
      const job = jobs.get(providerJobId);
      if (!job) {
        return {
          status: "failed",
          error: `beam_mock: 未知 job ${providerJobId}`,
        };
      }

      if (TERMINAL.has(job.phase)) {
        return toStatus(job);
      }

      if (e2eImmediate) {
        completeAsDone(job);
        return toStatus(job);
      }

      // 推進狀態機：queued → running → … → done
      job.ticks += 1;
      if (job.phase === "queued") {
        job.phase = "running";
        job.startedAt = new Date();
      }
      if (job.ticks >= ticksToDone) {
        completeAsDone(job);
      }
      return toStatus(job);
    },

    async cancel(providerJobId: string): Promise<void> {
      const job = jobs.get(providerJobId);
      if (!job) return; // 未知 id：冪等 no-op
      if (TERMINAL.has(job.phase)) return; // 已終態：冪等 no-op
      job.phase = "cancelled";
      job.completedAt = new Date();
      if (!job.startedAt) job.startedAt = job.completedAt;
    },
  };
}

/** 測試／除錯用：重置需透過 createBeamMockAdapter 新實例；此匯出僅文件意圖。 */
export const BEAM_MOCK_PROVIDER_NAME = "beam_mock" as const;
