import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../components/Icon";
import { AgentCard } from "../../../components/AgentCard";
import { useAgentRunBadges } from "../useAgentRunBadges";

/**
 * Adapter: embed AgentCard execution area like AiHub's #sec-agent details.
 * Keeps #sec-agent anchor for deep links / generation source chips.
 *
 * Disclosure opens on: active run activity, forceOpen rising (deep link / external
 * reveal), or active false→true (user entered plan tab). Does not auto-open solely
 * because draft restored mode=plan with no activity.
 */
export function PlanMode({
  projectId,
  canEdit,
  isLeader = false,
  panelId,
  labelledBy,
  active,
  forceOpen = false,
  onForceOpenConsumed,
  goal,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
  panelId: string;
  labelledBy: string;
  active: boolean;
  /** Deep-link or external reveal requests open execution disclosure once */
  forceOpen?: boolean;
  onForceOpenConsumed?: () => void;
  goal?: string;
}) {
  const { awaiting, running, waiting, hasActiveRun } = useAgentRunBadges(projectId);
  const [executionOpen, setExecutionOpen] = useState(() => hasActiveRun || forceOpen);
  const executionProjectRef = useRef(projectId);
  const previousActiveRunRef = useRef(hasActiveRun);
  // Seed with current active so draft restore (active already true) is not a transition.
  const prevActiveRef = useRef(active);
  // Seed false so initial forceOpen=true (deep link) counts as a rising edge.
  const prevForceRef = useRef(false);

  useEffect(() => {
    if (executionProjectRef.current !== projectId) {
      executionProjectRef.current = projectId;
      previousActiveRunRef.current = hasActiveRun;
      prevActiveRef.current = active;
      prevForceRef.current = forceOpen;
      setExecutionOpen(hasActiveRun || forceOpen);
      if (forceOpen) onForceOpenConsumed?.();
      return;
    }

    const activityStarted = hasActiveRun && !previousActiveRunRef.current;
    previousActiveRunRef.current = hasActiveRun;
    if (activityStarted) setExecutionOpen(true);

    const becameActive = active && !prevActiveRef.current;
    prevActiveRef.current = active;
    if (becameActive) setExecutionOpen(true);

    const forceRose = forceOpen && !prevForceRef.current;
    prevForceRef.current = forceOpen;
    if (forceRose) {
      setExecutionOpen(true);
      onForceOpenConsumed?.();
    }
  }, [hasActiveRun, projectId, forceOpen, active, onForceOpenConsumed]);

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} hidden={!active}>
      {goal ? (
        <p className="hint" style={{ marginTop: 4 }}>
          目前目標：
          <b>
            {goal.slice(0, 120)}
            {goal.length > 120 ? "…" : ""}
          </b>
          — 可在「問 AI」用同一句話下目標排計畫。
        </p>
      ) : null}

      {/* 空執行區預設收合；新一輪活動會展開一次，同一輪期間尊重使用者手動收合。 */}
      <details
        className="ai-hub-execution"
        id="sec-agent"
        open={executionOpen}
        style={{
          marginTop: goal ? 8 : 0,
          borderTop: goal ? undefined : "none",
          paddingTop: goal ? undefined : 0,
        }}
      >
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
