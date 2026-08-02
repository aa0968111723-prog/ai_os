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

/**
 * 代理規劃的預設檔位＝高品質模型。
 *
 * 過去預設是「免費 NIM 優先」，代價是代理常排出結構鬆散、依賴亂接的計畫，而使用者要花
 * 真金白銀的執行點數去跑那份計畫——省下規劃的幾毛錢，賠掉整份計畫的執行成本。
 * 現在規劃本身依實際 token 計點（見 shared/llmPricing），花費看得到也擋得住額度，
 * 所以預設直接給好模型；要省的人仍可自己改成 auto／nim／經濟檔。
 */
export const DEFAULT_AGENT_PLANNER_MODE: AgentPlannerMode = "fal_quality";

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
    value: "fal_quality",
    label: "高品質（預設）",
    shortLabel: "高品質",
    description: "使用 Claude Sonnet 4.5，適合複雜依賴、長資料與正式交付計畫。規劃依實際 token 扣點。",
    usageLabel: "輸出上限 8,000 tokens・依 token 計點",
  },
  {
    value: "fal_balanced",
    label: "均衡",
    shortLabel: "均衡",
    description: "使用 GPT-5 Mini，在規劃品質、速度與點數之間取得平衡。",
    usageLabel: "輸出上限 5,000 tokens・依 token 計點",
  },
  {
    value: "fal_economy",
    label: "省點數",
    shortLabel: "省點數",
    description: "使用 Gemini 2.5 Flash Lite，適合日常、步驟較少的計畫。",
    usageLabel: "輸出上限 3,000 tokens・依 token 計點",
  },
  {
    value: "auto",
    label: "免費優先（自動備援）",
    shortLabel: "免費優先",
    description: "先用免費的 NVIDIA NIM；無回應或計畫格式不合格時，自動改由 fal.ai 均衡模型完成。",
    usageLabel: "NIM 免費・備援才計點",
  },
  {
    value: "nim",
    label: "只用免費模型",
    shortLabel: "只用免費",
    description: "只用 NVIDIA NIM 免費額度，站內 0 點；NIM 忙碌時會直接提示稍後再試。",
    usageLabel: "免費額度・0 點",
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
  /** 規劃前預留的點數（最壞情況估算；見 shared/llmPricing.estimatePlannerPoints） */
  pointsReserved: z.number().int().nonnegative().optional(),
  /** 依供應商實際用量結算後的實扣點數（多退少補後的最終值） */
  pointsActual: z.number().int().nonnegative().optional(),
  // PR-E2 知識注入透明化：只記字數與截斷旗標（可稽核），不記知識內容本身
  knowledgeIncludedChars: z.number().int().nonnegative().optional(),
  knowledgeTotalChars: z.number().int().nonnegative().optional(),
  knowledgeTruncated: z.boolean().optional(),
});

export type AgentPlannerTelemetry = z.infer<typeof agentPlannerTelemetrySchema>;

export function getAgentPlannerOption(mode: AgentPlannerMode) {
  return AGENT_PLANNER_OPTIONS.find((option) => option.value === mode) ?? AGENT_PLANNER_OPTIONS[0];
}
