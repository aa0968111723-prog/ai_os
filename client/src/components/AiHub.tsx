import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { AgentCard } from "./AgentCard";
import { ProjectAssistant } from "./ProjectAssistant";
import { flashAnchor } from "../discuss";

/**
 * @deprecated Legacy shell kept for unit tests only (`AiHub.test.tsx`).
 * Production ProjectPage mounts `CreationWorkbench` exclusively (WB-01～WB-06).
 * Do not re-mount this on the project page — it would reintroduce parallel AI entries.
 *
 * Historical behavior (still exercised by tests):
 * - 問 AI：ProjectAssistant at #sec-assistant
 * - 直接生成 / 製作範本：scroll adapters to #sec-studio / #sec-workflow
 * - 執行計畫：AgentCard disclosure at #sec-agent
 */
export function AiHub({
  projectId,
  canEdit,
  isLeader = false,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [focusedRunAnchor] = useState(() => {
    if (typeof window === "undefined") return null;
    const focus = new URLSearchParams(window.location.search).get("focus");
    return focus?.startsWith("agent-run-") ? focus : null;
  });
  // Reuse AgentCard's query key so this activity badge does not add another request.
  const runs = trpc.agents.listByProject.useQuery({ projectId });
  const awaiting = (runs.data ?? []).filter((r) => r.status === "awaiting_approval").length;
  const running = (runs.data ?? []).filter((r) => r.status === "running").length;
  const waiting = (runs.data ?? []).filter((r) => r.status === "waiting").length;
  const hasActiveRun = running > 0 || waiting > 0 || awaiting > 0;
  const [executionOpen, setExecutionOpen] = useState(hasActiveRun);
  const executionProjectRef = useRef(projectId);
  const previousActiveRef = useRef(hasActiveRun);

  useEffect(() => {
    // Each project owns its own initial disclosure state.
    if (executionProjectRef.current !== projectId) {
      executionProjectRef.current = projectId;
      previousActiveRef.current = hasActiveRun;
      setExecutionOpen(hasActiveRun);
      return;
    }

    const activityStarted = hasActiveRun && !previousActiveRef.current;
    previousActiveRef.current = hasActiveRun;
    // Auto-open once for a new activity episode. Polling while that episode is
    // active must not undo a user's manual collapse.
    if (activityStarted) setExecutionOpen(true);
  }, [hasActiveRun, projectId]);

  useEffect(() => {
    if (!focusedRunAnchor) return;
    setCollapsed(false);
    setExecutionOpen(true);
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (flashAnchor(focusedRunAnchor) || tries > 20) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [focusedRunAnchor]);

  const goTo = (selector: string) => {
    if (selector === "#sec-agent") setExecutionOpen(true);
    requestAnimationFrame(() => {
      document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const routes: Array<{ label: string; description: string; target: string; icon: IconName }> = [
    { label: "問 AI", description: "問答、發想、拆分鏡", target: "#sec-assistant", icon: "MessageCircle" },
    { label: "直接生成", description: "圖片、影片、聲音", target: "#sec-studio", icon: "Image" },
    { label: "製作範本", description: "固定步驟一次串起", target: "#sec-workflow", icon: "Clapperboard" },
    { label: "執行計畫", description: "多步任務、估點與核准", target: "#sec-agent", icon: "Film" },
  ];

  const contextLinks: Array<{ label: string; target: string }> = [
    { label: "專案設定", target: "#stage-context" },
    { label: "知識", target: "#sec-knowledge" },
    { label: "資料來源", target: "#sec-databases" },
    { label: "素材", target: "#sec-assets" },
    { label: "分鏡與交付", target: "#stage-deliver" },
  ];

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
          AI 創作工作台已收合{running + waiting > 0 ? `；仍有 ${running} 個執行中、${waiting} 個等待人員的計畫` : ""}。
        </p>
      )}

      <div id="sec-ai-hub-body" hidden={collapsed}>
        <p className="hint" style={{ marginTop: 6 }}>
          從同一個工作台開始：先說明想完成的成果，或直接選擇生成、製作範本與執行計畫。
          所有能力沿用目前專案的知識、資料、素材、分鏡、權限、點數與核准規則。
        </p>

        <div
          role="navigation"
          aria-label="AI 創作開始方式"
          style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 8, margin: "12px 0" }}
        >
          {routes.map((route) => (
            <button
              key={route.target}
              type="button"
              className="btn-ghost"
              onClick={() => goTo(route.target)}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                minHeight: 64,
                padding: "10px 12px",
                textAlign: "left",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <Icon name={route.icon} size={16} style={{ marginTop: 2, flexShrink: 0 }} />
              <span>
                <b style={{ display: "block" }}>{route.label}</b>
                <span className="hint" style={{ display: "block", marginTop: 2 }}>{route.description}</span>
              </span>
            </button>
          ))}
        </div>

        <div className="ctx-summary" role="group" aria-label="AI 創作工作台可連動的專案系統">
          連動目前專案：
          {contextLinks.map((item) => (
            <button key={item.target} type="button" className="chip pick" onClick={() => goTo(item.target)}>
              {item.label}
            </button>
          ))}
        </div>

        {/* 統一對話入口（舊錨點 sec-assistant 沿用：外部連結／走查腳本靠它定位） */}
        <div id="sec-assistant">
          <ProjectAssistant projectId={projectId} embedded />
        </div>

        {/* 空執行區預設收合；新一輪活動會展開一次，同一輪期間尊重使用者手動收合。 */}
        <details
          className="ai-hub-execution"
          id="sec-agent"
          open={executionOpen}
        >
          <summary
            aria-expanded={executionOpen}
            onClick={(event) => {
              event.preventDefault();
              setExecutionOpen((open) => !open);
            }}
          >
            <span><Icon name="Film" size={14} /> AI 執行計畫</span>
            {running > 0 && <span className="pill running">執行中 {running}</span>}
            {waiting > 0 && <span className="pill queued">等待人員 {waiting}</span>}
            {awaiting > 0 && <span className="pill queued">待核准 {awaiting}</span>}
            {running === 0 && awaiting === 0 && <span className="hint">目前沒有進行中的計畫</span>}
          </summary>
          <p className="hint" style={{ margin: "8px 0 0" }}>
            AI 會把多步驟目標整理成可檢查的計畫；核准後由伺服器背景逐步執行，關閉頁面也不會中斷，實際扣點仍經過既有守門。
          </p>
          <AgentCard projectId={projectId} canEdit={canEdit} isLeader={isLeader} embedded hideComposer />
        </details>
      </div>
    </section>
  );
}
