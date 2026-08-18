/** Poll the shot list faster only while image/video/voice/ambience work is in flight. */

const PENDING = new Set(["queued", "running"]);

export type SceneListPollRow = {
  pendingGenStatus?: string | null;
  pendingVoiceStatus?: string | null;
  pendingAmbienceStatus?: string | null;
};

export function sceneListHasPendingWork(scenes: SceneListPollRow[] | undefined): boolean {
  if (!scenes?.length) return false;
  return scenes.some((s) => {
    if (s.pendingGenStatus && PENDING.has(s.pendingGenStatus)) return true;
    if (s.pendingVoiceStatus && PENDING.has(s.pendingVoiceStatus)) return true;
    if (s.pendingAmbienceStatus && PENDING.has(s.pendingAmbienceStatus)) return true;
    return false;
  });
}

export const SCENE_LIST_POLL_PENDING_MS = 10_000;
export const SCENE_LIST_POLL_IDLE_MS = 45_000;

export function sceneListRefetchIntervalMs(scenes: SceneListPollRow[] | undefined): number {
  return sceneListHasPendingWork(scenes) ? SCENE_LIST_POLL_PENDING_MS : SCENE_LIST_POLL_IDLE_MS;
}
