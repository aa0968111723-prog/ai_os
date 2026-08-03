/**
 * Community → project remix helper.
 * Prefills creationDraft for a target project then navigates to workbench.
 */
import { saveDraft, emptyDraft, type CreationDraft } from "../features/creation-workbench/creationDraft";

export type CommunityRemixPayload = {
  promptText?: string | null;
  modelId?: string | null;
  characterIds?: string[] | null;
  scenePresetIds?: string[] | null;
  propIds?: string[] | null;
  title?: string | null;
};

/** Write draft + navigate to project workbench (generate mode). */
export function applyCommunityRemixToProject(
  projectId: string,
  payload: CommunityRemixPayload,
  navigate: (href: string) => void,
): void {
  const base = emptyDraft("generate");
  const draft: CreationDraft = {
    ...base,
    mode: "generate",
    goal: payload.title?.trim() || payload.promptText?.slice(0, 80) || "",
    prompt: payload.promptText?.trim() || "",
    modelId: payload.modelId || undefined,
    characterIds: Array.isArray(payload.characterIds) ? payload.characterIds : [],
    scenePresetIds: Array.isArray(payload.scenePresetIds) ? payload.scenePresetIds : [],
    propIds: Array.isArray(payload.propIds) ? payload.propIds : [],
  };
  saveDraft(projectId, draft);
  navigate(`/p/${projectId}#sec-studio`);
}
