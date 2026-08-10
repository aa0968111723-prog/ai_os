/**
 * 拆解 DAG 視覺化（§9.1「子任務卡片 + 依賴箭頭 + 每步類型圖示 + 每步估點」）。
 *
 * 依 `layoutDispatchLayers` 分層：無依賴在第 0 層、同一層平行並排，
 * 層間以「↑ 前置」標記畫出依賴箭頭。執行期（有 status）時每步配狀態徽章
 * （PENDING/RUNNING/RETRYING/DONE/FAILED），完成步可點產出引用開啟。
 */
import type { DispatchOutputRef, DispatchSubtask, DispatchSubtaskRuntime, DispatchSubtaskStatus, DispatchSubtaskType, CostEstimate } from "./dispatchTypes";
import { DISPATCH_TYPE_LABEL, DISPATCH_TYPE_ICON } from "./dispatchTypes";
import { layoutDispatchLayers } from "./dispatchDag";
import { Card } from "../../components/ui";
import { Chip } from "../../components/ui";
import { Meta } from "../../components/ui";
import { Pill, type PillStatus } from "../../components/ui";
import { Icon } from "../../components/Icon";

export const STEP_STATUS_PILL: Record<DispatchSubtaskStatus, PillStatus> = {
  pending: "queued",
  running: "running",
  retrying: "running",
  done: "done",
  failed: "failed",
  stopped: "neutral",
};

export const STEP_STATUS_LABEL: Record<DispatchSubtaskStatus, string> = {
  pending: "排隊",
  running: "執行中",
  retrying: "重試中",
  done: "完成",
  failed: "失敗",
  stopped: "已停止",
};

export type DispatchPlanStep = DispatchSubtask | DispatchSubtaskRuntime;

function stepStatus(step: DispatchPlanStep): DispatchSubtaskStatus | undefined {
  return "status" in step ? step.status : undefined;
}

function stepError(step: DispatchPlanStep): string | undefined {
  return "error" in step ? step.error : undefined;
}

function stepRefs(step: DispatchPlanStep): DispatchOutputRef[] | undefined {
  return "outputRefs" in step ? step.outputRefs : undefined;
}

export function DispatchPlanView({
  subtasks,
  estimate,
  showEstimates = false,
  onOpenRef,
}: {
  subtasks: DispatchPlanStep[];
  /** 有傳才有每步估點（預覽 / 成本確認階段） */
  estimate?: CostEstimate;
  showEstimates?: boolean;
  onOpenRef?: (ref: DispatchOutputRef) => void;
}) {
  const layers = layoutDispatchLayers(subtasks);
  const estimateById = new Map((estimate?.perSubtask ?? []).map((c) => [c.id, c]));
  const idSet = new Set(subtasks.map((s) => s.id));

  return (
    <div className="director-dag" data-testid="dispatch-plan-view">
      {layers.map((layer, layerIndex) => {
        const nextHasDep = layerIndex + 1 < layers.length;
        return (
          <div key={layerIndex}>
            <div className="director-dag__layer">
              {layer.map((step) => {
                const status = stepStatus(step);
                const cost = estimateById.get(step.id);
                const deps = (step.dependsOn ?? []).filter((d) => idSet.has(d));
                const refs = stepRefs(step);
                const error = stepError(step);
                return (
                  <Card key={step.id} variant="quiet" className="director-step">
                    <div className="director-step__head">
                      <span className="director-type">
                        <Icon name={DISPATCH_TYPE_ICON[step.type]} size={14} />
                        {DISPATCH_TYPE_LABEL[step.type]}
                      </span>
                      {status ? (
                        <Pill status={STEP_STATUS_PILL[status]} className="director-step__pill">
                          {STEP_STATUS_LABEL[status]}
                          {status === "retrying" ? ` ×${"retryCount" in step ? step.retryCount : 0}` : ""}
                        </Pill>
                      ) : null}
                      {showEstimates && cost ? (
                        <Meta as="span" className="director-step__est">
                          {cost.estPoints}pt
                        </Meta>
                      ) : null}
                    </div>
                    <Meta as="div" className="director-step__prompt">
                      {step.prompt}
                    </Meta>
                    {deps.length > 0 ? (
                      <div className="director-step__deps">
                        <Icon name="ChevronUp" size={13} className="director-step__dep-arrow" />
                        <span className="director-step__dep-label">前置</span>
                        {deps.map((dep) => (
                          <Chip key={dep} className="director-step__dep">
                            {dep}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                    {refs && refs.length > 0 ? (
                      <div className="director-step__refs">
                        <span className="director-step__ref-label">產出</span>
                        {refs.map((ref) => (
                          <Chip
                            key={ref.type + ":" + ref.id}
                            onClick={onOpenRef ? () => onOpenRef(ref) : undefined}
                            className="director-step__ref"
                          >
                            {ref.label}
                          </Chip>
                        ))}
                      </div>
                    ) : null}
                    {error ? (
                      <div className="director-step__error">
                        <Icon name="TriangleAlert" size={13} />
                        <span>{error}</span>
                      </div>
                    ) : null}
                  </Card>
                );
              })}
            </div>
            {nextHasDep ? (
              <div className="director-dag__connector" aria-hidden="true">
                <Icon name="ChevronDown" size={13} />
                <span>依賴下方</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
