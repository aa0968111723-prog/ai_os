/**
 * 代理用 LLM 的實價計點（全站單一真相）。
 *
 * 為什麼要有這一支：代理（專案代理的多步規劃、組代理總指揮的調度計畫）需要**高品質模型**
 * 才排得出可執行的計畫，而高品質模型是平台實付 USD 的——過去這條路走免費 NIM、站內收 0 點，
 * 於是「品質」與「誠實計費」二選一。這裡把 token 用量換成點數（1 點 ≈ NT$1，與模型目錄同一
 * 匯率基準），代理就能一律用好模型，而每一次規劃都留得下帳。
 *
 * 口徑與 shared/models.ts 完全一致：USD × USD_TO_TWD、四捨五入、付費呼叫最低 1 點。
 * 純函式、無 I/O，前後端共用（伺服器扣點、前端顯示「約幾點」）。
 */
import type { AgentPlannerMode } from "./agentPlanner";
import { USD_TO_TWD } from "./models";

export interface LlmModelPrice {
  label: string;
  /** 官方每百萬輸入 token 價（USD） */
  inputUsdPerMTok: number;
  /** 官方每百萬輸出 token 價（USD） */
  outputUsdPerMTok: number;
}

/**
 * 規劃檔位 → 實際模型 id。
 * server/services/llmProvider.ts 的 FAL_AGENT_PROFILES 直接吃這份對照，
 * 兩邊各留一份的話，換模型時「扣的點」與「跑的模型」必然對不上。
 */
export const AGENT_LLM_MODEL_IDS = {
  fal_economy: "deepseek/deepseek-v4-flash",
  fal_balanced: "openai/gpt-5.6-luna",
  fal_quality: "anthropic/claude-sonnet-4.5",
} as const;

/**
 * 官方 token 價（2026-08 查核）。改價只改這裡，估點／扣點／UI 顯示自動跟上。
 * 不在表內的模型（NVIDIA NIM 免費額度）一律視為 0 點——換算不了就不硬收。
 */
export const LLM_MODEL_PRICES: Readonly<Record<string, LlmModelPrice>> = {
  [AGENT_LLM_MODEL_IDS.fal_economy]: {
    label: "DeepSeek V4 Flash",
    inputUsdPerMTok: 0.14,
    outputUsdPerMTok: 0.28,
  },
  [AGENT_LLM_MODEL_IDS.fal_balanced]: {
    label: "GPT-5.6 Luna",
    inputUsdPerMTok: 0.2,
    outputUsdPerMTok: 1.2,
  },
  [AGENT_LLM_MODEL_IDS.fal_quality]: {
    label: "Claude Sonnet 4.5",
    inputUsdPerMTok: 3,
    outputUsdPerMTok: 15,
  },
  // Kimi K3（any-llm 目錄新收；推廣價 $2/$10 至 2026-08-31，期滿回 $3/$15）
  "moonshotai/kimi-k3": {
    label: "Kimi K3",
    inputUsdPerMTok: 2,
    outputUsdPerMTok: 10,
  },
  // 舊版退路：昇版後不再指派，仍保留價目讓在途/歷史生成正確計價，不當成免費。
  "openai/gpt-5-mini": {
    label: "GPT-5 Mini",
    inputUsdPerMTok: 0.25,
    outputUsdPerMTok: 2,
  },
  "google/gemini-2.5-flash-lite": {
    label: "Gemini 2.5 Flash Lite",
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.4,
  },
};

/**
 * 中文提示詞的保守 token 估算：1 token ≈ 1.4 字。
 * 刻意高估（中英混排實測約 1.5–3 字／token）——預留寧可多收再退，也不要事後補扣到超額。
 */
export const CHARS_PER_TOKEN = 1.4;

/** 每次規劃的輸出 token 假設（UI 顯示「約幾點」用；實扣以供應商回報為準） */
export const TYPICAL_PLAN_OUTPUT_TOKENS = 2_000;
/** 一份典型規劃提示詞的字數（UI 顯示「約幾點」用） */
export const TYPICAL_PLAN_PROMPT_CHARS = 12_000;

