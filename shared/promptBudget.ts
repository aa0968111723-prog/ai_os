import { z } from "zod";

/**
 * 提示詞 token 預算的**實測**結果（伺服器量、前端只負責畫）。
 *
 * 這裡刻意沒有任何估算欄位。站內只內建 CLIP 分詞器，量得到就給真數字，
 * 量不到就 `measured: false` 並只給實際字數——留白比拿估算冒充量測誠實。
 *
 * 分詞在伺服器做的兩個理由：詞表近 5 萬條 merges（不該進前端 bundle），
 * 而且量測結果要能被 trace 與警告共用，只有一份來源才不會兩邊說法不同。
 */

export const promptBudgetSegmentSchema = z.object({
  /** 對應流程圖節點：使用者指令或某個注入段落 */
  key: z.enum(["instruction", "background", "character", "scene", "prop"]),
  /** 實測 token 數；未內建分詞器時為 null（不填估算值） */
  tokens: z.number().int().nonnegative().nullable(),
  /** 實際字數——量不到 token 時至少這個是真的 */
  chars: z.number().int().nonnegative(),
  /** 這一段在整串裡的起始 token 位置；未量測時 null */
  startToken: z.number().int().nonnegative().nullable(),
  /**
   * - `inside`：完整進入模型
   * - `truncated`：跨在窗口邊界上，後半沒進去
   * - `dropped`：起點就在窗口之外，整段沒進去
   * - `unmeasured`：這顆模型的分詞器沒內建，不下判斷
   */
  status: z.enum(["inside", "truncated", "dropped", "unmeasured"]),
});
export type PromptBudgetSegment = z.infer<typeof promptBudgetSegmentSchema>;

export const promptBudgetEncoderSchema = z.object({
  label: z.string().max(120),
  note: z.string().max(500),
  /** 有沒有真的量到；false＝以下只有字數是實的 */
  measured: z.boolean(),
  /** 序列總長（CLIP＝77，含頭尾特殊 token） */
  sequenceTokens: z.number().int().positive().optional(),
  /** 內容實際放得下的長度（CLIP＝77−2＝75） */
  contentTokens: z.number().int().positive().optional(),
  /** 公開資料載明、但站內量不到的窗口長度（只作參考，不拿來判斷截斷） */
  documentedLimitTokens: z.number().int().positive().optional(),
});
export type PromptBudgetEncoder = z.infer<typeof promptBudgetEncoderSchema>;

export const promptChunkSchema = z.object({
  /** CLIP 自己的切詞單位（一個詞或一串中日韓字），原文照抄 */
  text: z.string().max(120),
  /** 這個單位實際佔幾個 token */
  tokens: z.number().int().nonnegative(),
  /** 落在整串序列的第幾格 */
  startToken: z.number().int().nonnegative(),
  /** 屬於哪一段（顏色與流程圖節點對得起來） */
  key: promptBudgetSegmentSchema.shape.key,
  /** 這個詞有沒有完整進入窗口 */
  status: z.enum(["inside", "truncated", "dropped"]),
});
export type PromptChunk = z.infer<typeof promptChunkSchema>;

export const promptBudgetReportSchema = z.object({
  encoder: promptBudgetEncoderSchema,
  segments: z.array(promptBudgetSegmentSchema).max(10),
  totalTokens: z.number().int().nonnegative().nullable(),
  totalChars: z.number().int().nonnegative(),
  /** 實測總長超過內容窗口＝這次確定有字沒進模型 */
  overflows: z.boolean(),
  /**
   * 逐詞的實際佔用。這是「模型比較看重哪些字」唯一誠實的量測方向：
   * 注意力權重拿不到，但每個詞佔窗口幾格、落在第幾格、有沒有被切在線外，都是確定的事實。
   */
  chunks: z.array(promptChunkSchema).max(400).default([]),
});
export type PromptBudgetReport = z.infer<typeof promptBudgetReportSchema>;
