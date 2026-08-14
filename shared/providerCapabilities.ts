/**
 * Provider capability matrix（master plan §10）。
 *
 * 上層 domain（Shot Intent／packet／mixer）不猜 provider 欄位；能力從既有的
 * 三種真實訊號推導，不宣稱沒有驗證過的能力：
 * 1. model.input closure 的實際輸出鍵（image_urls／reference_image_urls／loras）
 *    ——與 continuity.ts 的 duck-typing 同一原則，但集中在一處。
 * 2. 人工審計過的允許名單（NEGATIVE_PROMPT_SUPPORTED／SEED_SUPPORTED）。
 * 3. 類別集合（CARD_ANCHOR_CATEGORIES／視覺類）。
 *
 * 今天沒有任何模型有真正的 multi-character identity conditioning——
 * 誠實回報 false，preflight 據此 downgrade，UI 不得假稱已鎖定（§8）。
 */
import {
  CARD_ANCHOR_CATEGORIES,
  supportsNegativePrompt,
  supportsSeed,
  type ModelEntry,
} from "./models";

export interface ProviderCapabilities {
  modelId: string;
  /** 影像參考欄位（模型 payload 真的有這個鍵才會回報）；null＝只有單一來源圖或純文字 */
  referenceField: "image_urls" | "reference_image_urls" | null;
  /** 參考圖上限（referenceField 存在時沿用既有全站上限 4；否則 needs=image 算 1、再否則 0） */
  maxReferenceImages: number;
  /** LoRA／identity adapter 槽（model.input 會輸出 loras 鍵） */
  identityAdapterSupport: boolean;
  /** 真正的多角色 identity conditioning——今天全站皆無，誠實 false */
  multiCharacterIdentity: boolean;
  /** 場景參考（需要能吃多張參考圖才算） */
  sceneReferenceSupport: boolean;
  styleAdapterSupport: boolean;
  imageToVideo: boolean;
  seedSupport: boolean;
  negativePromptSupport: boolean;
  /** 卡片文字錨點（CARD_ANCHOR_CATEGORIES） */
  cardTextAnchors: boolean;
  /** 佇列式非同步工作（全站 provider 都是 poll-based） */
  asyncJob: true;
}

const PROBE_URL = "https://capability.probe.invalid/probe.png";

/** 探測 model.input 實際輸出的鍵（不打 provider、不落地） */
export function probeModelInputKeys(model: Pick<ModelEntry, "input">): Set<string> {
  try {
    const out = model.input("capability-probe", "16:9", PROBE_URL, PROBE_URL);
    return new Set(Object.keys(out ?? {}));
  } catch {
    return new Set();
  }
}

export function capabilityForModel(model: ModelEntry): ProviderCapabilities {
  const keys = probeModelInputKeys(model);
  const referenceField = keys.has("image_urls")
    ? "image_urls" as const
    : keys.has("reference_image_urls")
      ? "reference_image_urls" as const
      : null;
  const identityAdapterSupport = keys.has("loras");
  const needsImage = model.needs === "image";
  const maxReferenceImages = referenceField ? 4 : needsImage ? 1 : 0;
  return {
    modelId: model.id,
    referenceField,
    maxReferenceImages,
    identityAdapterSupport,
    multiCharacterIdentity: false,
    sceneReferenceSupport: maxReferenceImages > 1,
    styleAdapterSupport: identityAdapterSupport,
    imageToVideo: model.kind === "video" && needsImage,
    seedSupport: supportsSeed(model),
    negativePromptSupport: supportsNegativePrompt(model),
    cardTextAnchors: CARD_ANCHOR_CATEGORIES.has(model.category),
    asyncJob: true,
  };
}
