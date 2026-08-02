import { useEffect, useRef, useState } from "react";
import { WorkflowCard } from "../../../components/WorkflowCard";
import { Button, Meta } from "../../../components/ui";

/**
 * WB-04: embed real WorkflowCard (not scroll adapter).
 * - #sec-workflow stays here for deep links / PromptLibrary / GenerationList chips
 * - draft.templateId → pickRequest pre-select (nonce once per id change)
 * - idea box fills only via discrete apply channels (PromptLibrary, run_template
 *   bring-in, or user "帶入想法") — never on every CreationGoalInput keystroke
 * Mutations stay inside WorkflowCard (workflows.start / stop); no copy.
 */
export function TemplateMode({
  projectId,
  charIds = [],
  sceneIds = [],
  propIds = [],
  panelId,
  labelledBy,
  active,
  goal,
  templateId,
  promptRequest,
  ideaBringIn,
}: {
  projectId: string;
  charIds?: string[];
  sceneIds?: string[];
  propIds?: string[];
  panelId: string;
  labelledBy: string;
  active: boolean;
  /** Shared draft goal — display hint only; not auto-written into idea box */
  goal?: string;
  /** Stored on shared draft by run_template bring-in */
  templateId?: string;
  /** PromptLibrary「用於製作範本」(nonce-driven; sticky prop is fine) */
  promptRequest?: { text: string; nonce: number } | null;
  /**
   * Discrete idea fill from workbench (e.g. run_template).
   * Separate from promptRequest so library fill cannot permanently shadow bring-in.
   */
  ideaBringIn?: { text: string; nonce: number } | null;
}) {
  const lastTemplateRef = useRef<string | undefined>(undefined);
  const lastExternalPromptNonce = useRef(0);
  const lastBringInNonce = useRef(0);
  const [pickRequest, setPickRequest] = useState<{ templateId: string; nonce: number } | null>(null);
  /** Single idea-box channel: monotonic nonce; latest apply always wins */
  const [ideaRequest, setIdeaRequest] = useState<{ text: string; nonce: number } | null>(null);

  const pushIdea = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setIdeaRequest((prev) => ({ text: trimmed, nonce: (prev?.nonce ?? 0) + 1 }));
  };

  // Pre-select workflow when draft.templateId changes (run_template / restore).
  useEffect(() => {
    if (!templateId) return;
    if (templateId === lastTemplateRef.current) return;
    lastTemplateRef.current = templateId;
    setPickRequest((prev) => ({ templateId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [templateId]);

  // PromptLibrary: apply once per external nonce (sticky parent prop OK).
  useEffect(() => {
    if (!promptRequest) return;
    if (promptRequest.nonce === lastExternalPromptNonce.current) return;
    lastExternalPromptNonce.current = promptRequest.nonce;
    pushIdea(promptRequest.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to external nonce
  }, [promptRequest?.nonce]);

  // run_template / other workbench bring-in: separate channel so it is never
  // shadowed by a still-truthy sticky PromptLibrary request.
  useEffect(() => {
    if (!ideaBringIn) return;
    if (ideaBringIn.nonce === lastBringInNonce.current) return;
    lastBringInNonce.current = ideaBringIn.nonce;
    pushIdea(ideaBringIn.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to bring-in nonce
  }, [ideaBringIn?.nonce]);

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} hidden={!active}>
      {/* 目前目標是**內容**（使用者自己寫的字），收起來會讓人以為草稿掉了 → Meta */}
      {goal?.trim() ? (
        <Meta as="p" style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <span>
            目前目標：
            <b>
              {goal.slice(0, 80)}
              {goal.length > 80 ? "…" : ""}
            </b>
          </span>
          <Button variant="ghost" size="sm"
            type="button"
            onClick={() => pushIdea(goal)}>
            帶入想法
          </Button>
        </Meta>
      ) : null}

      {/* Deep-link / TocNav / chips target; modeForAnchor maps to template */}
      <div id="sec-workflow">
        <WorkflowCard
          projectId={projectId}
          charIds={charIds}
          sceneIds={sceneIds}
          propIds={propIds}
          embedded
          pickRequest={pickRequest}
          promptRequest={ideaRequest}
        />
      </div>
    </div>
  );
}
