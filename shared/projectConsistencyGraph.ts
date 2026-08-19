/**
 * Project Consistency Graph — view of existing records, not a second database.
 *
 * Completeness scores are computed server-side and only projected to the UI.
 */
export interface ConsistencyGraphNode {
  kind: string;
  id: string;
  title: string;
  rev: number | null;
}

export interface ConsistencyGraphEdge {
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  rel: string;
}

export interface WorkspaceRightsReadiness {
  status: "clear" | "needs_review" | "blocked" | "unknown";
  total: number;
  clear: number;
  conditional: number;
  reviewRequired: number;
  blocked: number;
  unknown: number;
}

export interface WorkspaceCompleteness {
  world: number;
  visualCoverage: number;
  generationReady: number;
  consistencyHealth: number;
}

/** Team Canon 引用摘要（PR-C：第一屏只講人話，細節點開再 fetch） */
export interface WorkspaceCanonPin {
  pinId: string;
  canonId: string;
  kind: string;
  name: string;
  state: "PINNED" | "UPDATE_AVAILABLE";
  pinnedVersionNumber: number | null;
  productionVersionNumber: number | null;
  localEntityKind: string | null;
  localEntityId: string | null;
}

export interface WorkspaceProjection {
  projectId: string;
  applied: {
    characters: boolean;
    scenes: boolean;
  };
  counts: {
    characters: number;
    looks: number;
    scenes: number;
    props: number;
    shots: number;
    consistentShots: number;
    needsConfirm: number;
    visualReferences: number;
  };
  completeness: WorkspaceCompleteness;
  compactStatus: string;
  nextAction: string;
  rightsReadiness: WorkspaceRightsReadiness;
  nodes: ConsistencyGraphNode[];
  edges: ConsistencyGraphEdge[];
  /** Team Canon 引用（pin）＋是否有新版可升級——server 是唯一真相，UI 不得自算 */
  canonPins: WorkspaceCanonPin[];
  /** 因上游變更而過期的鏡（packet head stale）——「只重做不一致的鏡頭」的依據 */
  staleShotIds: string[];
  /**
   * closure §8：downstream artifact 級的不一致（影片舊底圖／聲線版本漂移／聲音世界漂移）。
   * 推導值不落盤——生成當下依賴 vs 此刻 current/pinned 版本的比較結果。
   */
  artifactFindings: Array<{
    shotId: string;
    track: "visual" | "narration" | "ambience" | "music";
    code: string;
    message: string;
    assetId: string;
  }>;
  /** 交付阻擋（人話）；空陣列＝可交付 */
  deliveryBlockers: string[];
  /** closure §11：server-authoritative 分維度 scorecard（不平均成一個假百分比） */
  scorecard: ScorecardRow[];
  /**
   * Animation sequence locks are derived from existing immutable Scene Packages.
   * They are not a second version/current pointer.
   */
  sequenceLocks: import("./animationTemporal").SequenceLockProjection[];
}

/** closure §11：scorecard 維度與狀態 */
export const SCORECARD_DIMENSIONS = [
  "identity", "look", "scene", "prop", "style",
  "continuity", "temporal", "physics", "output_identity", "output_style", "asset_state",
  "voice", "sound_world", "lineage", "delivery",
] as const;
export type ScorecardDimension = (typeof SCORECARD_DIMENSIONS)[number];

export const SCORECARD_STATUSES = [
  "ok", "warning", "blocker", "stale", "unresolved", "capability_downgrade",
] as const;
export type ScorecardStatus = (typeof SCORECARD_STATUSES)[number];

export interface ScorecardRow {
  dimension: ScorecardDimension;
  status: ScorecardStatus;
  /** 真正受影響的鏡（空＝專案級訊號） */
  affectedShotIds: string[];
  /** 人話原因＋建議修復（第一層 UI 直接顯示） */
  reason: string;
}

/**
 * 風格／聲音世界未 pin 是專案級訊號（affectedShotIds 空）——
 * 不能走「修復 N 鏡」，要先固定設定。語音「還沒綁定聲線」是另一扇門。
 */
export function scorecardNeedsSetupCta(row: ScorecardRow): boolean {
  return row.status === "warning"
    && row.affectedShotIds.length === 0
    && (row.dimension === "style" || row.dimension === "sound_world");
}

/**
 * 「N 位角色沒有定裝參考圖」——修復鏡生不出參考圖，要走便宜生圖定裝。
 * 多人鏡 capability_downgrade 是另一扇門。
 */
export function scorecardNeedsSheetCta(row: ScorecardRow): boolean {
  return row.dimension === "identity" && row.status === "warning";
}

