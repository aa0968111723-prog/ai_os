/**
 * 供應商揭露的推理與逐 token 信心。
 *
 * 站內原則是「不保存、不假裝呈現模型私密思維鏈」（見 services/aiTrace 的遮蔽）。
 * 這裡放寬的**只有一件事**：供應商在正式 API 欄位裡主動回傳的推理摘要
 * （OpenAI 相容的 `reasoning_content`／fal-openrouter 的 `reasoning`）。
 *
 * 邊界要說死，否則這個功能就變成在騙人：
 * - 這是**供應商給的文字**，不是站內推論，也不保證等於模型真實的內部思考。
 * - 供應商沒給就沒有，站內絕不生成、不補寫、不改寫。
 * - 追蹤紀錄裡由 provider payload 帶進來的 `reasoning`／`thinking` 原始欄位
 *   仍然照舊被遮蔽；只有這個明確標示來源的欄位會顯示。
 *
 * token 信心則完全不是推測：logprob 是模型自己輸出的機率，
 * 取 exp 就是該 token 的機率值。
 */

export interface TokenConfidence {
  token: string;
  /** 0–1，由 logprob 取 exp 而來 */
  probability: number;
}

export interface LlmIntrospection {
  /** 供應商主動回傳的推理摘要（沒有就是沒有，站內不生成） */
  disclosedReasoning?: string;
  /** 整段輸出的平均 token 機率（0–1）：低＝模型自己也不確定 */
  meanConfidence?: number;
  /** 最不確定的幾個 token，供人判斷哪裡該覆核 */
  lowestConfidence?: TokenConfidence[];
  /** 供應商不支援 logprobs 時為 true——UI 據此說明「這顆模型沒有提供信心值」 */
  logprobsUnsupported?: boolean;
}

/** 取最不確定的前幾個 token（機率由低到高） */
export const LOW_CONFIDENCE_SAMPLE = 5;

export function summarizeLogprobs(
  tokens: ReadonlyArray<{ token: string; logprob: number }>,
): Pick<LlmIntrospection, "meanConfidence" | "lowestConfidence"> {
  const usable = tokens.filter((row) => typeof row.logprob === "number" && Number.isFinite(row.logprob));
  if (!usable.length) return {};
  // 平均取在 logprob 上再還原成機率（＝幾何平均），避免少數高機率 token 把結論拉高
  const meanLogprob = usable.reduce((sum, row) => sum + row.logprob, 0) / usable.length;
  const lowest = [...usable]
    .sort((a, b) => a.logprob - b.logprob)
    .slice(0, LOW_CONFIDENCE_SAMPLE)
    .map((row) => ({ token: row.token, probability: Math.exp(row.logprob) }));
  return { meanConfidence: Math.exp(meanLogprob), lowestConfidence: lowest };
}
