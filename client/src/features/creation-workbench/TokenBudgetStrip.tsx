import type { PromptBudget, TextEncoderProfile } from "@shared/textEncoders";
import type { PromptFlowNodeKey } from "./promptFlow";

/**
 * 文字窗口的實體條帶：把「模型讀得到哪裡」畫出來，而不是用文字描述。
 *
 * 一條等比例的軸＝這次提示詞的 token 總量（超窗口時軸長取總量，窗口線就會落在中間）。
 * 每一段照它真正吃掉的 token 佔一格，順序＝實際疊加順序；窗口線右邊那截就是
 * 模型讀不到的部分。看一眼就知道「素材設定整段在線外」，不必讀三行字。
 *
 * 不確定性也畫出來：實色＝樂觀下界，半透明延伸＝保守上界。
 * 估算就是估算，用一條實線假裝精準是騙人。
 *
 * 配色用站內品牌色，並以 dataviz 的驗證器跑過相鄰色 CVD 分離（護色盲）：
 * 主橘 → 淡紫 → 青 → 萊姆 → 磚紅，相鄰最差 ΔE 8.5（deutan）通過。
 * 亮度較低的萊姆靠直接標籤補足對比，不是只靠顏色識別。
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

/** 視窗軸的高度：夠粗才看得出分段，又不至於變成一條裝飾橫幅 */
const TRACK_HEIGHT = 16;

export function TokenBudgetStrip({
  budget,
  titles,
}: {
  budget: PromptBudget<PromptFlowNodeKey>;
  /** 節點 key → 段落名，供圖例直接標示（不靠顏色單獨識別） */
  titles: Partial<Record<PromptFlowNodeKey, string>>;
}) {
  const limit = budget.profile.limitTokens;
  // 軸長：窗口與實際用量取大的一邊，超出的部分才有地方畫
  const axis = Math.max(limit ?? 0, budget.total.max, 1);
  const pct = (value: number) => `${Math.min(100, (value / axis) * 100)}%`;

  return (
    <figure data-testid="token-budget-strip" style={{ margin: "8px 0 0" }}>
      <div
        role="img"
        aria-label={describeBudget(budget, titles)}
        style={{ position: "relative", height: TRACK_HEIGHT, borderRadius: 4, background: "var(--surface-sunken)", overflow: "hidden" }}
      >
        {budget.segments.map((segment) => {
          const color = SECTION_COLORS[segment.id];
          return (
            <span key={String(segment.id)}>
              {/* 保守上界：半透明延伸，表示「可能到這裡」 */}
              <span
                style={{
                  position: "absolute",
                  insetBlock: 0,
                  left: pct(segment.startMin),
                  width: pct(segment.tokens.max),
                  background: color,
                  opacity: 0.28,
                }}
              />
              {/* 樂觀下界：實色。段與段之間留 2px 底色縫，相鄰色不會糊在一起 */}
              <span
                style={{
                  position: "absolute",
                  insetBlock: 0,
                  left: pct(segment.startMin),
                  width: `max(0px, calc(${pct(segment.tokens.min)} - 2px))`,
                  background: color,
                }}
              />
            </span>
          );
        })}

        {limit != null && limit < axis ? (
          <>
            {/* 窗口線右邊＝模型讀不到的區域 */}
            <span
              style={{
                position: "absolute",
                insetBlock: 0,
                left: pct(limit),
                right: 0,
                // 斜線夠明顯就好：太重會把底下的段落色蓋掉，看不出「哪一段」被切
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
        <span style={{ position: "absolute", right: 0 }}>約 {budget.total.min}–{budget.total.max}</span>
        {limit != null && limit < axis ? (
          <span
            style={{
              position: "absolute",
              left: pct(limit),
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
              color: "var(--fg)",
              fontWeight: 600,
            }}
          >
            窗口 {limit}
          </span>
        ) : null}
      </div>

      {/* 圖例：身分不能只靠顏色，每一段都直接標名字與 token 數 */}
      <figcaption style={{ display: "flex", gap: "4px 10px", flexWrap: "wrap", marginTop: 6 }}>
        {budget.segments.map((segment) => (
          <span key={String(segment.id)} style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: 11, color: "var(--fg-secondary)" }}>
            <span aria-hidden style={{ width: 9, height: 9, borderRadius: 2, background: SECTION_COLORS[segment.id], flex: "0 0 auto" }} />
            {titles[segment.id] ?? String(segment.id)}
            <span style={{ color: segment.status === "dropped" || segment.status === "truncated" ? "var(--danger-ink)" : undefined }}>
              {segment.tokens.min}–{segment.tokens.max}
            </span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** 讀屏用的一句話：圖上看得到的結論，聽也要聽得到 */
function describeBudget(
  budget: PromptBudget<PromptFlowNodeKey>,
  titles: Partial<Record<PromptFlowNodeKey, string>>,
): string {
  const limit = budget.profile.limitTokens;
  const head = `提示詞約 ${budget.total.min} 到 ${budget.total.max} token`;
  if (limit == null) return `${head}；這顆模型的文字窗口未公開，無法判定是否被截斷。`;
  const cut = budget.segments
    .filter((segment) => segment.status === "dropped" || segment.status === "truncated")
    .map((segment) => titles[segment.id] ?? String(segment.id));
  return cut.length
    ? `${head}，超過窗口 ${limit}；${cut.join("、")} 有內容沒有進入模型。`
    : `${head}，都在窗口 ${limit} 之內。`;
}
