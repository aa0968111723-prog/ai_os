/** DB 的 generations.params 內部欄位；送 Fal 前必須移除。 */
export const GENERATION_SOURCE_META_KEY = "__aiosSourceMeta" as const;

/** 消融實測（影響力量測）的分組標記：同一次實測的基準與各變體共用 runId */
export type GenerationAblationMeta = {
  runId: string;
  /** 這一輪拿掉了哪一段；"baseline"＝完整版，是比對的基準 */
  section: "baseline" | "background" | "character" | "scene" | "prop";
  /** 有固定噪聲時的 seed；沒有＝這顆模型固定不了，差異裡混著噪聲 */
  seed?: number;
};

export type GenerationSourceMeta = {
  secondarySourceUrl?: string;
  ablation?: GenerationAblationMeta;
  /**
   * BYOK Phase 2：此生成使用了使用者個人 fal API Key。
   * true → 略過平台點數（reserveQuota / refund）；status 輪詢必須用同一把個人 key。
   * 持久化在 params 裡，重啟後 advance 仍能正確判斷不退點／用哪把 key。
   */
  usedUserKey?: boolean;
};

export function storeGenerationSourceMeta(
  providerParams: Record<string, unknown>,
  meta: GenerationSourceMeta,
): Record<string, unknown> {
  if (!meta.secondarySourceUrl && !meta.ablation && !meta.usedUserKey) return providerParams;
  return { ...providerParams, [GENERATION_SOURCE_META_KEY]: meta };
}

export function splitGenerationSourceMeta(params: unknown): {
  providerParams: Record<string, unknown>;
  meta: GenerationSourceMeta;
} {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return { providerParams: {}, meta: {} };
  }
  const source = params as Record<string, unknown>;
  const rawMeta = source[GENERATION_SOURCE_META_KEY];
  const providerParams = { ...source };
  delete providerParams[GENERATION_SOURCE_META_KEY];
  const metaObj =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      ? (rawMeta as Record<string, unknown>)
      : null;
  const secondarySourceUrl =
    metaObj && typeof metaObj.secondarySourceUrl === "string"
      ? metaObj.secondarySourceUrl
      : undefined;
  const rawAblation = metaObj?.ablation;
  const ablation =
    rawAblation && typeof rawAblation === "object" && !Array.isArray(rawAblation)
      ? (rawAblation as GenerationAblationMeta)
      : undefined;
  const usedUserKey = metaObj?.usedUserKey === true ? true : undefined;
  return { providerParams, meta: { secondarySourceUrl, ablation, usedUserKey } };
}
