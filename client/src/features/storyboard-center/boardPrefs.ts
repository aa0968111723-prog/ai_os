/**
 * 分鏡中心的顯示偏好（PE 計畫 §10）：簡單模式 vs 專業模式。
 * 簡單＝畫面、角色、場景、動作、秒數（一般使用者／手機預設）；
 * 專業＝加開 焦段、角度、運鏡、光線、構圖、表情、視線（導演／進階使用者）。
 * per 專案持久化（localStorage）：每個片子的工作深度不同，偏好不該跨專案互蓋。
 */
export type BoardMode = "simple" | "pro";

const key = (projectId: string) => `aios.board.mode.${projectId}`;

export function loadBoardMode(projectId: string): BoardMode {
  try {
    return window.localStorage.getItem(key(projectId)) === "pro" ? "pro" : "simple";
  } catch {
    return "simple";
  }
}

export function saveBoardMode(projectId: string, mode: BoardMode): void {
  try {
    window.localStorage.setItem(key(projectId), mode);
  } catch {
    /* 無痕模式等：偏好持久化只是加分 */
  }
}

export interface ShotRowLike {
  id: string;
  storySceneId: string | null;
  orderIndex: number;
}

export interface SceneGroupOf<S extends ShotRowLike> {
  /** null＝未分場（手動加的鏡、重構前的舊資料）——排在所有場之後 */
  storySceneId: string | null;
  shots: S[];
}

/**
 * 依「場」分組（保序）：場依 story_scenes 的順序，場內鏡依全域 orderIndex。
 * 抽成純函式讓「未分場殿後」「空場仍顯示（可拖鏡進來的空群）」規則可測。
 */
export function groupShotsByScene<S extends ShotRowLike>(
  storySceneIds: string[],
  shots: S[],
): Array<SceneGroupOf<S>> {
  const byScene = new Map<string | null, S[]>();
  for (const id of storySceneIds) byScene.set(id, []);
  const orphans: S[] = [];
  for (const shot of shots) {
    if (shot.storySceneId && byScene.has(shot.storySceneId)) {
      byScene.get(shot.storySceneId)!.push(shot);
    } else {
      orphans.push(shot);
    }
  }
  const groups: Array<SceneGroupOf<S>> = storySceneIds.map((id) => ({
    storySceneId: id,
    shots: (byScene.get(id) ?? []).sort((a, b) => a.orderIndex - b.orderIndex),
  }));
  if (orphans.length) {
    groups.push({ storySceneId: null, shots: orphans.sort((a, b) => a.orderIndex - b.orderIndex) });
  }
  return groups;
}
