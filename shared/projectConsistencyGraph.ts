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
  nodes: ConsistencyGraphNode[];
  edges: ConsistencyGraphEdge[];
  /** Team Canon 引用（pin）＋是否有新版可升級——server 是唯一真相，UI 不得自算 */
  canonPins: WorkspaceCanonPin[];
  /** 因上游變更而過期的鏡（packet head stale）——「只重做不一致的鏡頭」的依據 */
  staleShotIds: string[];
  /** 交付阻擋（人話）；空陣列＝可交付 */
  deliveryBlockers: string[];
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
}): string {
  const parts: string[] = [];
  parts.push(input.charactersApplied ? "人物已套用" : "人物尚未套用");
  if (input.sceneCount > 0) parts.push(`${input.sceneCount} 個場景`);
  if (input.shotCount > 0) parts.push(`${input.consistentShots}/${input.shotCount} 鏡一致`);
  if (input.needsConfirm > 0) parts.push(`${input.needsConfirm} 鏡需確認`);
  return parts.join(" · ");
}

export function nextWorkspaceAction(input: {
  storyReady: boolean;
  parsed: boolean;
  shotCount: number;
  needsConfirm: number;
  consistentShots: number;
}): string {
  if (!input.storyReady) return "先寫故事或貼上腳本";
  if (!input.parsed) return "解析故事，讓人物與場景就位";
  if (input.shotCount <= 0) return "產生分鏡";
  if (input.needsConfirm > 0) return `確認 ${input.needsConfirm} 個項目後再生成`;
  if (input.consistentShots < input.shotCount) return "只重做不一致的鏡頭";
  return "產生畫面或粗剪";
}
