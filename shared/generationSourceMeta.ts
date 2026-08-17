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

/**
 * Creative Direction v4：這一筆生成是「哪個方向」跑出來的，以及它從哪一版延伸。
 *
 * 為什麼放在 params 的 source meta 而不是新開欄位／新表：
 * - `generations` 已經是每一次生成的逐筆真相（模型／提示詞／點數／成敗），版本清單是它的投影；
 *   方向只是「這一筆是怎麼來的」的註記，不是第二份版本真相。
 * - jsonb 加欄位不需要 migration，且重試沿用 params ⇒ 方向與血緣自動跟著重試走。
 * - 送 provider 前整個 __aiosSourceMeta 會被 split 掉，方向標籤不會污染提示詞。
 */
export type GenerationCreativeMeta = {
  /** 同一次「產生變體」的分組鍵：一批的每個方向共用，reload 後仍能把這批湊回來 */
  batchId: string;
  /** 起手包／自訂方向的穩定 id */
  directionId: string;
  /** 給人看的方向名（卡片與 Compare 直接顯示，不必回查起手包） */
  directionLabel: string;
  /** 這個方向承諾保持不變的家族 */
  keep?: string[];
  /** 血緣：使用者是從哪一版按下「再用這版變體」的（null／未帶＝從這一鏡當下的狀態出發） */
  parentAssetId?: string;
  /** 這一批共幾個方向——partial failure 要能算出「還缺幾個」而不必靠前端記憶 */
  batchSize?: number;
};

export type GenerationSourceMeta = {
  secondarySourceUrl?: string;
  ablation?: GenerationAblationMeta;
  bench?: GenerationBenchMeta;
  /** Candidate generation: keep scenes.assetId unchanged until an explicit Adopt. */
  preserveScenePointer?: boolean;
  /** Visual Creative UX v4 的創作方向與血緣 */
  creative?: GenerationCreativeMeta;
  /**
   * 送出當下這一鏡的現用畫面指標（null 用空字串表示「當時沒有畫面」）。
   *
   * 用途只有一個：provider 回來時判斷「這段時間有沒有人動過這一鏡」。
   * 生成從送出到完成可能要好幾分鐘，這期間人可以在單格工作室採用別的版本、
   * 也可以從素材庫直接指派。沒有這個比對，晚到的 provider 結果會理直氣壯地
   * 蓋掉人剛剛選定的畫面——使用者的操作被一個他早就忘記的舊工作覆寫。
   */
  scenePointerAtSubmit?: string;
  /**
   * BYOK Phase 2：本次生成是否使用使用者個人 fal API Key。
   * true → 跳過平台點數扣／退；advanceGeneration 用同一把 key 查 status。
   * 未設或 false → 平台 FAL_KEY + 正常點數路徑。
   */
  usedUserKey?: boolean;
  /** Frozen Shot Context Packet used for this generation. Resume/retry must reuse it. */
  shotContextPacketId?: string;
  /**
   * 來源素材 id（closure §7 lineage）：i2v／i2i 的 parent。過去只能 regex 解析
   * sourceUrl 反推（外部網址就斷），現在送出當下就把 id 落 meta——
   * 完成時據此寫 asset_revisions（影片→底圖的正式血緣列）。
   */
  sourceAssetId?: string;
  /**
   * Voice identity（closure §5）：這筆音訊生成綁定的聲線 canon。
   * lineage／targeted stale 靠它回答「這段旁白用的是哪個聲線版本」。
   */
  voice?: { canonId: string; versionId: string; voiceId: string; applied: boolean };
  /** Sound World（closure §6）：這筆 ambience／music 生成依賴的聲音世界 canon。 */
  soundWorld?: { canonId: string; versionId: string };
};