/**
 * 純建構器：所有輸入都是 server 已載入的既有 records 推導值。
 * 規則：每維度最多一列最重狀態（blocker > unresolved > stale > capability_downgrade > warning > ok）；
 * ok 的維度不出列（第一層只講需要人看的事）。
 */
export function buildConsistencyScorecard(input: {
  charactersMissingReference: string[];       // character ids
  charactersBoundShotIds: string[];           // 有綁角色但角色缺參考的鏡
  looksMissingReference: string[];
  presetsMissingReference: string[];
  unresolvedPropShotIds: string[];            // 道具轉手無法解析的鏡
  styleCanonPinned: boolean;
  staleShotIds: string[];
  multiCharacterShotIds: string[];            // >1 角色的鏡（能力降級）
  voiceFindingShotIds: string[];              // 旁白聲線漂移／缺聲線的鏡
  charactersSpeakingWithoutVoice: number;     // 有台詞但沒綁聲線的角色數
  soundFindingShotIds: string[];
  soundWorldPinned: boolean;
  lineageGapShotIds: string[];                // 現用影片無 parent 紀錄的鏡
  deliveryBlockers: string[];
  outputEvaluationFindings?: Array<{
    shotId: string;
    dimension: "semantic" | "identity" | "look" | "scene" | "prop" | "style" | "temporal" | "physics";
    severity: "warning" | "blocker" | "unresolved";
    reason: string;
  }>;
}): ScorecardRow[] {
  const rows: ScorecardRow[] = [];
  if (input.charactersMissingReference.length) {
    rows.push({
      dimension: "identity",
      status: "warning",
      affectedShotIds: input.charactersBoundShotIds,
      reason: `${input.charactersMissingReference.length} 位角色沒有定裝參考圖——身份一致性只剩文字錨點`,
    });
  }
  if (input.looksMissingReference.length) {
    rows.push({
      dimension: "look",
      status: "warning",
      affectedShotIds: [],
      reason: `${input.looksMissingReference.length} 套造型沒有參考圖`,
    });
  }
  if (input.presetsMissingReference.length) {
    rows.push({
      dimension: "scene",
      status: "warning",
      affectedShotIds: [],
      reason: `${input.presetsMissingReference.length} 個場景卡沒有參考圖`,
    });
  }
  if (input.unresolvedPropShotIds.length) {
    rows.push({
      dimension: "prop",
      status: "unresolved",
      affectedShotIds: input.unresolvedPropShotIds,
      reason: "腳本有道具轉手但對不出接收者——請確認道具持有者（更新道具卡的主人）",
    });
  }
  if (!input.styleCanonPinned) {
    rows.push({
      dimension: "style",
      status: "warning",
      affectedShotIds: [],
      reason: "尚未固定視覺風格設定——各鏡風格靠即時世界觀，跨腳本重用時可能漂移",
    });
  }
  if (input.staleShotIds.length) {
    rows.push({
      dimension: "continuity",
      status: "stale",
      affectedShotIds: input.staleShotIds,
      reason: `${input.staleShotIds.length} 鏡因上游變更而過期——只重做這幾鏡即可`,
    });
  }
  if (input.multiCharacterShotIds.length) {
    rows.push({
      dimension: "identity",
      status: "capability_downgrade",
      affectedShotIds: input.multiCharacterShotIds,
      reason: "多人鏡目前沒有模型能可靠鎖定多重身份——以參考圖＋文字錨點降級，建議人工確認結果",
    });
  }
  if (input.voiceFindingShotIds.length || input.charactersSpeakingWithoutVoice > 0) {
    rows.push({
      dimension: "voice",
      status: input.voiceFindingShotIds.length ? "stale" : "warning",
      affectedShotIds: input.voiceFindingShotIds,
      reason: input.voiceFindingShotIds.length
        ? `${input.voiceFindingShotIds.length} 段旁白與現行聲線不一致——重新生成即可`
        : `${input.charactersSpeakingWithoutVoice} 位有台詞的角色還沒綁定聲線`,
    });
  }
  if (input.soundFindingShotIds.length || !input.soundWorldPinned) {
    rows.push({
      dimension: "sound_world",
      status: input.soundFindingShotIds.length ? "stale" : "warning",
      affectedShotIds: input.soundFindingShotIds,
      reason: input.soundFindingShotIds.length
        ? `${input.soundFindingShotIds.length} 段環境音與現行聲音世界不一致`
        : "尚未設定聲音世界——各鏡環境音各自為政",
    });
  }
  if (input.lineageGapShotIds.length) {
    rows.push({
      dimension: "lineage",
      status: "warning",
      affectedShotIds: input.lineageGapShotIds,
      reason: "有影片查不到來源畫面的血緣紀錄——建議重新生成以建立可追溯血緣",
    });
  }
  const evaluationRows: Array<{
    dimension: ScorecardDimension;
    matches: typeof input.outputEvaluationFindings;
  }> = [
    { dimension: "output_identity", matches: input.outputEvaluationFindings?.filter((row) => row.dimension === "identity" || row.dimension === "look") },
    { dimension: "output_style", matches: input.outputEvaluationFindings?.filter((row) => row.dimension === "style") },
    { dimension: "asset_state", matches: input.outputEvaluationFindings?.filter((row) => row.dimension === "prop") },
    { dimension: "temporal", matches: input.outputEvaluationFindings?.filter((row) => row.dimension === "temporal") },
    { dimension: "physics", matches: input.outputEvaluationFindings?.filter((row) => row.dimension === "physics") },
  ];
  for (const group of evaluationRows) {
    const findings = group.matches ?? [];
    if (!findings.length) continue;
    const status: ScorecardStatus = findings.some((row) => row.severity === "blocker")
      ? "blocker"
      : findings.some((row) => row.severity === "unresolved")
        ? "unresolved"
        : "warning";
    rows.push({
      dimension: group.dimension,
      status,
      affectedShotIds: [...new Set(findings.map((row) => row.shotId))],
      reason: findings.map((row) => row.reason).join("；"),
    });
  }
  if (input.deliveryBlockers.length) {
    rows.push({
      dimension: "delivery",
      status: "blocker",
      affectedShotIds: [],
      reason: input.deliveryBlockers.join("；"),
    });
  }
  return rows;
}

