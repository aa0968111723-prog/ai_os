import { Icon } from "../../../components/Icon";
import { scrollToSelector } from "../CreationContextBar";
import { CreationCostSummary } from "../CreationCostSummary";

/**
 * WB-01 thin adapter: does not move the full generate form (WB-02).
 * Explains the mode and scrolls/focuses existing #sec-studio on ProjectPage.
 */
export function DirectGenerateMode({
  panelId,
  labelledBy,
  active,
  goal,
}: {
  panelId: string;
  labelledBy: string;
  active: boolean;
  goal?: string;
}) {
  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} hidden={!active}>
      <p className="hint" style={{ marginTop: 4 }}>
        直接生成沿用下方既有「創作生成」台：模型、來源素材、點數與核准守門不變。
        {goal ? (
          <>
            {" "}
            目前目標：<b>{goal.slice(0, 80)}{goal.length > 80 ? "…" : ""}</b>
          </>
        ) : null}
      </p>
      <button
        type="button"
        className="btn"
        style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6 }}
        onClick={() => {
          scrollToSelector("#sec-studio");
          requestAnimationFrame(() => {
            const studio = document.getElementById("sec-studio");
            const focusable = studio?.querySelector<HTMLElement>(
              "textarea, input, select, button:not([disabled])",
            );
            focusable?.focus();
          });
        }}
      >
        <Icon name="Image" size={14} /> 前往創作生成台
      </button>
      <CreationCostSummary modeLabel="直接生成（既有生成台）" estimateLabel="依所選模型計算" />
    </div>
  );
}
