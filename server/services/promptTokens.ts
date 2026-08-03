import type { PromptBudgetReport, PromptBudgetSegment, PromptChunk } from "../../shared/promptBudget";
import { splitPromptSections } from "../../shared/promptSections";
import { textEncoderProfileFor } from "../../shared/textEncoders";
import { CLIP_CONTENT_TOKENS, CLIP_SEQUENCE_TOKENS, clipEncodeChunks, clipTokenCount } from "./clipTokenizer";
import {
  T5_CONTENT_TOKENS,
  T5_SCHNELL_CONTENT_TOKENS,
  T5_SCHNELL_SEQUENCE_TOKENS,
  T5_SEQUENCE_TOKENS,
  t5TokenCount,
  t5Tokens,
} from "./t5Tokenizer";

/**
 * 提示詞的 token 實測（不是估算）。
 *
 * 站內只內建 CLIP 分詞器，所以只有 CLIP 家族（SDXL 那條線、窗口 77）報得出真實
 * 數字。其他家族（T5／umT5／ChatGLM／Gemma…）的分詞器沒有內建，就**不報 token 數**
 * ——寧可留白，也不要拿估算冒充量測。未量測時只給實際字數，那也是真的資料。
 *
 * 每一段的 token 數用「累積前綴」量：BPE 會跨段落邊界合併，分段各自 encode 再相加
 * 得到的是另一個數字。逐段量累積前綴，界線才落在真實序列的同一個位置。
 */

/**
 * sentencepiece 的 `▁` 是詞首空白標記。它自己就是一個 token，但畫面上單獨顯示是
 * 一個空膠囊——沒有資訊還佔版面。這裡把它併進下一個片段：格數照算（總數不變），
 * 顯示則跟著它標記的那個詞走。
 */
function mergeWordMarkers(tokens: ReadonlyArray<{ text: string; unknown: boolean }>) {
  const merged: Array<{ text: string; tokens: number; unknown: boolean }> = [];
  let carried = 0;
  for (const token of tokens) {
    const text = token.text.replaceAll("\u2581", " ").trim();
    if (!text) {
      carried += 1;
      continue;
    }
    merged.push({ text, tokens: 1 + carried, unknown: token.unknown });
    carried = 0;
  }
  // 結尾若只剩空白標記，掛回最後一個片段，總數才不會少算
  if (carried) {
    if (merged.length) merged[merged.length - 1].tokens += carried;
    else merged.push({ text: " ", tokens: carried, unknown: false });
  }
  return merged;
}

export function measurePromptBudget(modelId: string, positivePrompt: string): PromptBudgetReport {
  const profile = textEncoderProfileFor(modelId);
  const { head, sections } = splitPromptSections(positivePrompt);

  // 段落的原文（含標記），順序＝實際疊加順序；模型收到的就是這一串
  const parts: Array<{ key: PromptBudgetSegment["key"]; text: string }> = [
    ...(head ? [{ key: "instruction" as const, text: head }] : []),
    ...sections.map((section) => ({ key: section.def.key, text: section.raw })),
  ];

  // 內建詞表的兩條線：CLIP（SDXL）與 T5（FLUX.1）。其餘一律不量。
  const clip = profile.tokenizer === "clip-bpe";
  const t5 = profile.tokenizer === "t5";
  const schnell = profile.key === "flux1-schnell";
  const measurable = clip || t5;
  const sequenceTokens = clip
    ? CLIP_SEQUENCE_TOKENS
    : t5 ? (schnell ? T5_SCHNELL_SEQUENCE_TOKENS : T5_SEQUENCE_TOKENS) : undefined;
  const contentLimit = clip
    ? CLIP_CONTENT_TOKENS
    : t5 ? (schnell ? T5_SCHNELL_CONTENT_TOKENS : T5_CONTENT_TOKENS) : undefined;
  const countTokens = clip ? clipTokenCount : t5TokenCount;

  const chunks: PromptChunk[] = [];
  let unknownTokens = 0;
  let cursorText = "";
  let cursorTokens = 0;
  const segments: PromptBudgetSegment[] = parts.map((part) => {
    const chars = part.text.length;
    if (!measurable) {
      return { key: part.key, tokens: null, chars, startToken: null, status: "unmeasured" };
    }
    cursorText = cursorText ? `${cursorText}\n\n${part.text}` : part.text;
    const endTokens = countTokens(cursorText);
    const startToken = cursorTokens;
    const tokens = Math.max(0, endTokens - cursorTokens);
    cursorTokens = endTokens;

    // 逐詞佔用：切詞單位用分詞器自己的規則（CLIP 的 pre-tokenize／T5 的 unigram 片段），
    // 不是我們另外斷詞；段內累加等於整段 token 數。
    let chunkCursor = startToken;
    const parted = clip
      ? clipEncodeChunks(part.text).map((chunk) => ({ text: chunk.text, tokens: chunk.tokens, unknown: false }))
      : mergeWordMarkers(t5Tokens(part.text));
    for (const chunk of parted) {
      const chunkEnd = chunkCursor + chunk.tokens;
      if (chunk.unknown) unknownTokens += chunk.tokens;
      chunks.push({
        text: chunk.text,
        tokens: chunk.tokens,
        startToken: chunkCursor,
        key: part.key,
        unknown: chunk.unknown,
        status: contentLimit == null || chunkEnd <= contentLimit
          ? "inside"
          : chunkCursor >= contentLimit ? "dropped" : "truncated",
      });
      chunkCursor = chunkEnd;
    }

    const status: PromptBudgetSegment["status"] =
      contentLimit == null ? "unmeasured"
        : startToken >= contentLimit ? "dropped"
          : endTokens > contentLimit ? "truncated"
            : "inside";
    return { key: part.key, tokens, chars, startToken, status };
  });

  const totalChars = parts.reduce((sum, part) => sum + part.text.length, 0);
  return {
    encoder: {
      label: profile.label,
      note: profile.note,
      measured: measurable,
      ...(measurable && sequenceTokens != null && contentLimit != null
        ? { sequenceTokens, contentTokens: contentLimit }
        : profile.limitTokens != null
          ? { documentedLimitTokens: profile.limitTokens }
          : {}),
    },
    segments,
    totalTokens: measurable ? cursorTokens : null,
    totalChars,
    overflows: contentLimit != null && cursorTokens > contentLimit,
    // 極長提示詞才會撞到上限；截斷時窗口那條線早就過去了，後面全是進不去的字
    chunks: chunks.slice(0, 400),
    // T5 的詞表沒有中日韓字元，中文會整串塌成一個 <unk>——這個數字就是「模型讀不懂的部分」
    unknownTokens: measurable ? unknownTokens : null,
  };
}