/** 第一屏 Canon 摘要行（人話；0 引用回 null 不佔版面） */
export function canonStatusLine(pins: readonly WorkspaceCanonPin[]): string | null {
  if (!pins.length) return null;
  const updates = pins.filter((pin) => pin.state === "UPDATE_AVAILABLE").length;
  return updates > 0
    ? `${pins.length} 個團隊設定引用 · ${updates} 個有新版`
    : `${pins.length} 個團隊設定引用`;
}

export function visualCoverageScore(visualReferences: number, expectedSlots: number): number {
  if (visualReferences <= 0) return 0;
  if (expectedSlots <= 0) return 1;
  return Math.min(1, visualReferences / expectedSlots);
}

export function compactWorkspaceStatus(input: {
  charactersApplied: boolean;
  sceneCount: number;
  consistentShots: number;
  shotCount: number;
  needsConfirm: number;
  /** Blank 未分場 drafts. Not binding proposals — those stay needsConfirm. */
  untitledOrphans?: number;
}): string {
  const parts: string[] = [];
  parts.push(input.charactersApplied ? "人物已套用" : "人物尚未套用");
  if (input.sceneCount > 0) parts.push(`${input.sceneCount} 個場景`);
  if (input.shotCount > 0) parts.push(`${input.consistentShots}/${input.shotCount} 鏡一致`);
  if ((input.untitledOrphans ?? 0) > 0) parts.push(`${input.untitledOrphans} 鏡未分場`);
  if (input.needsConfirm > 0) parts.push(`${input.needsConfirm} 鏡需確認`);
  return parts.join(" · ");
}

export function nextWorkspaceAction(input: {
  storyReady: boolean;
  parsed: boolean;
  shotCount: number;
  needsConfirm: number;
  consistentShots: number;
  untitledOrphans?: number;
}): string {
  if (!input.storyReady) return "先寫故事或貼上腳本";
  // Live leftover: compactStatus already said 人物已套用 · 21/26 鏡一致,
  // but nextAction still looped to parse because lastParsedAt was empty
  // (cards / heuristic board / assistant writes do not always stamp parse).
  if (!input.parsed && input.shotCount <= 0) return "解析故事，讓人物與場景就位";
  if (input.shotCount <= 0) return "產生分鏡";
  // Live leftover: 5 untitled 未分場 orphans were counted as 鏡需確認,
  // but markers only confirm parse proposals. Path is 分鏡歸場.
  if ((input.untitledOrphans ?? 0) > 0) {
    return `打開分鏡，把 ${input.untitledOrphans} 鏡未分場歸場`;
  }
  if (input.needsConfirm > 0) return `確認 ${input.needsConfirm} 個項目後再生成`;
  if (input.consistentShots < input.shotCount) return "只重做不一致的鏡頭";
  return "產生畫面或粗剪";
}
