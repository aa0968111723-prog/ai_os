import { computeShotCompletion, type ShotCompletionInput } from "@shared/shotCompletion";

export type StoryboardRailInput = ShotCompletionInput & {
  storySceneId?: string | null;
  prompt?: string | null;
  action?: string | null;
};

export type StoryboardRailSummary = {
  sceneCount: number;
  shotCount: number;
  readyCount: number;
  generatingCount: number;
  blockedCount: number;
  summary: string;
  warning?: string;
};

/**
 * Collapsed storyboard row. Ready = the shot has the inputs a first generation
 * can use (prompt/action or an existing visual). Does not invent a new gate.
 */
export function storyboardRailSummary(shots: StoryboardRailInput[]): StoryboardRailSummary {
  const sceneIds = new Set<string>();
  let readyCount = 0;
  let generatingCount = 0;
  let blockedCount = 0;
  for (const shot of shots) {
    if (shot.storySceneId) sceneIds.add(shot.storySceneId);
    const completion = computeShotCompletion(shot);
    if (completion.state === "running") generatingCount += 1;
    if (completion.state === "blocked") blockedCount += 1;
    if (shot.assetId || (shot.prompt && shot.prompt.trim()) || (shot.action && shot.action.trim())) {
      readyCount += 1;
    }
  }
  const shotCount = shots.length;
  const sceneCount = sceneIds.size;
  const summary =
    shotCount === 0
      ? "尚未產生"
      : `${sceneCount} 場・${shotCount} 鏡・可生成 ${readyCount}`;
  const warning =
    blockedCount > 0
      ? `${blockedCount} 鏡需修改`
      : generatingCount > 0
        ? `${generatingCount} 鏡生成中`
        : undefined;
  return { sceneCount, shotCount, readyCount, generatingCount, blockedCount, summary, warning };
}
