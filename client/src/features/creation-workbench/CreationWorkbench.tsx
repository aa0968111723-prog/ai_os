import { useCallback, useEffect, useId, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { flashAnchor } from "../../discuss";
import { CreationContextBar } from "./CreationContextBar";
import { CreationGoalInput } from "./CreationGoalInput";
import { CreationModeTabs, modePanelId, modeTabId } from "./CreationModeTabs";
import { CreationResourceDrawer } from "./CreationResourceDrawer";
import {
  applyCreationAction,
  type CreationAction,
} from "./creationActions";
import { useCreationDraft, type CreationMode } from "./creationDraft";
import { AskAiMode } from "./modes/AskAiMode";
import {
  DirectGenerateMode,
  type DirectGenerateApplyRequest,
  type StudioCollabProps,
} from "./modes/DirectGenerateMode";
import { PlanMode } from "./modes/PlanMode";
import { TemplateMode } from "./modes/TemplateMode";
import { useAgentRunBadges } from "./useAgentRunBadges";
import {
  modeForAnchor,
  scrollToSelector,
  WORKBENCH_REVEAL_EVENT,
  type WorkbenchRevealDetail,
} from "./workbenchNav";

/**
 * AI 創作工作台 shell（WB-01 + WB-02 generate form）：單一主卡入口、目標輸入、模式 tabs、
 * 上下文條、共享草稿與直接生成表單（generation.submit 唯一路徑在 DirectGenerateMode）。
 *
 * Anchors: #sec-ai-hub, #sec-assistant, #sec-agent, #sec-studio (inside generate mode).
 */
export function CreationWorkbench({
  projectId,
  canEdit,
  isLeader = false,
  groupId,
  myRole,
  projectFormat = "",
  worldview = { tones: [], styles: [], taboos: [] },
  wvReady = false,
  characterIds = [],
  scenePresetIds = [],
  generateApplyRequest = null,
  onReuseGenerate,
  onGenerateSourceChange,
  studioCollab = null,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
  groupId?: string;
  myRole?: string | null;
  projectFormat?: string;
  worldview?: { tones: string[]; styles: string[]; taboos: string[] };
  wvReady?: boolean;
  characterIds?: string[];
  scenePresetIds?: string[];
  generateApplyRequest?: DirectGenerateApplyRequest | null;
  onReuseGenerate?: (
    text: string,
    settings?: {
      modelId?: string | null;
      characterIds?: string[] | null;
      scenePresetIds?: string[] | null;
      sourceAssetId?: string | null;
    },
  ) => void;
  /** Form source cleared/changed → keep AssetLibrary highlight honest. */
  onGenerateSourceChange?: (sourceAssetId: string | null) => void;
  studioCollab?: StudioCollabProps | null;
}) {
  const reactId = useId();
  const tabPrefix = `cw-${reactId.replace(/:/g, "")}`;
  const goalInputId = `${tabPrefix}-goal`;
  const { draft, setDraft } = useCreationDraft(projectId);
  const [collapsed, setCollapsed] = useState(false);
  const [planForceOpen, setPlanForceOpen] = useState(false);
  const utils = trpc.useUtils();

  // Side-effect mutations for suggestion strip (not generation.submit — no auto-charge).
  const savePrompt = trpc.prompts.save.useMutation({
    onSuccess: () => utils.prompts.list.invalidate({ projectId }),
  });
  const addSceneDraft = trpc.scenes.addDraft.useMutation({
    onSuccess: () => utils.scenes.listByProject.invalidate({ projectId }),
  });

  const [focusedRunAnchor] = useState(() => {
    if (typeof window === "undefined") return null;
    const focus = new URLSearchParams(window.location.search).get("focus");
    return focus?.startsWith("agent-run-") ? focus : null;
  });

  const { awaiting, running, waiting } = useAgentRunBadges(projectId);

  const clearPlanForceOpen = useCallback(() => setPlanForceOpen(false), []);

  /**
   * WB-03 CreationAction: fill draft + switch mode only.
   * Never calls generation.submit / agents.plan / workflow start.
   */
  const handleCreationAction = useCallback(
    (action: CreationAction) => {
      setCollapsed(false);
      const result = applyCreationAction(action, {
        draft,
        setDraft,
      });
      if (result.mode === "plan") setPlanForceOpen(true);
      else if (result.mode !== "plan") setPlanForceOpen(false);

      // Focus generate prompt after bring-in (still no submit).
      if (result.mode === "generate") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = document.getElementById("gen-prompt") as HTMLTextAreaElement | null;
            el?.focus({ preventScroll: true });
          });
        });
      }
    },
    [draft, setDraft],
  );

  const handleSavePromptSuggestion = useCallback(
    (text: string, modelId?: string) => {
      const trimmed = text.trim();
      if (!trimmed || !canEdit) return;
      savePrompt.mutate({
        projectId,
        text: trimmed,
        modelId: modelId || undefined,
        characterIds: draft.characterIds,
        scenePresetIds: draft.scenePresetIds,
      });
    },
    [canEdit, draft.characterIds, draft.scenePresetIds, projectId, savePrompt],
  );

  const handleSaveSceneDraft = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !canEdit) return;
      const title = trimmed.slice(0, 40) || "分鏡草稿";
      addSceneDraft.mutate({
        projectId,
        title,
        prompt: trimmed.slice(0, 2000),
      });
    },
    [addSceneDraft, canEdit, projectId],
  );

  useEffect(() => {
    if (!focusedRunAnchor) return;
    setCollapsed(false);
    setDraft({ mode: "plan" });
    setPlanForceOpen(true);
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (flashAnchor(focusedRunAnchor) || tries > 20) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [focusedRunAnchor, setDraft]);

  // External reveal: GenerationList chips, requestWorkbenchMode, etc.
  useEffect(() => {
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<WorkbenchRevealDetail>).detail;
      if (!detail) return;
      if (detail.projectId && detail.projectId !== projectId) return;

      if (detail.expand !== false) setCollapsed(false);

      const mode = detail.mode ?? (detail.anchor ? modeForAnchor(detail.anchor) : null);
      if (mode) setDraft({ mode });

      if (detail.openPlan || mode === "plan" || detail.anchor === "sec-agent") {
        setPlanForceOpen(true);
      }

      if (detail.scroll !== false && detail.anchor) {
        const selector = `#${detail.anchor}`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToSelector(selector));
        });
      }
    };
    window.addEventListener(WORKBENCH_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(WORKBENCH_REVEAL_EVENT, onReveal);
  }, [projectId, setDraft]);

  // Keep char/scene picks mirrored into draft for cross-mode persistence.
  // Compare by content so default `[]` props (new ref each render) do not loop.
  useEffect(() => {
    const same =
      characterIds.length === draft.characterIds.length &&
      scenePresetIds.length === draft.scenePresetIds.length &&
      characterIds.every((id, i) => id === draft.characterIds[i]) &&
      scenePresetIds.every((id, i) => id === draft.scenePresetIds[i]);
    if (same) return;
    setDraft({ characterIds, scenePresetIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterIds, scenePresetIds]);

  const mode = draft.mode;

  const onModeChange = (next: CreationMode) => {
    setDraft({ mode: next });
    setPlanForceOpen(false);
  };

  /** Single path: mode switch (if workbench anchor) + one reduced-motion scroll. */
  const goTo = (selector: string) => {
    setCollapsed(false);
    const id = selector.replace(/^#/, "");
    const nextMode = modeForAnchor(id);
    if (nextMode) {
      setDraft({ mode: nextMode });
      if (nextMode === "plan") setPlanForceOpen(true);
      else setPlanForceOpen(false);
    }
    scrollToSelector(selector);
  };

  return (
    <section className="card card--primary" data-fb="AI 創作工作台" id="sec-ai-hub">
      <div className="section-heading-row">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> AI 創作工作台
        </h2>
        <span className="spacer" />
        {running > 0 && <span className="pill running">執行中 {running}</span>}
        {waiting > 0 && <span className="pill queued">等待人員 {waiting}</span>}
        {awaiting > 0 && <span className="pill queued">待核准 {awaiting}</span>}
        <button
          type="button"
          className="btn-ghost btn-sm"
          aria-expanded={!collapsed}
          aria-controls="sec-ai-hub-body"
          onClick={() => setCollapsed((v) => !v)}
        >
          <Icon name={collapsed ? "ChevronDown" : "ChevronUp"} size={13} />
          {collapsed ? "展開" : "收合"}
        </button>
      </div>

      {collapsed && (
        <p className="hint" style={{ margin: "6px 0 0" }}>
          AI 創作工作台已收合
          {running + waiting > 0
            ? `；仍有 ${running} 個執行中、${waiting} 個等待人員的計畫`
            : ""}
          。草稿與模式選擇已保留。
        </p>
      )}

      <div id="sec-ai-hub-body" hidden={collapsed}>
        <p className="hint" style={{ marginTop: 6 }}>
          從同一個工作台開始：先說明想完成的成果，再選擇問 AI、直接生成、製作範本或執行計畫。
          所有能力沿用目前專案的知識、資料、素材、分鏡、權限、點數與核准規則。
        </p>

        <CreationGoalInput
          inputId={goalInputId}
          goal={draft.goal}
          onGoalChange={(goal) => setDraft({ goal })}
        />

        <CreationModeTabs mode={mode} onModeChange={onModeChange} tabPanelIdPrefix={tabPrefix} />

        <CreationContextBar onNavigate={goTo} />

        {/* Only one mode panel visible; all stay mounted so draft/assistant state survives switches. */}
        <AskAiMode
          projectId={projectId}
          panelId={modePanelId(tabPrefix, "ask")}
          labelledBy={modeTabId(tabPrefix, "ask")}
          active={mode === "ask"}
          onCreationAction={handleCreationAction}
          onSavePromptSuggestion={canEdit ? handleSavePromptSuggestion : undefined}
          onSaveSceneDraft={canEdit ? handleSaveSceneDraft : undefined}
        />
        <DirectGenerateMode
          projectId={projectId}
          groupId={groupId ?? ""}
          canEdit={canEdit}
          myRole={myRole}
          projectFormat={projectFormat}
          worldview={worldview}
          wvReady={wvReady}
          characterIds={characterIds}
          scenePresetIds={scenePresetIds}
          panelId={modePanelId(tabPrefix, "generate")}
          labelledBy={modeTabId(tabPrefix, "generate")}
          active={mode === "generate"}
          goal={draft.goal}
          draft={draft}
          setDraft={setDraft}
          applyRequest={generateApplyRequest}
          onReuseSettings={onReuseGenerate}
          onSourceChange={onGenerateSourceChange}
          collab={studioCollab}
        />
        <TemplateMode
          panelId={modePanelId(tabPrefix, "template")}
          labelledBy={modeTabId(tabPrefix, "template")}
          active={mode === "template"}
          goal={draft.goal}
        />
        <PlanMode
          projectId={projectId}
          canEdit={canEdit}
          isLeader={isLeader}
          panelId={modePanelId(tabPrefix, "plan")}
          labelledBy={modeTabId(tabPrefix, "plan")}
          active={mode === "plan"}
          forceOpen={planForceOpen}
          onForceOpenConsumed={clearPlanForceOpen}
          goal={draft.goal}
        />

        <CreationResourceDrawer projectId={projectId} />
      </div>
    </section>
  );
}
