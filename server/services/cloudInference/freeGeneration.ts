/**
 * GPU-01：免費圖片生成 PoC（CloudInference mock 路徑）。
 *
 * - 透過 CloudInferenceProvider（beam_mock only）submit + 同步輪詢到終態。
 * - 不走 fal、不扣點、不寫 generations 表（PoC 直回 provider 結果）。
 * - 每日免費額度：行程記憶體 Map（userId+date）。
 *
 * PoC not multi-instance：此 Map 僅本 process 有效，多副本／重啟不共享也不持久。
 * GPU-02 再換成 DB／管理可調額度。
 */
import { TRPCError } from "@trpc/server";
import {
  getCloudInferenceProvider,
  resolveCloudInferenceProviderName,
  type CloudInferenceProvider,
} from "./provider";
import type { CloudJobPhase, CloudOutputKind, GenerationInput, JobStatus } from "./types";

/** ADR-008 建議預設：每日圖片 5 次（PoC 硬編碼；GPU-02 改管理員可調） */
export const FREE_DAILY_IMAGE_LIMIT = 5;

/** 同步輪詢上限：mock 預設 2 ticks 即 done；略留緩衝防卡住 */
export const CLOUD_MOCK_MAX_POLL_TICKS = 8;

/** 免費 mock 模型 id 前綴（與付費 fal modelId 區隔） */
export const CLOUD_MOCK_MODEL_PREFIX = "cloud-mock/";

export const DEFAULT_CLOUD_MOCK_MODEL_ID = "cloud-mock/concept-image";

type FreeKind = "image";

/** key = `${userId}|${YYYY-MM-DD}|${kind}` → used count */
const freeDailyUsage = new Map<string, number>();

function utcDateString(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function freeQuotaKey(userId: string, kind: FreeKind = "image", date = utcDateString()): string {
  return `${userId}|${date}|${kind}`;
}

export function getFreeDailyLimit(_kind: FreeKind = "image"): number {
  return FREE_DAILY_IMAGE_LIMIT;
}

export function getFreeUsage(
  userId: string,
  kind: FreeKind = "image",
): { used: number; limit: number; remaining: number; date: string } {
  const date = utcDateString();
  const limit = getFreeDailyLimit(kind);
  const used = freeDailyUsage.get(freeQuotaKey(userId, kind, date)) ?? 0;
  return { used, limit, remaining: Math.max(0, limit - used), date };
}

/**
 * 預留一次免費額度。成功時 used+1；超額回 ok:false（不拋錯，呼叫端決定）。
 * 同 key 原子性僅限單行程（Map 讀寫同步）。
 */
export function reserveFreeDailyQuota(
  userId: string,
  opts: { kind?: FreeKind; limit?: number } = {},
):
  | { ok: true; used: number; limit: number; remaining: number }
  | { ok: false; used: number; limit: number; remaining: number; message: string } {
  const kind = opts.kind ?? "image";
  const limit = opts.limit ?? getFreeDailyLimit(kind);
  const key = freeQuotaKey(userId, kind);
  const used = freeDailyUsage.get(key) ?? 0;
  if (used >= limit) {
    return {
      ok: false,
      used,
      limit,
      remaining: 0,
      message: `今日免費圖片額度已用完（${used}/${limit}）。明日重置，或改用付費生成`,
    };
  }
  const next = used + 1;
  freeDailyUsage.set(key, next);
  return { ok: true, used: next, limit, remaining: Math.max(0, limit - next) };
}

/** 釋放一次預留（submit 在拿到 job 前失敗時退回，避免白耗額度） */
export function releaseFreeDailyQuota(userId: string, kind: FreeKind = "image"): void {
  const key = freeQuotaKey(userId, kind);
  const used = freeDailyUsage.get(key) ?? 0;
  if (used <= 1) freeDailyUsage.delete(key);
  else freeDailyUsage.set(key, used - 1);
}

/** 單元測試隔離用 */
export function resetFreeQuotaForTests(): void {
  freeDailyUsage.clear();
}

/**
 * 是否允許走 Cloud mock 路徑。
 * 需 CLOUD_INFERENCE_PROVIDER=beam_mock，或 E2E_MOCK=1（此時 registry 也會選 beam_mock）。
 */
export function isCloudMockPathEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const name = resolveCloudInferenceProviderName(env);
  return name === "beam_mock";
}

