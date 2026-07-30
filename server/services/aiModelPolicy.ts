import type {
  ModelCategory,
  ModelEntry,
  ModelTier,
  SourceKind,
} from "../../shared/models";
import { listResolvableModels, resolveModel } from "./modelResolve";

export type AiModelPreference = "balanced" | "quality" | "budget" | "speed";

export interface AiModelRequest {
  category?: ModelCategory;
  preferredId?: string;
  preference?: AiModelPreference;
  sourceKind?: SourceKind;
  maxPoints?: number;
  requireVerified?: boolean;
}

export interface AiModelDecision {
  model: ModelEntry;
  alternatives: ModelEntry[];
  acceptedPreferred: boolean;
  reason: string;
}

/** Categories the project assistant/agent can safely invoke without inventing a source asset. */
export const AI_GENERATION_CATEGORIES: ReadonlySet<ModelCategory> = new Set([
  "text-to-image",
  "text-to-video",
  "text-to-audio",
  "text-to-speech",
  "llm",
]);

/** Fal models need a successful certification; NIM text models are provider-native and do not use Fal certification. */
export function modelIsOperationallyReady(model: ModelEntry): boolean {
  return model.verified || model.id.startsWith("nvidia-nim#");
}

function compatible(model: ModelEntry, request: AiModelRequest): boolean {
  const category = request.category ?? "text-to-image";
  if (model.category !== category) return false;
  if (!AI_GENERATION_CATEGORIES.has(model.category)) return false;
  if (request.sourceKind) {
    if (model.needs !== request.sourceKind) return false;
  } else if (model.needs) {
    return false;
  }
  if (request.maxPoints !== undefined && model.points > request.maxPoints) return false;
  return true;
}

function tierScore(tier: ModelTier, preference: AiModelPreference): number {
  if (preference === "quality") return tier === "flagship" ? 36 : tier === "economy" ? 16 : 0;
  if (preference === "budget") return tier === "budget" ? 36 : tier === "economy" ? 18 : 0;
  if (preference === "speed") return tier === "budget" ? 28 : tier === "economy" ? 22 : 4;
  return tier === "economy" ? 30 : tier === "flagship" ? 18 : 12;
}

function score(model: ModelEntry, preference: AiModelPreference): number {
  return (
    (modelIsOperationallyReady(model) ? 100 : 0) +
    (model.recommended ? 15 : 0) +
    tierScore(model.tier, preference) -
    model.points * (preference === "quality" ? 2 : 8)
  );
}

function selectionReason(
  model: ModelEntry,
  preference: AiModelPreference,
  acceptedPreferred: boolean,
): string {
  if (acceptedPreferred) {
    return `採用指定模型 ${model.label}；模型已可正式運作，且符合本次輸入需求。`;
  }
  const preferenceLabel: Record<AiModelPreference, string> = {
    balanced: "品質、穩定度與成本平衡",
    quality: "成品質感優先",
    budget: "低成本優先",
    speed: "快速產出優先",
  };
  return `選用 ${model.label}：${modelIsOperationallyReady(model) ? "已有正式可用依據" : "目前最佳可用候選"}、${preferenceLabel[preference]}，預估 ${model.points} 點。`;
}

/**
 * One model policy for assistant actions and background agents.
 * Verified live-catalog evidence wins over static recommendations. Autonomous
 * assistant/agent calls fail closed when a category has no operationally ready
 * candidate; only explicit user-driven generation may opt out of that guard.
 */
export function selectAiGenerationModel(request: AiModelRequest = {}): AiModelDecision {
  const preference = request.preference ?? "balanced";
  const requireVerified = request.requireVerified ?? true;
  const candidates = listResolvableModels({ category: request.category ?? "text-to-image" })
    .filter((model) => compatible(model, request));
  if (!candidates.length) {
    throw new Error(`沒有符合條件的 AI 生成模型（${request.category ?? "text-to-image"}）`);
  }

  const preferred = request.preferredId ? resolveModel(request.preferredId) : undefined;
  const activeCandidateIds = new Set(candidates.map((candidate) => candidate.id));
  const acceptedPreferred = Boolean(
    preferred &&
    activeCandidateIds.has(preferred.id) &&
    compatible(preferred, request) &&
    (!requireVerified || modelIsOperationallyReady(preferred)),
  );

  const verified = candidates.filter(modelIsOperationallyReady);
  if (requireVerified && !verified.length) {
    throw new Error(`沒有已通過正式可用檢查的 AI 生成模型（${request.category ?? "text-to-image"}）`);
  }
  const pool = requireVerified ? verified : candidates;
  const ranked = [...pool].sort((a, b) => {
    const scoreDiff = score(b, preference) - score(a, preference);
    if (scoreDiff !== 0) return scoreDiff;
    const pointDiff = a.points - b.points;
    if (pointDiff !== 0) return pointDiff;
    return a.id.localeCompare(b.id);
  });
  const model = acceptedPreferred ? preferred! : ranked[0];
  const alternatives = ranked.filter((item) => item.id !== model.id).slice(0, 3);
  return {
    model,
    alternatives,
    acceptedPreferred,
    reason: selectionReason(model, preference, acceptedPreferred),
  };
}

export function buildAiModelCheatsheet(limit = 18): string {
  // CA-01：無 needs 類別 + 需來源類別（圖生圖／i2v）——後者必須搭配 sourceAssetRef／sourceUrl
  const categories: ModelCategory[] = [
    "text-to-image",
    "text-to-video",
    "image-to-image",
    "image-to-video",
    "text-to-speech",
    "text-to-audio",
    "llm",
  ];
  const lines: string[] = [];
  for (const category of categories) {
    const allowNeeds = category === "image-to-image" || category === "image-to-video";
    const candidates = listResolvableModels({ category })
      .filter((model) => {
        if (allowNeeds) return Boolean(model.needs);
        return !model.needs && AI_GENERATION_CATEGORIES.has(model.category);
      })
      .sort((a, b) => {
        const readinessDiff = Number(modelIsOperationallyReady(b)) - Number(modelIsOperationallyReady(a));
        if (readinessDiff !== 0) return readinessDiff;
        if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
        if (a.points !== b.points) return a.points - b.points;
        return a.id.localeCompare(b.id);
      })
      .slice(0, allowNeeds ? 2 : 4);
    for (const model of candidates) {
      const ready = modelIsOperationallyReady(model) ? "可正式使用" : "待驗證";
      const needsNote = model.needs
        ? `｜需來源(${model.sourceHint ?? model.needs})→sourceAssetRef 或 sourceUrl`
        : "";
      lines.push(
        `- ${model.id}｜${model.label}｜${model.points} 點｜${ready}${needsNote}｜${model.bestFor}`,
      );
      if (lines.length >= limit) return lines.join("\n");
    }
  }
  return lines.join("\n");
}

export function searchAiModels(
  keyword?: string,
  category?: string,
  options: { includeSourceRequired?: boolean } = {},
): ModelEntry[] {
  return listResolvableModels({ q: keyword, category })
    .filter((model) => options.includeSourceRequired || !model.needs)
    .sort((a, b) => {
      const readinessDiff = Number(modelIsOperationallyReady(b)) - Number(modelIsOperationallyReady(a));
      if (readinessDiff !== 0) return readinessDiff;
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      if (a.points !== b.points) return a.points - b.points;
      return a.id.localeCompare(b.id);
    });
}
