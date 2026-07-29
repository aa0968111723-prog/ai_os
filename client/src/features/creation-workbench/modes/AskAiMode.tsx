import { ProjectAssistant } from "../../../components/ProjectAssistant";

/**
 * Adapter: embed existing ProjectAssistant. Keeps #sec-assistant for deep links.
 * Outer shell (title / mode tabs) is provided by CreationWorkbench.
 */
export function AskAiMode({
  projectId,
  panelId,
  labelledBy,
  active,
}: {
  projectId: string;
  panelId: string;
  labelledBy: string;
  active: boolean;
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
        <ProjectAssistant projectId={projectId} embedded />
      </div>
    </div>
  );
}