export interface LlmTokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** 供應商回報的實際費用（fal 的 usage.cost）；有就以它為準 */
  costUsd?: number;
}

/** 字數 → token 數（保守高估；下限 0） */
export function estimateTokensFromChars(chars: number): number {
  if (!Number.isFinite(chars) || chars <= 0) return 0;
  // 1e-9 容差：1400/1.4 在 IEEE 754 是 1000.0000000000001，直接 ceil 會平白多一個 token
  return Math.ceil(chars / CHARS_PER_TOKEN - 1e-9);
}

/** USD → 點數（1 點 ≈ NT$1）。>0 的付費呼叫至少 1 點，0／負數不收。 */
export function pointsFromUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.max(1, Math.round(usd * USD_TO_TWD));
}

/** 這個模型是否走免費額度（不在價目表＝免費，例如 NVIDIA NIM） */
export function isFreeLlmModel(modelId: string | undefined | null): boolean {
  return !modelId || !(modelId in LLM_MODEL_PRICES);
}

export function llmModelPrice(modelId: string): LlmModelPrice | undefined {
  return LLM_MODEL_PRICES[modelId];
}

/** 規劃檔位使用的模型 id；免費檔（nim／auto 的第一順位）回 null */
export function plannerModelId(mode: AgentPlannerMode): string | null {
  if (mode === "fal_economy" || mode === "fal_balanced" || mode === "fal_quality") {
    return AGENT_LLM_MODEL_IDS[mode];
  }
  return null;
}

/**
 * 預留估點用的模型：auto 會在 NIM 失敗時轉 fal 均衡，故一律以「可能真的跑到的付費模型」預留，
 * 沒跑到就在結算時全額退回。不預留的話，auto 備援那一次就是無帳可查的花費。
 */
export function billingModelIdForMode(mode: AgentPlannerMode): string | null {
  if (mode === "auto") return AGENT_LLM_MODEL_IDS.fal_balanced;
  return plannerModelId(mode);
}

/** token 用量 → USD（缺少輸入／輸出拆分時，以 8:2 的規劃典型比例分攤 totalTokens） */
export function llmUsdForUsage(modelId: string, usage: LlmTokenUsage | undefined): number | null {
  const price = LLM_MODEL_PRICES[modelId];
  if (!price || !usage) return null;
  if (usage.costUsd != null && Number.isFinite(usage.costUsd) && usage.costUsd > 0) return usage.costUsd;
  let promptTokens = usage.promptTokens;
  let completionTokens = usage.completionTokens;
  if (promptTokens == null && completionTokens == null) {
    if (usage.totalTokens == null || !Number.isFinite(usage.totalTokens) || usage.totalTokens <= 0) return null;
    promptTokens = Math.round(usage.totalTokens * 0.8);
    completionTokens = usage.totalTokens - promptTokens;
  }
  const inTok = Math.max(0, promptTokens ?? 0);
  const outTok = Math.max(0, completionTokens ?? 0);
  return (inTok * price.inputUsdPerMTok + outTok * price.outputUsdPerMTok) / 1_000_000;
}

/**
 * 實際用量 → 實扣點數。
 * 回傳 null＝「這次無法計量」（供應商沒回 usage）——呼叫端保留預留值，不要當成 0 點免費送。
 * 免費模型（NIM）一律 0 點。
 */
export function llmPointsForUsage(modelId: string | undefined | null, usage: LlmTokenUsage | undefined): number | null {
  if (isFreeLlmModel(modelId)) return 0;
  const usd = llmUsdForUsage(modelId as string, usage);
  if (usd == null) return null;
  return pointsFromUsd(usd);
}

/** 一次規劃可能跨多個模型（auto 先 NIM 再備援 fal、JSON 修復重試）——各自的用量要各自計價 */
export interface LlmUsageEntry {
  model: string;
  usage?: LlmTokenUsage;
}

