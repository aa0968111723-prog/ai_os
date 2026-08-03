import { useState } from "react";
import type { PromptBudgetReport, PromptChunk } from "@shared/promptBudget";
import { Hint, Meta } from "../../components/ui";
import { SECTION_COLORS } from "./TokenBudgetStrip";

/**
 * 逐詞佔用圖：這個提示詞裡，模型到底讀到哪些字、每個詞吃掉窗口的幾格。
 *
 * 為什麼不是「注意力熱圖」：注意力權重是模型內部張量，fal／NIM 這類 hosted API
 * 不回傳，任何宣稱「這次的注意力分布」的圖都只能是編的。**這張圖畫的是版面，不是權重**
 * ——每個詞佔幾格、落在第幾格、有沒有被切在窗口外，全部是用內建 CLIP 詞表真的分詞
 * 量出來的確定事實。
 *
 * 版面本身就很有解釋力：中文一個字要 2–3 個 token，六個字的道具描述可能吃掉窗口的
 * 四分之一，而 "hand-drawn" 只佔 3 格。誰佔得多、誰被擠到線外，直接決定畫面偏向誰。
 * 要進一步證明某一段真的影響了成品，用下方的消融實測。
 */

/**
 * 依佔用格數決定**底色**深度：佔得越多，色越實。
 * 只調背景不調整個元素的 opacity——把字一起調淡就看不清了，
 * 而這張圖的重點正是「哪個詞」。
 */
function fillFor(color: string, tokens: number, max: number): string {
  const ratio = max > 0 ? Math.min(1, tokens / max) : 0;
  return `color-mix(in srgb, ${color} ${Math.round(18 + ratio * 62)}%, var(--card2))`;
}

function ChunkPill({ chunk, max }: { chunk: PromptChunk; max: number }) {
  const cut = chunk.status !== "inside";
  return (
    <span
      title={`${chunk.text}：${chunk.tokens} 格（第 ${chunk.startToken + 1} 格起）${cut ? "・在窗口之外" : ""}${chunk.unknown ? "・詞表裡沒有這些字，模型讀不到語意" : ""}`}
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 5,
        fontSize: 13,
        lineHeight: 1.5,
        color: cut ? "var(--fg-secondary)" : "var(--fg)",
        // 底色＝段落色，深度＝佔用比重；被切掉的字畫刪除線＋虛線框。
        // 詞表沒有的字另外標：它佔的格數很少，但語意是全丟的——只看格數會誤判成「很省」。
        background: cut ? "transparent" : chunk.unknown ? "var(--gold-soft)" : fillFor(SECTION_COLORS[chunk.key], chunk.tokens, max),
        border: cut ? "1px dashed var(--border-strong)" : chunk.unknown ? "1px solid var(--gold)" : "1px solid transparent",
        textDecoration: cut ? "line-through" : undefined,
      }}
    >
      {chunk.text}
      {chunk.unknown ? <span style={{ fontSize: 10, color: "var(--gold-ink)" }}>未知</span> : null}
      <span style={{ fontSize: 10, color: "var(--fg-secondary)" }}>{chunk.tokens}</span>
    </span>
  );
}

export function PromptTokenMap({ budget }: { budget: PromptBudgetReport }) {
  const [open, setOpen] = useState(false);
  if (!budget.encoder.measured || !budget.chunks.length) return null;

  const max = Math.max(...budget.chunks.map((chunk) => chunk.tokens));
  const cut = budget.chunks.filter((chunk) => chunk.status !== "inside");
  // 佔最多格的前幾個詞：它們就是這次提示詞裡最占版面的東西
  const heaviest = [...budget.chunks].sort((a, b) => b.tokens - a.tokens).slice(0, 3);

  return (
    <details
      data-testid="prompt-token-map"
      open={open}
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      style={{ marginTop: 8 }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 13 }}>
        逐詞佔用：模型讀到哪些字
      </summary>

      <Hint layer="always" style={{ marginTop: 6 }}>
        這是「版面」不是注意力權重：供應商不回傳模型內部的注意力，站內不會畫那種圖。
        下面每個詞後面的小數字，是它用 {budget.encoder.label} 的詞表實際佔掉的格數。
      </Hint>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
        {budget.chunks.map((chunk, index) => (
          <ChunkPill key={`${chunk.startToken}-${index}`} chunk={chunk} max={max} />
        ))}
      </div>

      <Meta as="p" style={{ margin: "8px 0 0" }}>
        {/* 每個詞都只佔一格時（sentencepiece 常見），「最占版面」沒有資訊量，不必寫 */}
        {max > 1 ? `最占版面：${heaviest.map((chunk) => `${chunk.text}（${chunk.tokens} 格）`).join("、")}。` : ""}
        {cut.length
          ? `窗口 ${budget.encoder.contentTokens} 格已滿，畫刪除線的 ${cut.length} 個詞沒有進入模型。`
          : `全部 ${budget.totalTokens} 格都在窗口 ${budget.encoder.contentTokens} 之內。`}
      </Meta>
      {budget.unknownTokens ? (
        <Meta as="p" style={{ margin: "6px 0 0", color: "var(--gold-ink)" }}>
          標「未知」的 {budget.unknownTokens} 個位置，是這顆模型的詞表裡查無此字——
          模型只知道那裡有東西，不知道是什麼。這種位置佔的格數很少，但語意是全丟的。
        </Meta>
      ) : null}
      <Meta as="p" style={{ margin: "4px 0 0" }}>
        佔得多不等於模型一定照著畫；要證明某一段真的影響成品，用下方的影響力實測比對兩張圖。
      </Meta>
    </details>
  );
}
