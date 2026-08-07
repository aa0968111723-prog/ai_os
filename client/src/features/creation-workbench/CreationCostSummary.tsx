import { Meta } from "../../components/ui";

/**
 * Shared cost summary for workbench modes (proposal 4.5).
 * Pure presentation — estimate / approval / remaining come from callers
 * (generationGates helpers). No mutation or points logic here.
 *
 * 用 <Meta> 而非 <Hint>：這裡每一行都是**內容**（本次模式、預估扣點、剩餘額度、
 * 是否需核准），不是介面說明——把它降級成旁註會讓人以為額度讀不到，那正是 Meta 存在的理由。
 */
export function CreationCostSummary({
  modeLabel = "—",
  estimateLabel = "—",
  freeNote,
  remainingLabel,
  approvalLabel,
  outputSpec,
  usageBasedNote,
}: {
  modeLabel?: string;
  /** e.g. "約 5 點" or "依範本步驟加總" */
  estimateLabel?: string;
  freeNote?: string;
  /** e.g. "目前剩 120 點・本週 3/50" */
  remainingLabel?: string;
  /** e.g. "是（達門檻）" / "否" / approval threshold notice */
  approvalLabel?: string;
  /** e.g. model label / format */
  outputSpec?: string;
  /** Extra line for usage-based models */
  usageBasedNote?: string;
}) {
  return (
    <Meta
      as="div"
      className="creation-cost-summary"
      role="status"
      aria-live="polite"
      style={{
        marginTop: 8,
        padding: "8px 10px",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--radius-md)",
        background: "var(--card2)",
      }}
    >
      {/* 每項各佔一列時，手機上這張卡就吃掉四到五行；改成同一行流動換行後
          常見情境（模式＋點數＋規格）壓成一到兩行，資訊一項都沒少。
          分隔點由 CSS 的 ::before 產生，不寫進文字節點——讀屏不會念出「間隔號」。 */}
      <span className="creation-cost-summary__item">
        本次模式：{modeLabel}
        {freeNote ? ` · ${freeNote}` : ""}
      </span>
      <span className="creation-cost-summary__item">
        預估消耗：<b className="creation-cost-summary__points">{estimateLabel}</b>
        {usageBasedNote ? (
          <span style={{ marginLeft: 4 }}>{usageBasedNote}</span>
        ) : null}
      </span>
      {outputSpec ? <span className="creation-cost-summary__item">輸出規格：{outputSpec}</span> : null}
      {remainingLabel ? <span className="creation-cost-summary__item">{remainingLabel}</span> : null}
      {approvalLabel ? <span className="creation-cost-summary__item">是否需要核准：{approvalLabel}</span> : null}
    </Meta>
  );
}