/**
 * 多模型用量 → 實扣點數：先各自換算 USD 再一次轉點（不是每筆各自進位）。
 *
 * 為什麼不能只用「最後一個模型 × 總 token」：auto 模式下 NIM（免費）與 fal（付費）的 token
 * 會一起累加，用 fal 單價乘總量等於把免費那段也收錢；反過來（用 NIM 收費）則是平台白付。
 * 回傳 null＝全程沒有任何可計量的用量（呼叫端保留預留值，不當免費）。
 */
export function llmPointsForUsageEntries(entries: LlmUsageEntry[]): number | null {
  let usd = 0;
  let measured = false;
  for (const entry of entries) {
    if (isFreeLlmModel(entry.model)) {
      measured = true; // 免費模型有跑過就是「量得到、金額為 0」，不是量不到
      continue;
    }
    const each = llmUsdForUsage(entry.model, entry.usage);
    if (each == null) continue;
    usd += each;
    measured = true;
  }
  if (!measured) return null;
  return pointsFromUsd(usd);
}

export interface PlannerEstimateInput {
  /** 送進模型的提示詞字數 */
  promptChars: number;
  /** 該檔位的輸出上限 token（最壞情況） */
  maxOutputTokens: number;
  /** 同一次規劃可能重試幾次（JSON 修復／備援）——預留要含進去，否則第二次呼叫等於沒帳 */
  attempts?: number;
}

/**
 * 規劃前的預留點數（最壞情況）：輸入依提示詞字數、輸出以該檔位上限計，再乘上可能的重試次數。
 * 免費檔回 0（reserveQuota 對 0 點直接放行，不寫雜訊帳本列）。
 */
export function estimatePlannerPoints(mode: AgentPlannerMode, input: PlannerEstimateInput): number {
  const modelId = billingModelIdForMode(mode);
  if (!modelId) return 0;
  const price = LLM_MODEL_PRICES[modelId];
  if (!price) return 0;
  const attempts = Math.max(1, Math.floor(input.attempts ?? 1));
  const inTok = estimateTokensFromChars(input.promptChars);
  const outTok = Math.max(0, input.maxOutputTokens);
  const usd = ((inTok * price.inputUsdPerMTok + outTok * price.outputUsdPerMTok) / 1_000_000) * attempts;
  return pointsFromUsd(usd);
}

/** UI 顯示用：一次典型規劃大約幾點（免費檔回 0） */
export function typicalPlannerPoints(mode: AgentPlannerMode): number {
  return estimatePlannerPoints(mode, {
    promptChars: TYPICAL_PLAN_PROMPT_CHARS,
    maxOutputTokens: TYPICAL_PLAN_OUTPUT_TOKENS,
  });
}

/** UI 顯示用的一行成本標示（選檔位的按鈕、確認視窗共用同一句） */
export function plannerCostLabel(mode: AgentPlannerMode): string {
  const modelId = plannerModelId(mode);
  if (!modelId) {
    return mode === "auto" ? "免費優先・備援才計點" : "免費額度・0 點";
  }
  return `約 ${typicalPlannerPoints(mode)} 點／次（依實際 token 結算）`;
}

export interface PointsSettlement {
  /** 實際低於預留時要退回的點數 */
  refund: number;
  /** 實際高於預留時要補扣的點數 */
  extra: number;
}

/**
 * 預留 ↔ 實際的多退少補。
 * 生成類是「估點即扣、失敗全退」；LLM 的計費量要跑完才知道，所以多一道結算——
 * 沒有它的話，預留高估就是永久超收，預留低估就是平台白付。
 */
export function settlePoints(reserved: number, actual: number): PointsSettlement {
  const r = Number.isFinite(reserved) ? Math.max(0, Math.round(reserved)) : 0;
  const a = Number.isFinite(actual) ? Math.max(0, Math.round(actual)) : 0;
  return { refund: Math.max(0, r - a), extra: Math.max(0, a - r) };
}
