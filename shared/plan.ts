/**
 * Issue #133 / PR A：前後端共用的完整計畫資料契約。
 *
 * 目前僅定義與驗證可持久化的計畫形狀；Agent Runner 仍使用既有 AgentStep，
 * 不會在本階段執行新增 kind，避免資料模型與副作用一次性耦合。
 */
import { z } from "zod";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "./cardLimits";
import {
  adobePhotoOperationSchema,
  adobeTimelineSchema,
} from "./adobe";

export const planStepKindSchema = z.enum([
  "split_script",
  "create_scene",
  "generate",
  "voiceover",
  "record_to_database",
  "create_note",
  "append_note",
  "create_schedule",
  "update_schedule",
  "create_task",
  "wait_for_human",
  "request_approval",
  "notify",
  "checkpoint",
  // Adobe PR5：代理可直接在使用者已連結的 Adobe 帳號內修圖／匯出時間軸
  "adobe_photo_edit",
  "adobe_export_timeline",
  "adobe_timeline_render",
]);

export const planStepStatusSchema = z.enum([
  "draft",
  "pending",
  "blocked",
  "running",
  "waiting",
  "done",
  "failed",
  "stopped",
]);

export const planReferenceSchema = z.object({
  type: z.string().trim().min(1).max(40),
  id: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(160).optional(),
});

export const planStepSchema = z.object({
  id: z.string().trim().min(1).max(100),
  kind: planStepKindSchema,
  title: z.string().trim().min(1).max(160),
  note: z.string().max(2_000).optional(),
  /** 決策軌跡：為何需要此步（給使用者看的結構化說明，非模型內部推理） */
  rationale: z.string().trim().min(1).max(300).optional(),
  status: planStepStatusSchema,
  actorType: z.enum(["ai", "human", "system"]),
  assigneeId: z.string().uuid().optional(),
  dependsOn: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
  milestoneId: z.string().trim().min(1).max(100).optional(),
  startsAt: z.string().datetime({ offset: true }).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
  estimatedMinutes: z.number().int().min(0).max(525_600).optional(),
  requiresApproval: z.boolean().optional(),
  approverRole: z.enum(["project_owner", "group_leader", "admin"]).optional(),
  estimatedPoints: z.number().int().min(0).max(1_000_000).optional(),
  actualPoints: z.number().int().min(0).max(1_000_000).optional(),
  sourceRefs: z.array(planReferenceSchema).max(100).optional(),
  outputRefs: z.array(planReferenceSchema).max(100).optional(),
  projectId: z.string().uuid().optional(),
  noteId: z.string().uuid().optional(),
  notePurpose: z.enum(["research", "meeting", "decision", "summary", "handoff"]).optional(),
  content: z.string().max(80_000).optional(),
  mentions: z.array(z.string().uuid()).max(20).optional(),
  scheduleItemId: z.string().uuid().optional(),
  scheduleTitle: z.string().trim().min(1).max(120).optional(),
  endsAt: z.string().datetime({ offset: true }).optional(),
  ownerId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  taskStepId: z.string().trim().min(1).max(100).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  generationId: z.string().uuid().optional(),
  effectId: z.string().uuid().optional(),
  detail: z.string().max(4_000).optional(),
  // 舊生成步驟仍需的 payload；PR A 只保留相容形狀，不改 Runner。
  tableId: z.string().uuid().optional(),
  rowData: z.record(z.unknown()).optional(),
  modelId: z.string().max(200).optional(),
  prompt: z.string().max(8_000).optional(),
  sceneNo: z.number().int().positive().optional(),
  targetSceneId: z.string().uuid().optional(),
  sceneTitle: z.string().max(160).optional(),
  voiceover: z.string().max(4_000).optional(),
  durationSec: z.number().positive().max(3_600).optional(),
  scenePrompt: z.string().max(8_000).optional(),
  script: z.string().max(80_000).optional(),
  // CA-01：代理 generate 與直接生成對齊——定裝／場景／素材／來源素材（上限見 cardLimits）
  characterIds: z.array(z.string().uuid()).max(MAX_GENERATE_CHARACTERS).optional(),
  scenePresetIds: z.array(z.string().uuid()).max(MAX_GENERATE_SCENE_PRESETS).optional(),
  propIds: z.array(z.string().uuid()).max(MAX_GENERATE_PROPS).optional(),
  sourceAssetId: z.string().uuid().optional(),
  sourceUrl: z.string().max(2_000).optional(),
  // Adobe PR5：修圖／時間軸步驟 payload 與執行期工作 id
  adobeAssetId: z.string().trim().min(1).max(200).optional(),
  adobeOperations: z.array(adobePhotoOperationSchema).min(1).max(8).optional(),
  adobeOutputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
  adobeOutputName: z.string().trim().min(1).max(160).optional(),
  adobeTimeline: adobeTimelineSchema.optional(),
  adobeMediaPathByAssetId: z.record(z.string().trim().min(1).max(200)).optional(),
  adobeMediaKindByAssetId: z.record(z.enum(["video", "image", "audio"])).optional(),
  adobePathPrefix: z.string().max(20).optional(),
  /** 執行期：Adobe 非同步工作 id（修圖／時間軸算圖）；輪詢結算用 */
  adobeJobId: z.string().trim().min(1).max(500).optional(),
});

