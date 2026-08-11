import { Icon } from "../../../components/Icon";
import { AgentCard } from "../../../components/AgentCard";
import { ComputerRuntimeCard } from "../../computer-runtime/ComputerRuntimeCard";
import { CreationCostSummary } from "../CreationCostSummary";
import { useAgentRunBadges } from "../useAgentRunBadges";

import { Pill } from "../../../components/ui";
type PlanSummaryLite = {
  estimatedPoints?: number;
  estimatedDurationMinutes?: number | null;
};

type StepLite = { points?: number; status?: string };

/**
 * 執行計畫模式：直接排計畫／核准／進度（不必再繞問 AI）。
 * 保留 #sec-agent 錨點供深連結。
 */
export function PlanMode({
  projectId,
  canEdit,
  isLeader = false,
  panelId,
  labelledBy,
  active,
  forceOpen: _forceOpen = false,
  onForceOpenConsumed: _onForceOpenConsumed,
  goal,
  onGoalChange,
  goalInputId,
  knowledgeIds,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
  panelId: string;
  labelledBy: string;
  active: boolean;
  /** 保留 API：深連結時父層仍可傳；本模式本體已常駐可見 */
  forceOpen?: boolean;
  onForceOpenConsumed?: () => void;
  goal?: string;
  /** 傳了就把代理卡的目標欄合併掉：全頁只剩工作台上面那一格輸入框 */
  onGoalChange?: (goal: string) => void;
  /** 工作台那格 textarea 的 DOM id（職能 chip 寫入後把焦點送回去） */
  goalInputId?: string;
  /** 工作台勾選的知識優先來源 → 規劃 extraSourceIds */
  knowledgeIds?: string[];
}) {
  const { runs, awaiting, running, waiting, hasActiveRun } = useAgentRunBadges(projectId);

  const list = runs.data ?? [];
  const focusRun =
    list.find(
      (r) =>
        r.status === "awaiting_approval" || r.status === "running" || r.status === "waiting" || r.status.startsWith("waiting_") || r.status === "user_controlled",
    ) ?? list[0];
  const planSummary = (focusRun?.planSummary ?? null) as PlanSummaryLite | null;
  const steps = (focusRun?.steps ?? []) as StepLite[];
  const stepPoints = steps.reduce((sum, s) => sum + (s.points ?? 0), 0);
  const estimatedPoints = planSummary?.estimatedPoints ?? (stepPoints > 0 ? stepPoints : null);
  const showCost = Boolean(focusRun && (estimatedPoints != null || awaiting > 0 || hasActiveRun));

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} hidden={!active}>
      {showCost ? (
        <CreationCostSummary
          modeLabel="多步開拍"
          estimateLabel={
            estimatedPoints != null
              ? `約 ${estimatedPoints} 點`
              : hasActiveRun
                ? "執行中（依步驟加總）"
                : "—"
          }
          approvalLabel={
            awaiting > 0
              ? `待核准 ${awaiting}`
              : focusRun?.status === "awaiting_approval"
                ? "是（待核准）"
                : "依計畫步驟與門檻"
          }
          outputSpec={
            planSummary?.estimatedDurationMinutes != null
              ? `預估工期約 ${planSummary.estimatedDurationMinutes} 分鐘`
              : undefined
          }
        />
      ) : null}

      <div
        className="ai-hub-execution"
        id="sec-agent"
        style={{
          marginTop: showCost ? 8 : 4,
          borderTop: showCost ? "1px solid var(--border-soft)" : undefined,
          paddingTop: showCost ? 10 : 0,
        }}
      >
        <div className="section-heading-row" style={{ marginBottom: 6 }}>
          <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Icon name="Film" size={14} /> 多步計畫
          </strong>
          <span className="spacer" />
          {running > 0 && <Pill status="running">執行中 {running}</Pill>}
          {waiting > 0 && <Pill status="queued">等你 {waiting}</Pill>}
          {awaiting > 0 && <Pill status="queued">待核准 {awaiting}</Pill>}
        </div>
        <AgentCard
          projectId={projectId}
          canEdit={canEdit}
          isLeader={isLeader}
          embedded
          initialGoal={goal}
          goal={goal}
          onGoalChange={onGoalChange}
          goalInputId={goalInputId}
          compactComposer
          initialKnowledgeIds={knowledgeIds}
        />
        {/* PR-6A：feature flag off 時元件自行不渲染 */}
        <div style={{ marginTop: 12 }}>
          <ComputerRuntimeCard projectId={projectId} />
        </div>
      </div>
    </div>
  );
}
