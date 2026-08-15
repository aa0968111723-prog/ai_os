/**
 * Provider-aware multi-character routing policy（closure master plan §10）。
 *
 * 事實基礎：capability matrix 誠實回報「今天沒有任何模型有真正的 multi-character
 * identity conditioning」（providerCapabilities.ts）。所以路由政策不是「找一顆能鎖
 * 多人的模型」（不存在＝不能假裝），而是：
 * 1. 需求計算：幾個身份 slot、哪些 reference 職責
 * 2. 若有 capability-compatible 且已配置的替代模型 → 推薦（不 silent 換，回傳決策）
 * 3. 沒有 → 明確降級策略＋structured warning
 * 4. staged composition（分段合成）標為建議策略，不自動執行（bounded）
 *
 * 這是純函式：呼叫端（generationCommand／UI）拿決策去執行或顯示，
 * 絕不 silent 呼叫未授權 provider。
 */
import type { ProviderCapabilities } from "./providerCapabilities";

export type MultiCharacterStrategy =
  | "single_identity_ok"        // 0–1 個身份：現有能力可靠
  | "references_text_anchors"   // 多身份：參考圖＋文字錨點降級（現狀最誠實策略）
  | "staged_composition";       // 建議人工分段合成（先單人後合成）——不自動執行

export interface ModelRoutingDecision {
  requestedModelId: string;
  /** 建議改用的模型（null＝沒有更好的選擇，維持原模型＋降級策略） */
  suggestedModelId: string | null;
  strategy: MultiCharacterStrategy;
  /** 使用者需要知道的事（空＝無需確認） */
  warnings: Array<{ code: string; message: string }>;
}

export function routeMultiCharacterModel(input: {
  requestedModelId: string;
  characterCount: number;
  capability: Pick<ProviderCapabilities, "multiCharacterIdentity" | "referenceField" | "maxReferenceImages" | "identityAdapterSupport">;
  /** 候選替代模型（呼叫端先過 verified／points／權限），含其 capability */
  alternatives?: Array<{
    modelId: string;
    capability: Pick<ProviderCapabilities, "multiCharacterIdentity" | "referenceField" | "maxReferenceImages">;
  }>;
}): ModelRoutingDecision {
  const base: ModelRoutingDecision = {
    requestedModelId: input.requestedModelId,
    suggestedModelId: null,
    strategy: "single_identity_ok",
    warnings: [],
  };
  if (input.characterCount <= 1) return base;

  // 多身份需求。今天沒有模型真的支援 multiCharacterIdentity——
  // 若未來 capability matrix 出現 true 的模型，這裡自動開始推薦它。
  const capable = (input.alternatives ?? []).find((alt) => alt.capability.multiCharacterIdentity);
  if (capable) {
    return {
      ...base,
      suggestedModelId: capable.modelId,
      strategy: "references_text_anchors",
      warnings: [{
        code: "multi_character_model_available",
        message: `「${capable.modelId}」支援多人身份鎖定，建議改用（目前模型會降級為參考圖＋文字錨點）`,
      }],
    };
  }

  // 沒有可靠模型：挑「參考槽較多」的替代（至少裝得下更多身份參考），否則維持原模型
  const requestedBudget = input.capability.referenceField ? input.capability.maxReferenceImages : 0;
  const better = (input.alternatives ?? [])
    .filter((alt) => alt.capability.referenceField && alt.capability.maxReferenceImages > requestedBudget)
    .sort((a, b) => b.capability.maxReferenceImages - a.capability.maxReferenceImages)[0] ?? null;

  const warnings: ModelRoutingDecision["warnings"] = [{
    code: "multi_character_identity_unsupported",
    message: `這一鏡有 ${input.characterCount} 個角色身份，目前沒有模型能可靠鎖定多人身份——將以參考圖＋文字錨點降級維持，一致性可能下降`,
  }];
  if (input.characterCount >= 3) {
    warnings.push({
      code: "staged_composition_suggested",
      message: "三人以上團體鏡建議分段合成（先單人再合成），或接受降級後人工挑選一致的候選",
    });
  }
  if (better && !input.capability.referenceField) {
    // 原模型連參考槽都沒有（text_only）——推薦有參考槽的替代
    return {
      ...base,
      suggestedModelId: better.modelId,
      strategy: "references_text_anchors",
      warnings: [
        ...warnings,
        {
          code: "reference_capable_model_suggested",
          message: `目前模型沒有參考圖槽；「${better.modelId}」可掛 ${better.capability.maxReferenceImages} 張身份參考，建議改用`,
        },
      ],
    };
  }
  return {
    ...base,
    strategy: input.characterCount >= 3 ? "staged_composition" : "references_text_anchors",
    warnings,
  };
}
