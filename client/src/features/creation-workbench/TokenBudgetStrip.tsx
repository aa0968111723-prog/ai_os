import type { PromptBudgetReport, PromptBudgetSegment } from "@shared/promptBudget";
import type { PromptFlowNodeKey } from "./promptFlow";

/**
 * 文字窗口條帶：把「模型讀到哪裡」畫出來。
 *
 * 畫的全部是伺服器**實測**的數字（server/services/promptTokens，內建 CLIP 詞表），
 * 不是估算。量不到分詞器的家族不會走到這個條帶——那時只報實際字數，見下方 fallback。
 *
 * 配色與流程圖節點同一份識別（色塊要對得回節點），相鄰色跑過 CVD 分離驗證。
 */

/** 段落顏色：與流程圖節點同一份識別（色跟著實體走，不跟著順序走） */
export const SECTION_COLORS: Record<PromptFlowNodeKey, string> = {
  instruction: "var(--primary)",
  background: "var(--healing)",
  character: "var(--collab)",
  scene: "var(--brand-lime)",
  prop: "var(--brand-red)",
  negative: "var(--danger)",
  model: "var(--primary-ink)",
};

const TRACK_HEIGHT = 16;

function isCut(segment: PromptBudgetSegment): boolean {
  return segment.status === "truncated" || segment.status === "dropped";
}

export function TokenBudgetStrip({
  budget,
  titles,
}: {
  budget: PromptBudgetReport;
  /** 節點 key → 段落名，供圖例直接標示（不靠顏色單獨識別） */
  titles: Partial<Record<PromptFlowNodeKey, string>>;
}) {
  const limit = budget.encoder.contentTokens;
  const total = budget.totalTokens;
  if (!budget.encoder.measured || total == null || limit == null) return null;

  // 軸長：窗口與實測用量取大的一邊，超出的部分才有地方畫
  const axis = Math.max(limit, total, 1);
  const pct = (value: number) => `${Math.min(100, (value / axis) * 100)}%`;

  return (
    <figure data-testid="token-budget-strip" style={{ margin: "8px 0 0" }}>
      <div
        role="img"
        aria-label={describeBudget(budget, titles)}
        style={{ position: "relative", height: TRACK_HEIGHT, borderRadius: 4, background: "var(--surface-sunken)", overflow: "hidden" }}
      >
        {budget.segments.map((segment) => (
          <span
            key={segment.key}
            // 段與段之間留 2px 底色縫，相鄰色不會糊在一起
            style={{
              position: "absolute",
              insetBlock: 0,
              left: pct(segment.startToken ?? 0),
              width: `max(0px, calc(${pct(segment.tokens ?? 0)} - 2px))`,
              background: SECTION_COLORS[segment.key],
            }}
          />
        ))}

        {limit < axis ? (
          <>
            {/* 窗口線右邊＝模型讀不到的區域 */}
            <span
              style={{
                position: "absolute",
                insetBlock: 0,
                left: pct(limit),
                right: 0,
                background: "repeating-linear-gradient(45deg, rgba(28,25,23,.22) 0 3px, rgba(28,25,23,.05) 3px 6px)",
              }}
            />
            <span style={{ position: "absolute", insetBlock: 0, left: pct(limit), width: 2, background: "var(--fg)" }} />
          </>
        ) : null}
      </div>

      {/* 窗口刻度對齊那條線本身，不是置中——刻度飄在別的位置就等於沒標 */}
      <div style={{ position: "relative", marginTop: 3, height: 15, fontSize: 11, color: "var(--fg-secondary)" }}>
        <span style={{ position: "absolute", left: 0 }}>0</span>
        <span style={{ position: "absolute", right: 0 }}>實測 {total}</span>
        {limit < axis ? (
          <span
            style={{ position: "absolute", left: pct(limit), transform: "translateX(-50%)", whiteSpace: "nowrap", color: "var(--fg)", fontWeight: 600 }}
          >
            窗口 {limit}
          </span>
        ) : null}
      </div>

      {/* 圖例：身分不能只靠顏色，每一段都直接標名字與實測 token 數 */}
      <figcaption style={{ display: "flex", gap: "4px 10px", flexWrap: "wrap", marginTop: 6 }}>
        {budget.segments.map((segment) => (
          <span key={segment.key} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 11, color: "var(--fg-secondary)" }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: SECTION_COLORS[segment.key], flex: "0 0 auto" }} />
            {titles[segment.key] ?? segment.key}
            <span style={{ color: isCut(segment) ? "var(--danger-ink)" : undefined }}>{segment.tokens}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** 讀屏用的一句話：圖上看得到的結論，聽也要聽得到 */
function describeBudget(
  budget: PromptBudgetReport,
  titles: Partial<Record<PromptFlowNodeKey, string>>,
): string {
  const head = `提示詞實測 ${budget.totalTokens} 個 token`;
  const cut = budget.segments.filter(isCut).map((segment) => titles[segment.key] ?? segment.key);
  return cut.length
    ? `${head}，超過窗口 ${budget.encoder.contentTokens}；${cut.join("、")} 有內容沒有進入模型。`
    : `${head}，都在窗口 ${budget.encoder.contentTokens} 之內。`;
}