export interface SubmitCloudMockInput {
  userId: string;
  prompt: string;
  /** 預設 cloud-mock/concept-image；若給定須為 cloud-mock/ 前綴 */
  modelId?: string;
  projectId?: string;
  teamId?: string;
  idempotencyKey?: string;
  kind?: CloudOutputKind;
  /** 最多 status 輪詢次數；預設 CLOUD_MOCK_MAX_POLL_TICKS */
  maxPollTicks?: number;
  env?: NodeJS.ProcessEnv;
  /** 測試注入 provider（略過 getCloudInferenceProvider） */
  provider?: CloudInferenceProvider | null;
  /** 測試注入額度上限 */
  dailyLimit?: number;
}

export interface SubmitCloudMockResult {
  providerJobId: string;
  status: CloudJobPhase;
  resultUrl?: string;
  resultText?: string;
  error?: string;
  coldStartMs?: number;
  gpuSeconds?: number;
  actualCostUsd?: number;
  /** 本次額度消耗後剩餘 */
  freeRemaining: number;
  freeUsed: number;
  freeLimit: number;
}

function assertCloudMockModelId(modelId: string): void {
  if (!modelId.startsWith(CLOUD_MOCK_MODEL_PREFIX)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `免費 mock 生成僅接受 modelId 前綴 ${CLOUD_MOCK_MODEL_PREFIX}（收到：${modelId}）`,
    });
  }
}

/**
 * 免費 mock 圖片生成：預留額度 → CloudInferenceProvider.submit → 同步輪詢 status 至終態。
 * 不呼叫 fal。provider 不可用時明確拒絕（不 silent 落到付費路徑）。
 */
export async function submitCloudMockGeneration(
  input: SubmitCloudMockInput,
): Promise<SubmitCloudMockResult> {
  const env = input.env ?? process.env;
  const modelId = (input.modelId ?? DEFAULT_CLOUD_MOCK_MODEL_ID).trim();
  assertCloudMockModelId(modelId);

  if (!isCloudMockPathEnabled(env) && input.provider == null) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "CloudInference mock 未啟用。請設定 CLOUD_INFERENCE_PROVIDER=beam_mock 或 E2E_MOCK=1（PoC 不走真實 Beam／fal）",
    });
  }

  const provider =
    input.provider !== undefined ? input.provider : getCloudInferenceProvider(env);
  if (!provider) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "CloudInferenceProvider 為 none——無法提交免費 mock 生成",
    });
  }

  // PoC：僅 image 額度；video/audio 日後 GPU-03
  const kind: CloudOutputKind = input.kind ?? "image";
  const reserveKind: FreeKind = "image";
  const reserved = reserveFreeDailyQuota(input.userId, {
    kind: reserveKind,
    limit: input.dailyLimit,
  });
  if (!reserved.ok) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: reserved.message });
  }

  const genInput: GenerationInput = {
    modelId,
    kind,
    prompt: input.prompt,
    idempotencyKey: input.idempotencyKey,
    meta: {
      userId: input.userId,
      projectId: input.projectId,
      teamId: input.teamId,
    },
  };

  let providerJobId: string;
  try {
    const submitted = await provider.submit(genInput);
    providerJobId = submitted.providerJobId;
  } catch (err) {
    releaseFreeDailyQuota(input.userId, reserveKind);
    throw err;
  }

  const maxTicks = Math.max(1, input.maxPollTicks ?? CLOUD_MOCK_MAX_POLL_TICKS);
  let last: JobStatus = { status: "queued" };
  for (let i = 0; i < maxTicks; i++) {
    last = await provider.status(providerJobId);
    if (last.status === "done" || last.status === "failed" || last.status === "cancelled") {
      break;
    }
  }

  return {
    providerJobId,
    status: last.status,
    resultUrl: last.resultUrl,
    resultText: last.resultText,
    error: last.error,
    coldStartMs: last.coldStartMs,
    gpuSeconds: last.gpuSeconds,
    actualCostUsd: last.actualCostUsd,
    freeRemaining: reserved.remaining,
    freeUsed: reserved.used,
    freeLimit: reserved.limit,
  };
}
