import type { PromptBudgetReport, PromptBudgetSegment, PromptChunk } from "../../shared/promptBudget";
import { splitPromptSections } from "../../shared/promptSections";
import { textEncoderProfileFor } from "../../shared/textEncoders";
import { CLIP_CONTENT_TOKENS, CLIP_SEQUENCE_TOKENS, clipEncodeChunks, clipTokenCount } from "./clipTokenizer";

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

export function measurePromptBudget(modelId: string, positivePrompt: string): PromptBudgetReport {
  const profile = textEncoderProfileFor(modelId);
  const { head, sections } = splitPromptSections(positivePrompt);

  // 段落的原文（含標記），順序＝實際疊加順序；模型收到的就是這一串
  const parts: Array<{ key: PromptBudgetSegment["key"]; text: string }> = [
    ...(head ? [{ key: "instruction" as const, text: head }] : []),
    ...sections.map((section) => ({ key: section.def.key, text: section.raw })),
  ];

  const measurable = profile.tokenizer === "clip-bpe";
  const contentLimit = measurable ? CLIP_CONTENT_TOKENS : undefined;

  const chunks: PromptChunk[] = [];
  let cursorText = "";
  let cursorTokens = 0;
  const segments: PromptBudgetSegment[] = parts.map((part) => {
    const chars = part.text.length;
    if (!measurable) {
      return { key: part.key, tokens: null, chars, startToken: null, status: "unmeasured" };
    }
    cursorText = cursorText ? `${cursorText}\n\n${part.text}` : part.text;
    const endTokens = clipTokenCount(cursorText);
    const startToken = cursorTokens;
    const tokens = Math.max(0, endTokens - cursorTokens);
    cursorTokens = endTokens;

    // 逐詞佔用：切詞單位是 CLIP 自己的 pre-tokenize 規則，段內累加剛好等於整段 token 數
    let chunkCursor = startToken;
    for (const chunk of clipEncodeChunks(part.text)) {
      const chunkEnd = chunkCursor + chunk.tokens;
      chunks.push({
        text: chunk.text,
        tokens: chunk.tokens,
        startToken: chunkCursor,
        key: part.key,
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
      ...(measurable
        ? { sequenceTokens: CLIP_SEQUENCE_TOKENS, contentTokens: CLIP_CONTENT_TOKENS }
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
  };
}
