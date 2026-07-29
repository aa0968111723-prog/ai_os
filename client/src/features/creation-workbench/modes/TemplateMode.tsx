import { Icon } from "../../../components/Icon";
import { scrollToSelector } from "../workbenchNav";
import { CreationCostSummary } from "../CreationCostSummary";

/**
 * WB-01 thin adapter: scroll to existing #sec-workflow / WorkflowCard.
 * Full template→plan unification / preset pre-select is WB-04.
 * templateId is shown as a bring-in hint when set via CreationAction run_template.
 */
export function TemplateMode({
  panelId,
  labelledBy,
  active,
  goal,
  templateId,
}: {
  panelId: string;
  labelledBy: string;
  active: boolean;
  goal?: string;
  /** Stored on shared draft by run_template bring-in (not yet pre-selected in WorkflowCard). */
  templateId?: string;
}) {
  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} hidden={!active}>
      <p className="hint" style={{ marginTop: 4 }}>
        製作範本沿用既有固定步驟串鏈（WorkflowCard）。選擇範本、填入目標後仍走原有估點與執行流程。
        {goal ? (
          <>
            {" "}
            目前目標：<b>{goal.slice(0, 80)}{goal.length > 80 ? "…" : ""}</b>
          </>
        ) : null}
        {templateId ? (
          <>
            {" "}
            已帶入範本：<b className="mono">{templateId}</b>（請在製作範本區確認並啟動）
          </>
        ) : null}
      </p>
      <button
        type="button"
        className="btn"
        style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6 }}
        onClick={() => {
          scrollToSelector("#sec-workflow");
          requestAnimationFrame(() => {
            const el = document.getElementById("sec-workflow");
            const focusable = el?.querySelector<HTMLElement>(
              "textarea, input, select, button:not([disabled])",
            );
            focusable?.focus();
          });
        }}
      >
        <Icon name="Clapperboard" size={14} /> 前往製作範本
      </button>
      <CreationCostSummary modeLabel="製作範本（既有工作流）" estimateLabel="依範本步驟加總" />
    </div>
  );
}
