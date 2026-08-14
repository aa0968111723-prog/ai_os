/**
 * Project/character consistency training contract.
 *
 * This is adapter training (LoRA / identity adapter), not a foundation model.
 * Completing a job never Promote's the active pointer.
 */
export const TRAINING_JOB_STATES = [
  "queued",
  "awaiting_approval",
  "training",
  "evaluating",
  "succeeded",
  "failed",
  "cancelled",
  "superseded",
] as const;
export type TrainingJobState = (typeof TRAINING_JOB_STATES)[number];

export const TRAINING_EXCLUDE_REASONS = [
  "rejected",
  "stale",
  "revoked",
  "watermarked",
  "duplicate",
  "low_quality",
  "identity_wrong",
  "cross_project",
  "unconsented",
] as const;
export type TrainingExcludeReason = (typeof TRAINING_EXCLUDE_REASONS)[number];

export interface DatasetAssetEntry {
  assetRevisionId: string;
  assetId: string;
  sha256: string | null;
  included: boolean;
  excludeReason: TrainingExcludeReason | null;
  caption: string | null;
  split: "train" | "eval";
}

export interface DatasetManifestPayload {
  schemaVersion: "consistency-dataset.v1";
  projectId: string;
  characterId: string | null;
  lookId: string | null;
  entries: DatasetAssetEntry[];
  fingerprint: string;
}

export interface TrainingProviderRequest {
  provider: "fal";
  modelId: string;
  datasetFingerprint: string;
  idempotencyKey: string;
}

export interface TrainingProviderHandle {
  externalJobId: string;
  status: "submitted" | "running";
}

export interface TrainingProviderAdapter {
  readonly id: string;
  readonly configured: boolean;
  submit(request: TrainingProviderRequest): Promise<TrainingProviderHandle>;
  poll(externalJobId: string): Promise<{ status: TrainingJobState; adapterRef?: string | null; error?: string | null }>;
  cancel(externalJobId: string): Promise<void>;
}

export function trainingActionAvailable(input: {
  providerConfigured: boolean;
  paidAuthorized: boolean;
}): boolean {
  return input.providerConfigured && input.paidAuthorized;
}

export function canPromoteTrainingJob(state: TrainingJobState, lookChangedDuringTraining: boolean): boolean {
  return state === "succeeded" && !lookChangedDuringTraining;
}

export const DEFAULT_CONSISTENCY_TRAINER = "fal-ai/flux-lora-fast-training";
