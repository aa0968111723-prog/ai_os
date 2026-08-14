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
