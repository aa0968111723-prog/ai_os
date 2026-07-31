import { z } from "zod";

/**
 * AI 代理規劃模型的使用者選擇。
 *
 * 模型只負責產生結構化計畫；所有工具／資料寫入仍由 Agent Runner 執行，
 * 不允許外部模型直接取得資料庫或服務憑證。
 */
export const agentPlannerModeSchema = z.enum([
  "auto",
  "nim",
  "fal_economy",
  "fal_balanced",
  "fal_quality",
]);

export type AgentPlannerMode = z.infer<typeof agentPlannerModeSchema>;

export const agentPlannerProviderSchema = z.enum([
  "nvidia-nim",
  "fal-openrouter",
  "mock",
]);

export type AgentPlannerProvider = z.infer<typeof agentPlannerProviderSchema>;

export const AGENT_PLANNER_OPTIONS: ReadonlyArray<{
  value: AgentPlannerMode;
  label: string;
  shortLabel: string;
  description: string;
  usageLabel: string;
}> = [
  {
    value: "auto",
    label: "自動備援（建議）",
    shortLabel: "自動備援",
    description: "先用 NIM；無回應或計畫格式不合格時，自動改由 fal.ai 平衡模型完成。",
    usageLabel: "NIM 優先・必要時才產生 Fal 用量",
  },
  {
    value: "nim",
    label: "只用 NVIDIA NIM",
    shortLabel: "只用 NIM",
    description: "不使用 fal.ai；NIM 忙碌時會直接提示稍後再試。",
    usageLabel: "不產生 Fal 用量",
  },
  {
    value: "fal_economy",
    label: "Fal 省用量",
    shortLabel: "Fal 省用量",
    description: "使用 Gemini 2.5 Flash Lite，適合日常、步驟較少的計畫。",
    usageLabel: "輸出上限 3,000 tokens",
  },
  {
    value: "fal_balanced",
    label: "Fal 均衡",
    shortLabel: "Fal 均衡",
    description: "使用 GPT-5 Mini，在規劃品質、速度與 token 用量間取得平衡。",
    usageLabel: "輸出上限 5,000 tokens",
  },
  {
    value: "fal_quality",
    label: "Fal 高品質",
    shortLabel: "Fal 高品質",
    description: "使用 Claude Sonnet 4.5，適合複雜依賴、長資料與正式交付計畫。",
    usageLabel: "輸出上限 8,000 tokens",
  },
];

export const agentPlannerUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  totalTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
});

export type AgentPlannerUsage = z.infer<typeof agentPlannerUsageSchema>;

/**
 * 可稽核的規劃遙測。只保存供應商、模型與計量資料，不保存提示詞、
 * 原始回答、reasoning 或 chain-of-thought。
 */
export const agentPlannerTelemetrySchema = agentPlannerUsageSchema.extend({
  requestedMode: agentPlannerModeSchema,
  provider: agentPlannerProviderSchema,
  model: z.string().trim().min(1).max(200),
  attemptCount: z.number().int().positive().max(10),
  fallbackFrom: agentPlannerProviderSchema.optional(),
  fallbackReason: z.enum(["provider_error", "invalid_output"]).optional(),
  // PR-E2 知識注入透明化：只記字數與截斷旗標（可稽核），不記知識內容本身
  knowledgeIncludedChars: z.number().int().nonnegative().optional(),
  knowledgeTotalChars: z.number().int().nonnegative().optional(),
  knowledgeTruncated: z.boolean().optional(),
});

export type AgentPlannerTelemetry = z.infer<typeof agentPlannerTelemetrySchema>;

export function getAgentPlannerOption(mode: AgentPlannerMode) {
  return AGENT_PLANNER_OPTIONS.find((option) => option.value === mode) ?? AGENT_PLANNER_OPTIONS[0];
}
