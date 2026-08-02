import { z } from "zod";

/**
 * 使用者可驗證的 AI 應用層軌跡。這不是模型私密思維鏈；只描述系統真正組裝、送出、
 * 查詢、驗證與收到的資料。所有 provider reasoning/thinking 欄位都會在伺服器端剔除。
 */
export const aiOperationModeSchema = z.enum([
  "ask",
  "generate",
  "workflow",
  "agent_plan",
  "quality_review",
]);
export type AiOperationMode = z.infer<typeof aiOperationModeSchema>;

export const aiTraceEventTypeSchema = z.enum([
  "prepared",
  "provider_request",
  "provider_response",
  "tool_call",
  "tool_result",
  "validation",
  "completed",
  "failed",
  "stopped",
]);
export type AiTraceEventType = z.infer<typeof aiTraceEventTypeSchema>;

export const aiTraceStatusSchema = z.enum(["prepared", "running", "completed", "failed", "stopped"]);
export type AiTraceStatus = z.infer<typeof aiTraceStatusSchema>;

export const aiWarningSchema = z.object({
  code: z.string().trim().min(1).max(80),
  severity: z.enum(["info", "warning"]),
  title: z.string().trim().min(1).max(160),
  detail: z.string().trim().min(1).max(1_000),
  suggestion: z.string().trim().max(1_000).optional(),
});
export type AiWarning = z.infer<typeof aiWarningSchema>;

export const aiContextItemSchema = z.object({
  type: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(160),
  id: z.string().max(200).optional(),
  included: z.boolean(),
  chars: z.number().int().nonnegative().optional(),
  truncated: z.boolean().optional(),
  note: z.string().max(500).optional(),
});
export type AiContextItem = z.infer<typeof aiContextItemSchema>;

export const creativePromptOverrideSchema = z.object({
  positive: z.string().max(20_000).optional(),
  negative: z.string().max(8_000).optional(),
});
export type CreativePromptOverride = z.infer<typeof creativePromptOverrideSchema>;

export const aiOperationPreviewSchema = z.object({
  mode: aiOperationModeSchema,
  title: z.string().max(160),
  dynamicNotice: z.string().max(1_000).optional(),
  provider: z.string().max(120).optional(),
  model: z.string().max(240).optional(),
  endpoint: z.string().max(300).optional(),
  context: z.array(aiContextItemSchema).max(100),
  request: z.record(z.string(), z.unknown()),
  warnings: z.array(aiWarningSchema).max(100),
  estimatedPoints: z.number().nonnegative().optional(),
  canOverrideCreativePrompt: z.boolean().default(false),
});
export type AiOperationPreview = z.infer<typeof aiOperationPreviewSchema>;

export const aiQualityReviewSchema = z.object({
  summary: z.string().trim().min(1).max(1_000),
  warnings: z.array(aiWarningSchema).max(20),
  suggestedPrompt: z.string().max(20_000).optional(),
  suggestedNegativePrompt: z.string().max(8_000).optional(),
  contextUsed: z.array(z.string().max(120)).max(30).default([]),
});
export type AiQualityReview = z.infer<typeof aiQualityReviewSchema>;
