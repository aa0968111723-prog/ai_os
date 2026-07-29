import { useEffect, useId, useState } from "react";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { flashAnchor } from "../../discuss";
import { CreationContextBar, scrollToSelector } from "./CreationContextBar";
import { CreationGoalInput } from "./CreationGoalInput";
import { CreationModeTabs } from "./CreationModeTabs";
import { CreationResourceDrawer } from "./CreationResourceDrawer";
import { useCreationDraft, type CreationMode } from "./creationDraft";
import { AskAiMode } from "./modes/AskAiMode";
import { DirectGenerateMode } from "./modes/DirectGenerateMode";
import { PlanMode } from "./modes/PlanMode";
import { TemplateMode } from "./modes/TemplateMode";

/**
 * AI 創作工作台 shell（WB-01）：單一主卡入口、目標輸入、模式 tabs、上下文條與共享草稿。
 * 四種模式以 adapter 嵌入既有能力；不改 API、不刪除舊元件（生成台／範本卡仍在 ProjectPage）。
 *
 * Anchors preserved for deep links: #sec-ai-hub, #sec-assistant, #sec-agent.
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
  const { draft, setDraft } = useCreationDraft(projectId);
  const [collapsed, setCollapsed] = useState(false);
  const [planForceOpen, setPlanForceOpen] = useState(false);

  const [focusedRunAnchor] = useState(() => {
    if (typeof window === "undefined") return null;
    const focus = new URLSearchParams(window.location.search).get("focus");
    return focus?.startsWith("agent-run-") ? focus : null;
  });

  // Activity badges — same query key as AgentCard / PlanMode (shared cache).
  const runs = trpc.agents.listByProject.useQuery({ projectId });
  const awaiting = (runs.data ?? []).filter((r) => r.status === "awaiting_approval").length;
  const running = (runs.data ?? []).filter((r) => r.status === "running").length;
  const waiting = (runs.data ?? []).filter((r) => r.status === "waiting").length;

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

  const mode = draft.mode;

  const onModeChange = (next: CreationMode) => {
    setDraft({ mode: next });
    if (next === "plan") setPlanForceOpen(false);
  };

  const goTo = (selector: string) => {
    if (selector === "#sec-agent") {
      setDraft({ mode: "plan" });
      setPlanForceOpen(true);
    }
    if (selector === "#sec-assistant") {
      setDraft({ mode: "ask" });
    }
    if (selector === "#sec-studio") {
      setDraft({ mode: "generate" });
    }
    if (selector === "#sec-workflow") {
      setDraft({ mode: "template" });
    }
    requestAnimationFrame(() => scrollToSelector(selector));
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

        <CreationGoalInput goal={draft.goal} onGoalChange={(goal) => setDraft({ goal })} />

        <CreationModeTabs mode={mode} onModeChange={onModeChange} tabPanelIdPrefix={tabPrefix} />

        <CreationContextBar onNavigate={goTo} />

        {/* Only one mode panel visible; all stay mounted so draft/assistant state survives switches. */}
        <AskAiMode
          projectId={projectId}
          panelId={`${tabPrefix}-panel-ask`}
          labelledBy={`${tabPrefix}-tab-ask`}
          active={mode === "ask"}
        />
        <DirectGenerateMode
          panelId={`${tabPrefix}-panel-generate`}
          labelledBy={`${tabPrefix}-tab-generate`}
          active={mode === "generate"}
          goal={draft.goal}
        />
        <TemplateMode
          panelId={`${tabPrefix}-panel-template`}
          labelledBy={`${tabPrefix}-tab-template`}
          active={mode === "template"}
          goal={draft.goal}
        />
        <PlanMode
          projectId={projectId}
          canEdit={canEdit}
          isLeader={isLeader}
          panelId={`${tabPrefix}-panel-plan`}
          labelledBy={`${tabPrefix}-tab-plan`}
          active={mode === "plan"}
          forceOpen={planForceOpen}
          goal={draft.goal}
        />

        <CreationResourceDrawer projectId={projectId} />
      </div>
    </section>
  );
}
