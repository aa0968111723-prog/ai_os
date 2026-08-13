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

/**
 * 同題並跑（模型競技場）的分組標記：同一次比較的每顆模型共用 runId。
 * 與消融的差別：消融固定模型改提示詞，這裡固定提示詞改模型。
 */
export type GenerationBenchMeta = {
  runId: string;
};

export type GenerationSourceMeta = {
  secondarySourceUrl?: string;
  ablation?: GenerationAblationMeta;
  bench?: GenerationBenchMeta;
  /** Candidate generation: keep scenes.assetId unchanged until an explicit Adopt. */
  preserveScenePointer?: boolean;
  /**
   * BYOK Phase 2：本次生成是否使用使用者個人 fal API Key。
   * true → 跳過平台點數扣／退；advanceGeneration 用同一把 key 查 status。
   * 未設或 false → 平台 FAL_KEY + 正常點數路徑。
   */
  usedUserKey?: boolean;
};

export function storeGenerationSourceMeta(
  providerParams: Record<string, unknown>,
  meta: GenerationSourceMeta,
): Record<string, unknown> {
  if (!meta.secondarySourceUrl && !meta.ablation && !meta.bench && !meta.usedUserKey && !meta.preserveScenePointer) return providerParams;
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
  const rawBench = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
    ? (rawMeta as Record<string, unknown>).bench
    : undefined;
  const bench = rawBench && typeof rawBench === "object" && !Array.isArray(rawBench)
    ? (rawBench as GenerationBenchMeta)
    : undefined;
  const usedUserKey =
    rawMeta != null && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      ? (rawMeta as Record<string, unknown>).usedUserKey === true
      : false;
  const preserveScenePointer =
    rawMeta != null && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      ? (rawMeta as Record<string, unknown>).preserveScenePointer === true
      : false;
  return { providerParams, meta: { secondarySourceUrl, ablation, bench, usedUserKey: usedUserKey || undefined, preserveScenePointer: preserveScenePointer || undefined } };
}
