/**
 * 靈感頻道「一鍵再用」→ 寫入指定專案的 creation draft，再開專案頁即可帶入生成台。
 */
import { loadDraft, saveDraft } from "../features/creation-workbench/creationDraft";

export type CommunityRemixPayload = {
  promptText: string;
  modelId?: string | null;
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
};

/** 把靈感貼文寫進專案 draft（mode=generate），回傳深鏈 path */
export function applyCommunityRemixToProject(projectId: string, payload: CommunityRemixPayload): string {
  const prev = loadDraft(projectId);
  saveDraft(projectId, {
    ...prev,
    mode: "generate",
    prompt: payload.promptText,
    modelId: payload.modelId || prev.modelId,
    characterIds: payload.characterIds ?? prev.characterIds,
    scenePresetIds: payload.scenePresetIds ?? prev.scenePresetIds,
    propIds: payload.propIds ?? prev.propIds,
  });
  return `/p/${projectId}#sec-studio`;
}
