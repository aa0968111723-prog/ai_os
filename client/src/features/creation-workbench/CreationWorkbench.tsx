import { useCallback, useEffect, useId, useState } from "react";
import { Icon } from "../../components/Icon";
import { flashAnchor } from "../../discuss";
import { CreationContextBar } from "./CreationContextBar";
import { CreationGoalInput } from "./CreationGoalInput";
import { CreationModeTabs, modePanelId, modeTabId } from "./CreationModeTabs";
import { CreationResourceDrawer } from "./CreationResourceDrawer";
import { useCreationDraft, type CreationMode } from "./creationDraft";
import { AskAiMode } from "./modes/AskAiMode";
import { DirectGenerateMode } from "./modes/DirectGenerateMode";
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
 * AI 創作工作台 shell（WB-01）：單一主卡入口、目標輸入、模式 tabs、上下文條與共享草稿。
 * 四種模式以 adapter 嵌入既有能力；不改 API、不刪除舊元件（生成台／範本卡仍在 ProjectPage）。
 *
 * Anchors preserved for deep links: #sec-ai-hub, #sec-assistant, #sec-agent.
 * External chips use revealWorkbenchAnchor() so hidden tabpanels are shown first.
 */
export function CreationWorkbench({
  projectId,
  canEdit,
  isLeader = false,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
}) {
  const reactId = useId();
  const tabPrefix = `cw-${reactId.replace(/:/g, "")}`;
  const goalInputId = `${tabPrefix}-goal`;
  const { draft, setDraft } = useCreationDraft(projectId);
  const [collapsed, setCollapsed] = useState(false);
  const [planForceOpen, setPlanForceOpen] = useState(false);

  const [focusedRunAnchor] = useState(() => {
    if (typeof window === "undefined") return null;
    const focus = new URLSearchParams(window.location.search).get("focus");
    return focus?.startsWith("agent-run-") ? focus : null;
  });

  const { awaiting, running, waiting } = useAgentRunBadges(projectId);

  const clearPlanForceOpen = useCallback(() => setPlanForceOpen(false), []);

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
        // Double rAF: wait for React commit that unhides the tabpanel.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => scrollToSelector(selector));
        });
      }
    };
    window.addEventListener(WORKBENCH_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(WORKBENCH_REVEAL_EVENT, onReveal);
  }, [projectId, setDraft]);

  const mode = draft.mode;

  const onModeChange = (next: CreationMode) => {
    setDraft({ mode: next });
    // Clear sticky forceOpen on any user tab change (enter or leave plan).
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
        />
        <DirectGenerateMode
          panelId={modePanelId(tabPrefix, "generate")}
          labelledBy={modeTabId(tabPrefix, "generate")}
          active={mode === "generate"}
          goal={draft.goal}
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
