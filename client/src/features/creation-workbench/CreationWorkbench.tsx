import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { flashAnchor } from "../../discuss";
import { ProjectAssistant } from "../../components/ProjectAssistant";
import {
  coCreateQuickPrompts,
  phaseAdvanceNotice,
  primaryActionTypesForPhase,
  suggestedPhaseAfterAction,
  wrapNextStepHint,
} from "../co-create/coCreateActions";
import { CoCreateShell } from "../co-create/CoCreateShell";
import type { CoCreatePhaseId } from "../co-create/coCreatePhases";
import {
  coCreateJourneyStatesWithProgress,
  countScenesWithMedia,
  formatCoCreateWorkSummary,
  type CoCreateProgressInput,
} from "../co-create/coCreateProgress";
import {
  loadCoCreateOpen,
  loadCoCreatePhase,
  saveCoCreateOpen,
  saveCoCreatePhase,
} from "../co-create/coCreateSession";
import { AiContextLine } from "./AiContextLine";
import { CreationContextBar } from "./CreationContextBar";
import { CreationGoalInput } from "./CreationGoalInput";
import { CreationModeTabs, modePanelId, modeTabId } from "./CreationModeTabs";
import { AiTraceHistory } from "./AiTraceHistory";
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
import { KnowledgeSourceStrip } from "./KnowledgeSourceStrip";
import { useAgentRunBadges } from "./useAgentRunBadges";
import {
  modeForAnchor,
  scrollToSelector,
  WORKBENCH_REVEAL_EVENT,
  type WorkbenchRevealDetail,
} from "./workbenchNav";
import {
  contextTargetFromSelector,
  revealProjectContextFromSelector,
} from "../project-nav/projectContextNav";
import {
  composeGoalFromSkills,
  resolveModeFromSkills,
} from "../../../../shared/agentSkills";
import { Button, Card, Hint, Meta, Pill } from "../../components/ui";
/**
 * 目標框送出按鈕的文案：**按鈕上就寫清楚會發生什麼**，免得使用者不敢按（或按了才發現要扣點）。
 * 與 handleGoalSubmit 的分派一一對應。
 */
const GOAL_SUBMIT: Record<CreationMode, { label: string; hint: string }> = {
  ask: { label: "問 AI", hint: "免費，直接送出" },
  generate: { label: "帶入提示詞", hint: "只填進下面的提示詞欄，要不要生成由你按" },
  template: { label: "帶入範本", hint: "只填進「這次想完成什麼」，執行仍要你按" },
  plan: { label: "帶去排步驟", hint: "排計畫用高品質模型、依 token 計點；執行點數核准後才花" },
};

