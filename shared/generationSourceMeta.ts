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
  /** BYOK：這次送出用了使用者個人 fal key（輪詢 status 必須用同一把） */
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
  const secondarySourceUrl =
    rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      && typeof (rawMeta as Record<string, unknown>).secondarySourceUrl === "string"
      ? (rawMeta as Record<string, string>).secondarySourceUrl
      : undefined;
  const rawAblation = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
    ? (rawMeta as Record<string, unknown>).ablation
    : undefined;
  const ablation = rawAblation && typeof rawAblation === "object" && !Array.isArray(rawAblation)
    ? (rawAblation as GenerationAblationMeta)
    : undefined;
  const usedUserKey = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
    ? (rawMeta as Record<string, unknown>).usedUserKey === true
    : false;
  return { providerParams, meta: { secondarySourceUrl, ablation, ...(usedUserKey ? { usedUserKey: true } : {}) } };
}
