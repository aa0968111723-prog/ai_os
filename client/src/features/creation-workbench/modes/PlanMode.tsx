import { useEffect, useRef, useState } from "react";
import { trpc } from "../../../api";
import { Icon } from "../../../components/Icon";
import { AgentCard } from "../../../components/AgentCard";

/**
 * Adapter: embed AgentCard execution area like AiHub's #sec-agent details.
 * Keeps #sec-agent anchor for deep links / generation source chips.
 */
export function PlanMode({
  projectId,
  canEdit,
  isLeader = false,
  panelId,
  labelledBy,
  active,
  forceOpen = false,
  goal,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
  panelId: string;
  labelledBy: string;
  active: boolean;
  /** Deep-link or parent requests open execution disclosure */
  forceOpen?: boolean;
  goal?: string;
}) {
  // Reuse AgentCard's query key so activity badges do not add another request.
  const runs = trpc.agents.listByProject.useQuery({ projectId });
  const awaiting = (runs.data ?? []).filter((r) => r.status === "awaiting_approval").length;
  const running = (runs.data ?? []).filter((r) => r.status === "running").length;
  const waiting = (runs.data ?? []).filter((r) => r.status === "waiting").length;
  const hasActiveRun = running > 0 || waiting > 0 || awaiting > 0;
  const [executionOpen, setExecutionOpen] = useState(hasActiveRun || forceOpen);
  const executionProjectRef = useRef(projectId);
  const previousActiveRef = useRef(hasActiveRun);

  useEffect(() => {
    if (executionProjectRef.current !== projectId) {
      executionProjectRef.current = projectId;
      previousActiveRef.current = hasActiveRun;
      setExecutionOpen(hasActiveRun || forceOpen || active);
      return;
    }
    const activityStarted = hasActiveRun && !previousActiveRef.current;
    previousActiveRef.current = hasActiveRun;
    if (activityStarted) setExecutionOpen(true);
  }, [hasActiveRun, projectId, forceOpen, active]);

  // Entering plan mode or deep-link forceOpen expands the execution disclosure once.
  useEffect(() => {
    if (active || forceOpen) setExecutionOpen(true);
  }, [active, forceOpen]);

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} hidden={!active}>
      {goal ? (
        <p className="hint" style={{ marginTop: 4 }}>
          目前目標：<b>{goal.slice(0, 120)}{goal.length > 120 ? "…" : ""}</b>
          — 可在「問 AI」用同一句話下目標排計畫。
        </p>
      ) : null}

      {/* 空執行區預設收合；新一輪活動會展開一次，同一輪期間尊重使用者手動收合。 */}
      <details className="ai-hub-execution" id="sec-agent" open={executionOpen} style={{ marginTop: goal ? 8 : 0, borderTop: goal ? undefined : "none", paddingTop: goal ? undefined : 0 }}>
        <summary
          aria-expanded={executionOpen}
          onClick={(event) => {
            event.preventDefault();
            setExecutionOpen((open) => !open);
          }}
        >
          <span>
            <Icon name="Film" size={14} /> AI 執行計畫
          </span>
          {running > 0 && <span className="pill running">執行中 {running}</span>}
          {waiting > 0 && <span className="pill queued">等待人員 {waiting}</span>}
          {awaiting > 0 && <span className="pill queued">待核准 {awaiting}</span>}
          {running === 0 && awaiting === 0 && waiting === 0 && (
            <span className="hint">目前沒有進行中的計畫</span>
          )}
        </summary>
        <p className="hint" style={{ margin: "8px 0 0" }}>
          AI 會把多步驟目標整理成可檢查的計畫；核准後由伺服器背景逐步執行，關閉頁面也不會中斷，實際扣點仍經過既有守門。
        </p>
        <AgentCard projectId={projectId} canEdit={canEdit} isLeader={isLeader} embedded hideComposer />
      </details>
    </div>
  );
}