/**
 * AI 創作工作台（WB-01～WB-06 正式頁面入口）：ProjectPage ② 只掛這一個主卡。
 * 目標輸入、模式 tabs、上下文條、共享草稿、四模式 adapter、CreationResourceDrawer。
 *
 * Anchors: #sec-ai-hub, #sec-assistant, #sec-agent, #sec-studio, #sec-workflow,
 * #sec-prompts / #sec-generations / #sec-trail（資源抽屜）。
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
  propIds = [],
  carriedPropIds = [],
  generateApplyRequest = null,
  workflowPromptRequest = null,
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
  worldview?: {
    logline?: string;
    message?: string;
    tones: string[];
    styles: string[];
    taboos: string[];
  };
  wvReady?: boolean;
  characterIds?: string[];
  scenePresetIds?: string[];
  propIds?: string[];
  /** 歸屬自動帶入的素材卡 id（專案頁算好；只用於顯示帶入張數） */
  carriedPropIds?: string[];
  generateApplyRequest?: DirectGenerateApplyRequest | null;
  /** PromptLibrary「用於製作範本」→ WorkflowCard idea box (nonce-driven) */
  workflowPromptRequest?: { text: string; nonce: number } | null;
  /**
   * Parent applyPrompt path. Return `false` when user cancels overwrite confirm
   * so the resource drawer stays open and does not toast success.
   */
  onReuseGenerate?: (
    text: string,
    settings?: {
      modelId?: string | null;
      characterIds?: string[] | null;
      scenePresetIds?: string[] | null;
      propIds?: string[] | null;
      sourceAssetId?: string | null;
    },
  ) => boolean | void;
  /** Form source cleared/changed → keep AssetLibrary highlight honest. */
  onGenerateSourceChange?: (sourceAssetId: string | null) => void;
  studioCollab?: StudioCollabProps | null;
}) {
  const reactId = useId();
  const tabPrefix = `cw-${reactId.replace(/:/g, "")}`;
  const goalInputId = `${tabPrefix}-goal`;
  const { draft, setDraft } = useCreationDraft(projectId);

  // G0–G1「陪你做完」：入口 + 殼 + 伺服器進度（#404）；session 記 phase，完成條件讀 API
  const [coCreateOpen, setCoCreateOpen] = useState(() => loadCoCreateOpen(projectId));
  const [coCreatePhase, setCoCreatePhase] = useState<CoCreatePhaseId>(() =>
    loadCoCreatePhase(projectId),
  );
  useEffect(() => {
    setCoCreateOpen(loadCoCreateOpen(projectId));
    setCoCreatePhase(loadCoCreatePhase(projectId));
  }, [projectId]);
  const enterCoCreate = useCallback(() => {
    setCoCreateOpen(true);
    saveCoCreateOpen(projectId, true);
  }, [projectId]);
  const exitCoCreate = useCallback(() => {
    setCoCreateOpen(false);
    saveCoCreateOpen(projectId, false);
  }, [projectId]);
  const changeCoCreatePhase = useCallback(
    (phase: CoCreatePhaseId) => {
      setCoCreatePhase(phase);
      saveCoCreatePhase(projectId, phase);
    },
    [projectId],
  );
  // G1：分鏡列表供完成條件／作品摘要（僅共創開啟時查，避免閒置流量）
  const coCreateScenes = trpc.scenes.listByProject.useQuery(
    { projectId },
    { enabled: coCreateOpen, staleTime: 15_000 },
  );
  const coCreateProgress: CoCreateProgressInput = useMemo(() => {
    const scenes = coCreateScenes.data ?? [];
    return {
      wvReady,
      logline: worldview.logline,
      tones: worldview.tones,
      styles: worldview.styles,
      sceneCount: scenes.length,
      scenesWithMedia: countScenesWithMedia(scenes),
    };
  }, [coCreateScenes.data, wvReady, worldview.logline, worldview.tones, worldview.styles]);
  const coCreateProgressStates = useMemo(
    () => coCreateJourneyStatesWithProgress(coCreatePhase, coCreateProgress),
    [coCreatePhase, coCreateProgress],
  );
  const coCreateWorkSummary = useMemo(
    () => formatCoCreateWorkSummary(coCreateProgress),
    [coCreateProgress],
  );
  const coCreateQuick = useMemo(
    () => coCreateQuickPrompts(coCreatePhase),
    [coCreatePhase],
  );
  const coCreatePrimaryActions = useMemo(
    () => primaryActionTypesForPhase(coCreatePhase),
    [coCreatePhase],
  );
  const coCreateWrapHint = useMemo(
    () =>
      coCreatePhase === "wrap"
        ? wrapNextStepHint({
            sceneCount: coCreateProgress.sceneCount,
            scenesWithMedia: coCreateProgress.scenesWithMedia,
          })
        : null,
    [coCreatePhase, coCreateProgress],
  );
  const [collapsed, setCollapsed] = useState(false);
  const [planForceOpen, setPlanForceOpen] = useState(false);
  const [askFillRequest, setAskFillRequest] = useState<{ nonce: number; message: string; autoSend?: boolean } | null>(
    null,
  );
  /** Discrete idea fill for TemplateMode (run_template) — not sticky goal keystrokes */
  const [templateIdeaBringIn, setTemplateIdeaBringIn] = useState<{
    text: string;
    nonce: number;
  } | null>(null);
  const [sideNotice, setSideNotice] = useState("");
  const utils = trpc.useUtils();
  /** G2：Confirm → runAction 成功後建議下一 phase + 刷新摘要 */
  const onCoCreateRunActionSuccess = useCallback(
    (info: { actionType: string; kind: string; message: string }) => {
      void coCreateScenes.refetch();
      const next = suggestedPhaseAfterAction(info.actionType, coCreatePhase);
      if (next) {
        changeCoCreatePhase(next);
        setSideNotice(phaseAdvanceNotice(coCreatePhase, next));
      }
    },
    [changeCoCreatePhase, coCreatePhase, coCreateScenes],
  );

  // Side-effect mutations for suggestion strip (not generation.submit — no auto-charge).
  const savePrompt = trpc.prompts.save.useMutation({
    onSuccess: () => {
      utils.prompts.list.invalidate({ projectId });
      setSideNotice("已存進提示詞庫");
    },
    onError: (err) => setSideNotice(err.message || "存進提示詞庫失敗"),
  });
  const addSceneDraft = trpc.scenes.addDraft.useMutation({
    onSuccess: () => {
      utils.scenes.listByProject.invalidate({ projectId });
      setSideNotice("已存成分鏡草稿");
    },
    onError: (err) => setSideNotice(err.message || "存成分鏡草稿失敗"),
  });

  // Clear side-effect notice after a short beat so aria-live does not stick forever.
  useEffect(() => {
    if (!sideNotice) return;
    const t = window.setTimeout(() => setSideNotice(""), 2500);
    return () => window.clearTimeout(t);
  }, [sideNotice]);

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
        setAskInput: (message) => {
          setAskFillRequest((prev) => ({
            nonce: (prev?.nonce ?? 0) + 1,
            message,
          }));
        },
      });
      if (result.mode === "plan") setPlanForceOpen(true);
      else setPlanForceOpen(false);

      // run_template: one-shot idea bring-in (goal text) — does not auto-start workflow.
      if (action.type === "run_template" && action.goal.trim()) {
        setTemplateIdeaBringIn((prev) => ({
          text: action.goal.trim(),
          nonce: (prev?.nonce ?? 0) + 1,
        }));
      }
      // apply_prompt → template: same discrete idea channel (goal alone does not fill idea box).
      if (
        action.type === "apply_prompt" &&
        action.targetMode === "template" &&
        action.promptText?.trim()
      ) {
        setTemplateIdeaBringIn((prev) => ({
          text: action.promptText!.trim(),
          nonce: (prev?.nonce ?? 0) + 1,
        }));
      }

      // Focus generate prompt after bring-in (still no submit).
      if (result.mode === "generate") {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = document.getElementById("gen-prompt") as HTMLTextAreaElement | null;
            el?.focus({ preventScroll: true });
          });
        });
      }
      // Focus ask input after ask fill (still no send).
      if (result.mode === "ask" && result.askMessage) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const el = document.querySelector(
              '#sec-assistant input[aria-label="問 AI 專案助手"]',
            ) as HTMLInputElement | null;
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
        propIds: draft.propIds,
      });
    },
    [canEdit, draft.characterIds, draft.propIds, draft.scenePresetIds, projectId, savePrompt],
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

  // Keep char/scene/prop picks mirrored into draft for cross-mode persistence.
  // Compare by content so default `[]` props (new ref each render) do not loop.
  useEffect(() => {
    const same =
      characterIds.length === draft.characterIds.length &&
      scenePresetIds.length === draft.scenePresetIds.length &&
      propIds.length === draft.propIds.length &&
      characterIds.every((id, i) => id === draft.characterIds[i]) &&
      scenePresetIds.every((id, i) => id === draft.scenePresetIds[i]) &&
      propIds.every((id, i) => id === draft.propIds[i]);
    if (same) return;
    setDraft({ characterIds, scenePresetIds, propIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterIds, scenePresetIds, propIds]);

  const mode = draft.mode;

  const onModeChange = (next: CreationMode) => {
    setDraft({ mode: next });
    setPlanForceOpen(next === "plan");
  };

  /**
   * 「你想完成什麼畫面？」的送出（QA 2026-08-01 修：這個框先前只鏡射、沒有任何送出行為）。
   *
   * 分派原則——**免費的直接做，會扣點的只帶入**：
   * - 一起想：提問免費，直接送出。
   * - 多步開拍：排計畫本身要扣點（高品質模型依 token 計），執行更要人核准，所以帶到目標欄讓使用者按「幫我排步驟」。
   * - 直接出圖／套用範本：按下去就是錢，只把目標帶進提示詞／想法欄並聚焦，執行仍要使用者自己按。
   */
  const handleGoalSubmit = () => {
    const goal = draft.goal.trim();
    if (!goal) return;
    setCollapsed(false);
    if (mode === "ask") {
      setAskFillRequest((prev) => ({ nonce: (prev?.nonce ?? 0) + 1, message: goal, autoSend: true }));
      return;
    }
    if (mode === "generate") {
      setDraft({ prompt: goal });
      goTo("#gen-prompt");
      return;
    }
    if (mode === "template") {
      setTemplateIdeaBringIn((prev) => ({ text: goal, nonce: (prev?.nonce ?? 0) + 1 }));
      goTo("#sec-workflow");
      return;
    }
    setPlanForceOpen(true);
    goTo("#sec-agent");
  };

  /** ＋ 技能：切 mode、必要時補 goal 提示（不扣點） */
  const onSkillIdsChange = (skillIds: string[]) => {
    const mode = resolveModeFromSkills(skillIds) ?? draft.mode;
    const goal = composeGoalFromSkills(skillIds, draft.goal);
    setDraft({ skillIds, mode, goal });
    setPlanForceOpen(mode === "plan");
  };

  /** Single path: mode switch (if workbench anchor) + context reveal or scroll. */
  const goTo = (selector: string) => {
    setCollapsed(false);
    const id = selector.replace(/^#/, "");
    const nextMode = modeForAnchor(id);
    if (nextMode) {
      setDraft({ mode: nextMode });
      if (nextMode === "plan") setPlanForceOpen(true);
      else setPlanForceOpen(false);
    }
    // C2：ContextBar 連到 ① 時走揭示契約（展開＋returnTo），其餘仍純捲動
    if (contextTargetFromSelector(selector)) {
      revealProjectContextFromSelector(selector, { projectId, returnTo: "studio" });
    } else {
      scrollToSelector(selector);
    }
  };

  return (
    <Card as="section" variant="primary" data-fb="AI 創作工作台" id="sec-ai-hub">
      <div className="section-heading-row">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> AI 創作工作台
        </h2>
        <span className="spacer" />
        {running > 0 && <Pill status="running">執行中 {running}</Pill>}
        {waiting > 0 && <Pill status="queued">等待人員 {waiting}</Pill>}
        {awaiting > 0 && <Pill status="queued">待核准 {awaiting}</Pill>}
        {canEdit ? <AiTraceHistory projectId={projectId} /> : null}
        <Button variant="ghost" size="sm"
          type="button"
          aria-expanded={!collapsed}
          aria-controls="sec-ai-hub-body"
          onClick={() => setCollapsed((v) => !v)}>
          <Icon name={collapsed ? "ChevronDown" : "ChevronUp"} size={13} />
          {collapsed ? "展開" : "收合"}
        </Button>
      </div>

      {collapsed && (
        <Meta as="p" style={{ margin: "6px 0 0" }}>
          工作台已收合
          {running + waiting > 0
            ? `；仍有 ${running} 個執行中、${waiting} 個等待人員的計畫`
            : ""}
          。草稿與模式已保留。
        </Meta>
      )}

      <div id="sec-ai-hub-body" hidden={collapsed}>
        {/*
          版面順序＝決策順序（UIUX 修：使用者回報「介面很複雜、不夠直覺」）。
          原本目標輸入框排在模式分頁**上面**，但它的送出鈕文案由 GOAL_SUBMIT[mode] 決定
          ——「帶入提示詞／問 AI／帶入範本／帶去排步驟」四種意思，取決於使用者還沒看到的
          下方分頁。於是那顆鈕在讀到分頁之前無法理解，只能靠旁邊補一行 hint 解釋。
          先選模式、再寫目標，按鈕的字自然就對得上，補充說明也不必存在。
        */}
        {!coCreateOpen ? (
          <>
            <CreationModeTabs mode={mode} onModeChange={onModeChange} tabPanelIdPrefix={tabPrefix} />
            {/* 緊貼模式分頁下方：切換模式時這行跟著變，是使用者唯一看得見
                「這次 AI 到底讀不讀得到我放的東西」的地方（見 aiContextSummary.ts） */}
            <AiContextLine mode={mode} draft={draft} />
          </>
        ) : (
          <Hint className="workbench-intro-lede" style={{ marginTop: 6 }}>
            共創引導中：先選方向，再一步步定調、分鏡、畫面、收斂。
          </Hint>
        )}

        <CreationGoalInput
          inputId={goalInputId}
          goal={draft.goal}
          onGoalChange={(goal) => setDraft({ goal })}
          skillIds={draft.skillIds ?? []}
          onSkillIdsChange={canEdit && !coCreateOpen ? onSkillIdsChange : undefined}
          disabled={!canEdit}
          onSubmit={canEdit && !coCreateOpen ? handleGoalSubmit : undefined}
          submitLabel={GOAL_SUBMIT[mode].label}
          submitHint={GOAL_SUBMIT[mode].hint}
          compact={mode === "generate" || coCreateOpen}
        />

        {/* 沒靈感的出口放在目標框**之後**：讀完「要填什麼」才知道自己填不出來。
            按鈕本身已寫明用途，旁邊不再補一行同義的說明字。 */}
        {!coCreateOpen ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={enterCoCreate}
            data-testid="co-create-entry"
            disabled={!canEdit}
            style={{ marginTop: 6 }}
          >
            沒靈感？陪你做完
          </Button>
        ) : null}

        {coCreateOpen ? (
          <CoCreateShell
            phase={coCreatePhase}
            onPhaseChange={changeCoCreatePhase}
            onExit={exitCoCreate}
            canEdit={canEdit}
            progressStates={coCreateProgressStates}
            workSummary={coCreateWorkSummary}
            wrapHint={coCreateWrapHint}
            onPickChip={
              canEdit
                ? (text) => {
                    // G2：chip → 助手輸入並送出（提問免費）；寫入／扣點仍 Confirm → runAction
                    setDraft({ goal: text, mode: "ask" });
                    setAskFillRequest((prev) => ({
                      nonce: (prev?.nonce ?? 0) + 1,
                      message: text,
                      autoSend: true,
                    }));
                    setSideNotice("已送出方向；若助手提議寫入或生成，請再按確認。");
                  }
                : undefined
            }
          >
            <ProjectAssistant
              projectId={projectId}
              embedded
              canInspectAi={canEdit}
              onCreationAction={canEdit ? handleCreationAction : undefined}
              onSavePromptSuggestion={canEdit ? handleSavePromptSuggestion : undefined}
              onSaveSceneDraft={canEdit ? handleSaveSceneDraft : undefined}
              askFillRequest={askFillRequest}
              knowledgeIds={draft.knowledgeIds}
              quickPrompts={coCreateQuick}
              primaryActionTypes={coCreatePrimaryActions}
              onRunActionSuccess={canEdit ? onCoCreateRunActionSuccess : undefined}
            />
          </CoCreateShell>
        ) : (
          <>
            <CreationContextBar onNavigate={goTo} />

            {(mode === "ask" || mode === "plan") && (
              <KnowledgeSourceStrip
                projectId={projectId}
                selectedIds={draft.knowledgeIds ?? []}
                disabled={!canEdit}
                onChange={(knowledgeIds) => setDraft({ knowledgeIds })}
              />
            )}

            {/* Only one mode panel visible; all stay mounted so draft/assistant state survives switches. */}
            <AskAiMode
              projectId={projectId}
              panelId={modePanelId(tabPrefix, "ask")}
              labelledBy={modeTabId(tabPrefix, "ask")}
              active={mode === "ask"}
              canEdit={canEdit}
              onCreationAction={handleCreationAction}
              onSavePromptSuggestion={canEdit ? handleSavePromptSuggestion : undefined}
              onSaveSceneDraft={canEdit ? handleSaveSceneDraft : undefined}
              askFillRequest={askFillRequest}
              knowledgeIds={draft.knowledgeIds}
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
              propIds={propIds}
              carriedPropIds={carriedPropIds}
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
              projectId={projectId}
              charIds={characterIds}
              sceneIds={scenePresetIds}
              propIds={propIds}
              panelId={modePanelId(tabPrefix, "template")}
              labelledBy={modeTabId(tabPrefix, "template")}
              active={mode === "template"}
              canEdit={canEdit}
              goal={draft.goal}
              templateId={draft.templateId}
              promptRequest={workflowPromptRequest}
              ideaBringIn={templateIdeaBringIn}
            />
            {sideNotice ? (
              <Meta as="p" role="status" aria-live="polite" style={{ marginTop: 8 }}>
                {sideNotice}
              </Meta>
            ) : null}
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
              onGoalChange={canEdit ? (goal) => setDraft({ goal }) : undefined}
              goalInputId={goalInputId}
              knowledgeIds={draft.knowledgeIds}
            />

            <CreationResourceDrawer
              projectId={projectId}
              canEdit={canEdit}
              currentMode={mode}
              onCreationAction={handleCreationAction}
              onReuseGenerate={onReuseGenerate}
              onUseForWorkflow={
                // Surface as discrete idea fill + switch to template (same as ProjectPage path).
                (text) => {
                  setTemplateIdeaBringIn((prev) => ({
                    text,
                    nonce: (prev?.nonce ?? 0) + 1,
                  }));
                  // Prefer parent workflowPromptRequest when provided (legacy sticky channel).
                  setDraft({ mode: "template" });
                }
              }
            />
          </>
        )}

        {coCreateOpen && sideNotice ? (
          <Meta as="p" role="status" aria-live="polite" style={{ marginTop: 8 }}>
            {sideNotice}
          </Meta>
        ) : null}
      </div>
    </Card>
  );
}
