import { useEffect, useRef, useState } from "react";
import { WorkflowCard } from "../../../components/WorkflowCard";

/**
 * WB-04: embed real WorkflowCard (not scroll adapter).
 * - #sec-workflow stays here for deep links / PromptLibrary / GenerationList chips
 * - draft.templateId → pickRequest pre-select
 * - draft.goal / external promptRequest → idea box (nonce-driven)
 * Mutations stay inside WorkflowCard (workflows.start / stop); no copy.
 */
export function TemplateMode({
  projectId,
  charIds = [],
  sceneIds = [],
  panelId,
  labelledBy,
  active,
  goal,
  templateId,
  promptRequest,
}: {
  projectId: string;
  charIds?: string[];
  sceneIds?: string[];
  panelId: string;
  labelledBy: string;
  active: boolean;
  goal?: string;
  /** Stored on shared draft by run_template bring-in */
  templateId?: string;
  /** PromptLibrary「用於製作範本」or other external fill */
  promptRequest?: { text: string; nonce: number } | null;
}) {
  const lastTemplateRef = useRef<string | undefined>();
  const lastGoalRef = useRef<string | undefined>();
  const [pickRequest, setPickRequest] = useState<{ templateId: string; nonce: number } | null>(null);
  const [goalPromptRequest, setGoalPromptRequest] = useState<{ text: string; nonce: number } | null>(
    null,
  );

  // Pre-select workflow when draft.templateId changes (run_template / restore).
  useEffect(() => {
    if (!templateId) return;
    if (templateId === lastTemplateRef.current) return;
    lastTemplateRef.current = templateId;
    setPickRequest((prev) => ({ templateId, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [templateId]);

  // Bring draft.goal into idea box once per distinct goal (no auto-start).
  useEffect(() => {
    const text = goal?.trim();
    if (!text) return;
    if (text === lastGoalRef.current) return;
    lastGoalRef.current = text;
    setGoalPromptRequest((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
  }, [goal]);

  // External promptRequest (PromptLibrary) wins over goal-derived fill when both present:
  // prefer the higher nonce stream by simply using external when provided.
  const effectivePromptRequest = promptRequest ?? goalPromptRequest;

  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={labelledBy}
      hidden={!active}
    >
      {/* Deep-link / TocNav / chips target; modeForAnchor maps to template */}
      <div id="sec-workflow">
        <WorkflowCard
          projectId={projectId}
          charIds={charIds}
          sceneIds={sceneIds}
          embedded
          pickRequest={pickRequest}
          promptRequest={effectivePromptRequest}
        />
      </div>
    </div>
  );
}
