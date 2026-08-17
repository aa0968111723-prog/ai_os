/**
 * Provider-aware reference mixer（master plan §10）。
 *
 * 輸入是 provider-independent 的 Shot 參考需求（packet.references：role＋priority），
 * 輸出是「這個模型真的吃得下」的參考計畫：排序、截斷、降級全部明講——
 * provider 不支援必要能力時回報 downgrade，不得假裝一致性已鎖定。
 *
 * 純函式：不打 provider、不簽 URL；URL 解析與注入仍在 generationCore（既有安全路徑）。
 */
import type { ProviderCapabilities } from "./providerCapabilities";
import type { ShotReferenceBinding, ShotReferenceRole } from "./shotContextPacket";

/** 角色排序：身份最優先——臉錯了其他都白搭；composition/continuity 墊底 */
const ROLE_ORDER: Record<ShotReferenceRole, number> = {
  identity: 0,
  look: 1,
  continuity_previous_end_frame: 2,
  continuity_previous_frame: 3,
  scene: 4,
  prop: 5,
  style: 6,
  sequence_style_frame: 7,
  composition: 8,
  continuity: 9,
};

const PRIORITY_ORDER: Record<ShotReferenceBinding["priority"], number> = {
  PRIMARY: 0,
  SECONDARY: 1,
  SUPPORTING: 2,
};

export interface ReferenceMixDowngrade {
  code:
    | "multi_character_identity_unsupported"
    | "identity_adapter_unavailable"
    | "references_truncated"
    | "no_reference_slot"
    | "scene_reference_unsupported"
    | "previous_frame_unsupported"
    | "previous_frame_untrusted";
  message: string;
}

export interface ReferenceMixPlan {
  /** 依 role/priority 排序、截到能力上限的參考素材（第一張是最重要的） */
  orderedAssetIds: string[];
  /** 注入的欄位；null＝這個模型沒有影像參考槽（只剩文字錨點） */
  attachedField: "image_urls" | "reference_image_urls" | null;
  dropped: Array<{ assetId: string; role: ShotReferenceRole; reason: string }>;
  downgrades: ReferenceMixDowngrade[];
  /**
   * full＝需求都放得下；degraded＝有截斷或必要能力缺失；text_only＝完全沒有影像參考槽。
   * UI 與 evaluation 依此誠實顯示，不得把 degraded 講成已鎖定。
   */
  consistencyMode: "full" | "degraded" | "text_only";
}

export function mixShotReferences(input: {
  references: readonly ShotReferenceBinding[];
  capability: ProviderCapabilities;
  /** 已佔用主來源槽的素材（不重複列入參考陣列） */
  primaryAssetId?: string | null;
  /** 這一鏡有幾個角色（多角色且無 multi-identity conditioning 要降級警示） */
  characterCount?: number;
  /** 這一鏡是否有可用的 identity adapter（canon 訓練成果） */
  activeAdapter?: string | null;
}): ReferenceMixPlan {
  const capability = input.capability;
  const downgrades: ReferenceMixDowngrade[] = [];
  const dropped: ReferenceMixPlan["dropped"] = [];

  const sorted = [...input.references].sort((a, b) => {
    const roleDelta = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
    if (roleDelta !== 0) return roleDelta;
    return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  });

  const seen = new Set<string>();
  if (input.primaryAssetId) seen.add(input.primaryAssetId);
  const deduped = sorted.filter((ref) => {
    if (seen.has(ref.assetId)) return false;
    seen.add(ref.assetId);
    return true;
  });

  if ((input.characterCount ?? 0) > 1 && !capability.multiCharacterIdentity) {
    downgrades.push({
      code: "multi_character_identity_unsupported",
      message: "這個模型沒有真正的多角色身份鎖定，多人鏡可能互換臉——已降級為參考圖＋文字錨點",
    });
  }
  if (input.activeAdapter && !capability.identityAdapterSupport) {
    downgrades.push({
      code: "identity_adapter_unavailable",
      message: "已有訓練好的一致性模型，但這個生成模型不支援 adapter——本次不套用",
    });
  }

  if (!capability.referenceField) {
    for (const ref of deduped) {
      dropped.push({ assetId: ref.assetId, role: ref.role, reason: "模型沒有影像參考槽" });
    }
    if (deduped.length) {
      downgrades.push({
        code: "no_reference_slot",
        message: "這個模型吃不下任何參考圖，僅以文字錨點維持一致性",
      });
    }
    const hasSceneRef = deduped.some((ref) => ref.role === "scene");
    if (hasSceneRef && !capability.sceneReferenceSupport) {
      downgrades.push({
        code: "scene_reference_unsupported",
        message: "場景參考圖無法送入這個模型，場景一致性只靠文字描述",
      });
    }
    return {
      orderedAssetIds: [],
      attachedField: null,
      dropped,
      downgrades,
      consistencyMode: "text_only",
    };
  }

  const budget = Math.max(0, capability.maxReferenceImages - (input.primaryAssetId ? 1 : 0));
  const kept = deduped.slice(0, budget);
  for (const ref of deduped.slice(budget)) {
    dropped.push({ assetId: ref.assetId, role: ref.role, reason: `超過模型參考上限 ${capability.maxReferenceImages}` });
  }
  if (dropped.length) {
    downgrades.push({
      code: "references_truncated",
      message: `參考素材超過模型上限，已依 身份→造型→場景→道具→風格 順序保留前 ${kept.length} 份`,
    });
  }

  return {
    orderedAssetIds: kept.map((ref) => ref.assetId),
    attachedField: capability.referenceField,
    dropped,
    downgrades,
    consistencyMode: downgrades.length > 0 ? "degraded" : "full",
  };
}
