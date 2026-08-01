import { ProjectAssistant } from "../../../components/ProjectAssistant";
import type { CreationAction } from "../creationActions";

/**
 * Adapter: embed existing ProjectAssistant. Keeps #sec-assistant for deep links.
 * Outer shell (title / mode tabs) is provided by CreationWorkbench.
 * WB-03: onCreationAction wires AI suggestion bring-in into the workbench contract.
 */
export function AskAiMode({
  projectId,
  panelId,
  labelledBy,
  active,
  onCreationAction,
  onSavePromptSuggestion,
  onSaveSceneDraft,
  askFillRequest = null,
  knowledgeIds,
}: {
  projectId: string;
  panelId: string;
  labelledBy: string;
  active: boolean;
  onCreationAction?: (action: CreationAction) => void;
  onSavePromptSuggestion?: (text: string, modelId?: string) => void;
  onSaveSceneDraft?: (text: string) => void;
  /** Fill Ask AI chat input without sending (CreationAction type ask). */
  askFillRequest?: { nonce: number; message: string; autoSend?: boolean } | null;
  knowledgeIds?: string[];
}) {
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={labelledBy}
      hidden={!active}
      // Keep mounted when inactive so conversation state survives mode switch
    >
      {/* 統一對話入口（舊錨點 sec-assistant 沿用：外部連結／走查腳本靠它定位） */}
      <div id="sec-assistant">
        <ProjectAssistant
          projectId={projectId}
          embedded
          onCreationAction={onCreationAction}
          onSavePromptSuggestion={onSavePromptSuggestion}
          onSaveSceneDraft={onSaveSceneDraft}
          askFillRequest={askFillRequest}
          knowledgeIds={knowledgeIds}
        />
      </div>
    </div>
  );
}
