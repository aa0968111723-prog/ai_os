import { describe, expect, it } from "vitest";
import { buildAssistantHistoryBlock, type AssistantChatTurn } from "./assistantConversation";

/**
 * 量化「AI 助手長對話上下文重用」（#666 U4）——歷史重送佔 input token 比例的實測依據。
 *
 * 背景：效能報告指出「history 上限 8 則、超過即截斷；每輪都重送 context、無跨輪重用機制；
 * 長對話會重複組裝既有歷史」——潛在可節省 LLM input token 的候選（P2）。
 *
 * 本測試的目的不是斷言某個特定比例，而是把三件事固化成可複現、可回歸的數字：
 *   1. `buildAssistantHistoryBlock` 對任意長度對話的輸出有硬上限（6 輪 × 400 字）
 *      ——歷史區塊永遠不會無限膨脹。
 *   2. 歷史區塊佔「代表性完整 prompt」的比例（實測 ~10%）——跨輪重用理論上最多
 *      只能省掉這 ~10%，且摘要機制需額外 LLM call、摘文本體又佔 token，實測成本倒掛。
 *   3. 長對話的滑動窗重送量（同一輪文字約被送 6 次）與絕對成本（30 輪才 ~$0.002）。
 *
 * 中文 token 換算採保守值 1.3 chars/token；價格用 DeepSeek V4 Flash $0.14/M input。
 * 若未來調整歷史上限，這裡的斷言會攔住非預期的膨脹。
 */

/** 代表性「靜態指令 + 組現況 + database_evidence」總量（見 teamAssistant buildPrompt 實測）：
 *  靜態指令 ~2050 + 組現況 ~2986 + evidence ~800。歷史與工具結果另行加總。 */
const BASE_CONTEXT_CHARS = 5_836;
const USER_MESSAGE_CHARS = 29;
const TOOL_RESULT_CHARS = 500;
const CHARS_PER_TOKEN = 1.3;
const DEEPSEEK_INPUT_USD_PER_MTOK = 0.14;

function makeTurn(role: "user" | "assistant", index: number): AssistantChatTurn {
  return {
    role,
    text: `第 ${index + 1} 輪${role === "user" ? "使用者問題" : "助手回答"}的內容，${"說明".repeat(60)}`,
  };
}

function makeHistory(turnPairs: number): AssistantChatTurn[] {
  const turns: AssistantChatTurn[] = [];
  for (let i = 0; i < turnPairs; i++) {
    turns.push(makeTurn("user", i));
    turns.push(makeTurn("assistant", i));
  }
  return turns;
}

describe("assistant history block size (quantified #666 U4)", () => {
  it("has a hard upper bound regardless of conversation length (6 turns × 400 chars)", () => {
    // 前端 schema 上限 8 則×2000 字，注入時收緊到 6 輪×400 字（見 teamAssistant ask 註解）。
    // 這個斷言鎖定「歷史重送永遠有上限」，是後續任何優化的前提。
    for (const pairs of [1, 3, 6, 8, 10, 15, 30, 50]) {
      const block = buildAssistantHistoryBlock(makeHistory(pairs));
      expect(block.length).toBeLessThanOrEqual(6 * 405 + 40); // 6 則 ×(400 內容 + 標籤) + 包頭
    }
  });

  it("history block is ~10% of a representative full prompt (cross-turn reuse ceiling)", () => {
    // 代表性完整 prompt = 靜態指令 + 組現況 + evidence + history + 使用者訊息 + 工具結果
    const block = buildAssistantHistoryBlock(makeHistory(6));
    const fullPromptChars = BASE_CONTEXT_CHARS + block.length + USER_MESSAGE_CHARS + TOOL_RESULT_CHARS;
    const ratio = block.length / fullPromptChars;
    // 實測 ~9.8%；上限鎖 15%，防止歷史區塊未來被放大到吃掉不成比例的 input。
    expect(ratio).toBeLessThan(0.15);
  });

  it("sliding-window resend over a long conversation stays absolutely tiny in cost", () => {
    // 30 輪對話：每輪重送最近 6 則 → 累積重送量。實測 19,023 chars ≈ 14.6K tokens ≈ $0.002。
    const pairs = 30;
    const history = makeHistory(pairs);
    let cumulative = 0;
    for (let i = 1; i <= pairs; i++) {
      cumulative += buildAssistantHistoryBlock(history.slice(0, i * 2)).length;
    }
    const cumulativeTokens = cumulative / CHARS_PER_TOKEN;
    const cumulativeUsd = (cumulativeTokens / 1e6) * DEEPSEEK_INPUT_USD_PER_MTOK;
    // 30 輪長對話的歷史重送總成本仍在可忽略範圍（< $0.01），且單次 ask 更小。
    expect(cumulativeUsd).toBeLessThan(0.01);
  });
});