export function storeGenerationSourceMeta(
  providerParams: Record<string, unknown>,
  meta: GenerationSourceMeta,
): Record<string, unknown> {
  if (!meta.secondarySourceUrl && !meta.ablation && !meta.bench && !meta.usedUserKey && !meta.preserveScenePointer && !meta.creative && meta.scenePointerAtSubmit === undefined && !meta.shotContextPacketId && !meta.voice && !meta.soundWorld && !meta.sourceAssetId) return providerParams;
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
  const rawCreative = rawMeta && typeof rawMeta === "object" && !Array.isArray(rawMeta)
    ? (rawMeta as Record<string, unknown>).creative
    : undefined;
  // 只認「湊得齊必要欄位」的方向註記：半截的舊資料當作沒有，不要讓 UI 顯示一個沒有名字的方向
  const creativeRow = rawCreative && typeof rawCreative === "object" && !Array.isArray(rawCreative)
    ? (rawCreative as Record<string, unknown>)
    : undefined;
  const creative = creativeRow
    && typeof creativeRow.batchId === "string"
    && typeof creativeRow.directionId === "string"
    && typeof creativeRow.directionLabel === "string"
    ? {
        batchId: creativeRow.batchId,
        directionId: creativeRow.directionId,
        directionLabel: creativeRow.directionLabel,
        ...(Array.isArray(creativeRow.keep)
          ? { keep: creativeRow.keep.filter((value): value is string => typeof value === "string") }
          : {}),
        ...(typeof creativeRow.parentAssetId === "string" ? { parentAssetId: creativeRow.parentAssetId } : {}),
        ...(typeof creativeRow.batchSize === "number" ? { batchSize: creativeRow.batchSize } : {}),
      } satisfies GenerationCreativeMeta
    : undefined;
  const scenePointerAtSubmit = creativeRow !== undefined || rawMeta
    ? typeof (rawMeta as Record<string, unknown>)?.scenePointerAtSubmit === "string"
      ? (rawMeta as Record<string, string>).scenePointerAtSubmit
      : undefined
    : undefined;
  const shotContextPacketId =
    rawMeta != null && typeof rawMeta === "object" && !Array.isArray(rawMeta)
      && typeof (rawMeta as Record<string, unknown>).shotContextPacketId === "string"
      ? (rawMeta as Record<string, string>).shotContextPacketId
      : undefined;
  const metaObj = rawMeta != null && typeof rawMeta === "object" && !Array.isArray(rawMeta)
    ? rawMeta as Record<string, unknown>
    : null;
  const sourceAssetId = typeof metaObj?.sourceAssetId === "string" ? metaObj.sourceAssetId as string : undefined;
  const voiceRow = metaObj?.voice;
  const voice = voiceRow != null && typeof voiceRow === "object" && !Array.isArray(voiceRow)
    && typeof (voiceRow as Record<string, unknown>).canonId === "string"
    && typeof (voiceRow as Record<string, unknown>).versionId === "string"
    && typeof (voiceRow as Record<string, unknown>).voiceId === "string"
    ? {
      canonId: (voiceRow as Record<string, string>).canonId,
      versionId: (voiceRow as Record<string, string>).versionId,
      voiceId: (voiceRow as Record<string, string>).voiceId,
      applied: Boolean((voiceRow as Record<string, unknown>).applied),
    }
    : undefined;
  const soundRow = metaObj?.soundWorld;
  const soundWorld = soundRow != null && typeof soundRow === "object" && !Array.isArray(soundRow)
    && typeof (soundRow as Record<string, unknown>).canonId === "string"
    && typeof (soundRow as Record<string, unknown>).versionId === "string"
    ? {
      canonId: (soundRow as Record<string, string>).canonId,
      versionId: (soundRow as Record<string, string>).versionId,
    }
    : undefined;
  return { providerParams, meta: { secondarySourceUrl, ablation, bench, usedUserKey: usedUserKey || undefined, preserveScenePointer: preserveScenePointer || undefined, creative, scenePointerAtSubmit, shotContextPacketId, voice, soundWorld, sourceAssetId } };
}
