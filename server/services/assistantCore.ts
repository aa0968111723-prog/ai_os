import type { AuthState } from "./auth";

/**
 * 助手共用迴圈核心（GLOBAL_ASSISTANT_PLAN §4.1 的收斂立約點）。
 *
 * 站內已有兩份幾乎相同的「提示詞式 JSON 工具迴圈」（assistant.ts 專案助手、
 * teamAssistant.ts 組助手），regex 撈 JSON 的寫法散在至少 8 處。這裡把
 * 「LLM 呼叫 → JSON 抽取 → 工具 dispatch → 強制收尾 → 純文字 fallback」
 * 收斂成一份：**自此任何新助手／代理迴圈只准用這裡**，既有兩份逐步遷入。
 *
 * 刻意保持薄：不認識任何供應商（llm 由呼叫端閉包注入）、不認識任何工具
 * schema（tryToolCall/tryReply 由呼叫端用自己的 zod schema 包裝）——
 * NIM 原生 tool calling spike 有答案後，只換呼叫端注入的 llm/prompt 策略，
 * 這一層與所有呼叫端都不必動。
 */

/** 從 LLM 原始輸出抽第一段 {...}；抽不到或壞 JSON 回 null（regex 撈 JSON 的唯一實作） */
export function extractJsonObject(raw: string): unknown {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

/** 把 JSON 段落從原始輸出剝掉，留下人話（壞 JSON 回答的 fallback 顯示用） */
export function stripJsonObject(raw: string): string {
  return raw.replace(/\{[\s\S]*\}/, "").trim();
}

/** 一次工具執行的結果：step＝給使用者看的一行摘要；text＝回餵 LLM 的結果文字 */
export interface ToolLoopStepResult {
  step: string;
  text: string;
}

export interface ToolLoopOptions<TToolCall, TReply> {
  /** 最多幾輪工具查詢（每輪一次 LLM 呼叫；超過強制收尾） */
  maxToolRounds: number;
  /** 用戶端斷線訊號：中止時不再發起下一輪 LLM 呼叫 */
  signal?: AbortSignal;
  /** 呼叫 LLM 一次，回原始文字（供應商細節由呼叫端閉包持有） */
  llm: (prompt: string, round: number, forceFinal: boolean) => Promise<string>;
  /** 組每輪完整提示詞（toolBlocks＝累積的 <工具結果> 區塊） */
  buildPrompt: (toolBlocks: string, forceFinal: boolean) => string;
  /** JSON → 工具呼叫（解析失敗回 null＝走 reply 分支）。用呼叫端自己的 zod schema。 */
  tryToolCall: (json: unknown) => TToolCall | null;
  /** 執行一個唯讀工具。**這一層不做權限判斷**——ACL 在被呼叫的 core/service 內部。 */
  execTool: (call: TToolCall, round: number) => Promise<ToolLoopStepResult>;
  /** 工具名（工具結果區塊標籤＋onToolResult 回報用） */
  toolName: (call: TToolCall) => string;
  /** JSON → 最終回答（解析失敗回 null＝走 fallback） */
  tryReply: (json: unknown) => TReply | null;
  /** 壞 JSON／無 JSON 時以純文字組最終回答（LLM 已呼叫，成本已花，至少把話帶回去） */
  fallback: (rawText: string) => TReply;
  /** 每輪開始（round 0-based；forceFinal＝這輪不得再用工具）——SSE「思考中」與 trace 用 */
  onRound?: (round: number, forceFinal: boolean) => void | Promise<void>;
  /** LLM 回應到手（trace provider_request/response 用；latencyMs 由這裡計） */
  onLlmResult?: (raw: string, round: number, latencyMs: number) => void | Promise<void>;
  /** 工具即將執行（SSE「正在查…」與 trace tool_call 用） */
  onToolCall?: (call: TToolCall, round: number) => void | Promise<void>;
  /** 工具跑完（SSE step 與 trace tool_result 用） */
  onToolResult?: (call: TToolCall, result: ToolLoopStepResult, round: number) => void | Promise<void>;
}

export interface ToolLoopOutcome<TReply> {
  /** 最終回答（fallback 也算）；aborted 時為 null */
  reply: TReply | null;
  /** 每次工具執行的一行摘要（依序） */
  steps: string[];
  /** 用戶端斷線提早收工（reply=null，呼叫端自行決定回什麼） */
  aborted: boolean;
  /** 最終回答是否走了純文字 fallback（解析失敗） */
  usedFallback: boolean;
}

/**
 * 提示詞式 JSON 工具迴圈：
 * 每輪 LLM 回「工具呼叫」就執行並把結果附進下一輪；回「最終回答」就結束；
 * 超過 maxToolRounds 強制收尾（提示詞明講不得再用工具、也不再受理工具 JSON）。
 */
export async function runToolLoop<TToolCall, TReply>(
  opts: ToolLoopOptions<TToolCall, TReply>,
): Promise<ToolLoopOutcome<TReply>> {
  const steps: string[] = [];
  let toolBlocks = "";
  for (let round = 0; ; round++) {
    if (opts.signal?.aborted) return { reply: null, steps, aborted: true, usedFallback: false };
    const forceFinal = round >= opts.maxToolRounds;
    await opts.onRound?.(round, forceFinal);
    const startedAt = Date.now();
    const raw = await opts.llm(opts.buildPrompt(toolBlocks, forceFinal), round, forceFinal);
    await opts.onLlmResult?.(raw, round, Date.now() - startedAt);
    const json = extractJsonObject(raw);
    // 先試工具呼叫（強制收尾輪不再受理，防 LLM 無視指示繼續打轉）
    if (json !== null && !forceFinal) {
      const call = opts.tryToolCall(json);
      if (call !== null) {
        await opts.onToolCall?.(call, round);
        const result = await opts.execTool(call, round);
        steps.push(result.step);
        await opts.onToolResult?.(call, result, round);
        toolBlocks += `\n<工具結果 tool="${opts.toolName(call)}" 第${round + 1}輪>\n${result.text}\n</工具結果>`;
        continue;
      }
    }
    const reply = json !== null ? opts.tryReply(json) : null;
    if (reply !== null) return { reply, steps, aborted: false, usedFallback: false };
    // 解析失敗：純文字 fallback（不提議任何動作——動作必須來自結構化回覆）
    return { reply: opts.fallback(stripJsonObject(raw) || raw.trim()), steps, aborted: false, usedFallback: true };
  }
}

/**
 * 站內助手唯讀 scope 的單一出處。
 *
 * 不變式（GLOBAL_ASSISTANT_PLAN §4.3 紅線一）：**LLM 工具迴圈交給 callTool 的
 * scope 永遠是唯讀**——38+ 支寫入工具在 runTool 第一行就被 scopeDeniedReason 擋掉，
 * 寫入意圖只能以「提議」離開 LLM，經使用者逐動作確認後由 runSiteAction／runAction
 * 以本人身分執行。這個常數 export 給測試鎖定：任何人改掉它都會被測試抓到。
 */
export const ASSISTANT_READONLY_SCOPE: { readonly readOnly: true } = { readOnly: true } as const;

/** 型別防呆：站內助手迴圈內的 callTool 包裝一律經這裡拿 scope，禁止手寫 {readOnly:false} */
export function assistantToolScope(_auth: AuthState): { readonly readOnly: true } {
  return ASSISTANT_READONLY_SCOPE;
}
