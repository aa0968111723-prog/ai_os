/**
 * Shared cost summary for workbench modes (proposal 4.5).
 * Pure presentation — estimate / approval / remaining come from callers
 * (generationGates helpers). No mutation or points logic here.
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
    <div
      className="creation-cost-summary hint"
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
      <div>
        本次模式：{modeLabel}
        {freeNote ? ` · ${freeNote}` : ""}
      </div>
      <div>
        預估消耗：{estimateLabel}
        {usageBasedNote ? (
          <span style={{ marginLeft: 6, fontSize: 12 }}>{usageBasedNote}</span>
        ) : null}
      </div>
      {outputSpec ? <div>輸出規格：{outputSpec}</div> : null}
      {remainingLabel ? <div>{remainingLabel}</div> : null}
      {approvalLabel ? <div>是否需要核准：{approvalLabel}</div> : null}
    </div>
  );
}
