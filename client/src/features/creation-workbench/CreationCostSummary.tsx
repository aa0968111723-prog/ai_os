/**
 * WB-01 minimal stub — full shared cost summary lands with generate/plan modes (WB-02+).
 * Pure presentation; no mutation or points logic.
 */
export function CreationCostSummary({
  modeLabel = "—",
  estimateLabel = "—",
  freeNote,
}: {
  modeLabel?: string;
  estimateLabel?: string;
  freeNote?: string;
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
      <div>預估消耗：{estimateLabel}</div>
    </div>
  );
}
