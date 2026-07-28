/**
 * CloudInferenceProvider 介面與 registry。
 *
 * Env:
 * - CLOUD_INFERENCE_PROVIDER=beam_mock|none
 *   未設定時：E2E_MOCK=1 → beam_mock；否則 → none（安全預設，避免誤開 GPU 路徑）。
 * - E2E_MOCK=1 — beam mock 立即完成（見 beamMockAdapter）；正式部署勿設。
 *
 * GPU-00 僅含 mock；真實 Beam 網路呼叫留待 GPU-01+，此處不讀 Beam secret。
 */
import type { GenerationInput, JobStatus, CloudInferenceProviderName } from "./types";
import { createBeamMockAdapter } from "./beamMockAdapter";

export interface CloudInferenceProvider {
  readonly name: string;
  submit(input: GenerationInput): Promise<{ providerJobId: string }>;
  status(providerJobId: string): Promise<JobStatus>;
  cancel(providerJobId: string): Promise<void>;
}

/** 解析選中的 provider 名稱（可注入 env 方便單元測試）。 */
export function resolveCloudInferenceProviderName(
  env: NodeJS.ProcessEnv = process.env,
): CloudInferenceProviderName {
  const raw = (env.CLOUD_INFERENCE_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "beam_mock" || raw === "none") return raw;
  if (raw) {
    console.warn(
      `[cloudInference] 未知 CLOUD_INFERENCE_PROVIDER=${raw}，改用安全預設`,
    );
  }
  // 安全預設：e2e 假生成環境開 mock；其餘環境預設 none（不 silently 接 GPU）
  return env.E2E_MOCK === "1" ? "beam_mock" : "none";
}

/**
 * 取得目前設定的 CloudInferenceProvider。
 * `none` 時回 null——呼叫端應走既有 fal 路徑或明確拒絕，勿假設永遠有 provider。
 */
export function getCloudInferenceProvider(
  env: NodeJS.ProcessEnv = process.env,
): CloudInferenceProvider | null {
  const name = resolveCloudInferenceProviderName(env);
  if (name === "none") return null;
  if (name === "beam_mock") return createBeamMockAdapter({ env });
  return null;
}