export const planRiskSchema = z.object({
  title: z.string().trim().min(1).max(160),
  impact: z.string().trim().min(1).max(1_000),
  mitigation: z.string().trim().min(1).max(1_000).optional(),
});

export const planMilestoneSchema = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  dueAt: z.string().datetime({ offset: true }).optional(),
});

export const completePlanSummarySchema = z.object({
  goal: z.string().trim().min(1).max(1_000),
  /** 決策軌跡：1–3 句說明為何這樣排計畫（結構化結論，不是 chain-of-thought） */
  rationale: z.string().trim().min(1).max(500).optional(),
  /** 決策軌跡：本次規劃實際依據的上下文區塊標籤（如「專案世界觀」「筆記摘要」） */
  contextUsed: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  successCriteria: z.array(z.string().trim().min(1).max(500)).max(50),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(50),
  missingInformation: z.array(z.string().trim().min(1).max(500)).max(50),
  expectedOutputs: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  risks: z.array(planRiskSchema).max(50),
  milestones: z.array(planMilestoneSchema).max(50),
  estimatedPoints: z.number().int().min(0).max(1_000_000),
  estimatedDurationMinutes: z.number().int().min(0).max(525_600).optional(),
});

export const completePlanSchema = z.object({
  summary: completePlanSummarySchema,
  steps: z.array(planStepSchema).min(1).max(200),
}).superRefine((plan, ctx) => {
  const stepIds = new Set<string>();
  for (const [index, step] of plan.steps.entries()) {
    if (stepIds.has(step.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps", index, "id"],
        message: "計畫步驟 id 不可重複",
      });
    }
    stepIds.add(step.id);
  }
  const milestoneIds = new Set<string>();
  for (const [index, milestone] of plan.summary.milestones.entries()) {
    if (milestoneIds.has(milestone.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary", "milestones", index, "id"],
        message: "里程碑 id 不可重複",
      });
    }
    milestoneIds.add(milestone.id);
  }
  for (const [index, step] of plan.steps.entries()) {
    for (const dependency of step.dependsOn ?? []) {
      if (dependency === step.id || !stepIds.has(dependency)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["steps", index, "dependsOn"],
          message: dependency === step.id ? "步驟不可依賴自己" : `找不到依賴步驟：${dependency}`,
        });
      }
    }
    if (step.milestoneId && !milestoneIds.has(step.milestoneId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps", index, "milestoneId"],
        message: `找不到里程碑：${step.milestoneId}`,
      });
    }
    if (step.startsAt && step.dueAt && Date.parse(step.dueAt) < Date.parse(step.startsAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps", index, "dueAt"],
        message: "期限不可早於開始時間",
      });
    }
  }
  const dependencyMap = new Map(plan.steps.map((step) => [step.id, step.dependsOn ?? []]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencyMap.get(id) ?? []) {
      if (dependencyMap.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const step of plan.steps) {
    if (visit(step.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["steps"],
        message: "計畫步驟依賴不可形成循環",
      });
      break;
    }
  }
});

export type PlanStep = z.infer<typeof planStepSchema>;
export type PlanReference = z.infer<typeof planReferenceSchema>;
export type CompletePlanSummary = z.infer<typeof completePlanSummarySchema>;
export type CompletePlan = z.infer<typeof completePlanSchema>;
