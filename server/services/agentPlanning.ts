import { z } from "zod";
import { getModel } from "../../shared/models";
import {
  completePlanSchema,
  type CompletePlan,
  type CompletePlanSummary,
  type PlanReference,
} from "../../shared/plan";
import type { AgentStep } from "./agentRunner";

const MAX_DRAFT_STEPS = 30;
const DEFAULT_IMAGE_MODEL = "fal-ai/fast-lightning-sdxl";
const TTS_MODEL = "fal-ai/kokoro/mandarin-chinese";

const stepBase = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  note: z.string().trim().max(2_000).optional(),
  dependsOn: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  milestoneId: z.string().trim().min(1).max(100).optional(),
  estimatedMinutes: z.number().int().min(0).max(525_600).optional(),
  sourceRefs: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
});

const humanFields = {
  description: z.string().max(4_000).optional(),
  assigneeRef: z.string().trim().max(40).optional(),
  dueAt: z.string().trim().max(80).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
};

export const completePlanDraftSchema = z.object({
  summary: z.object({
    goal: z.string().trim().min(1).max(1_000),
    successCriteria: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    missingInformation: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
    expectedOutputs: z.array(z.string().trim().min(1).max(500)).min(1).max(30),
    risks: z.array(z.object({
      title: z.string().trim().min(1).max(160),
      impact: z.string().trim().min(1).max(1_000),
      mitigation: z.string().trim().min(1).max(1_000).optional(),
    })).max(30).default([]),
    milestones: z.array(z.object({
      id: z.string().trim().min(1).max(100),
      title: z.string().trim().min(1).max(160),
      dueAt: z.string().trim().max(80).optional(),
    })).min(1).max(30),
    estimatedDurationMinutes: z.number().int().min(0).max(525_600).optional(),
  }),
  steps: z.array(z.discriminatedUnion("kind", [
    stepBase.extend({
      kind: z.literal("split_script"),
      script: z.string().min(20).max(8_000).optional(),
    }),
    stepBase.extend({
      kind: z.literal("create_scene"),
      sceneTitle: z.string().trim().min(1).max(60),
      voiceover: z.string().max(500).optional(),
      durationSec: z.number().min(1).max(60).optional(),
      prompt: z.string().max(2_000).optional(),
    }),
    stepBase.extend({
      kind: z.literal("generate"),
      prompt: z.string().trim().min(1).max(8_000),
      sceneNo: z.number().int().positive().optional(),
      modelId: z.string().trim().max(200).optional(),
    }),
    stepBase.extend({
      kind: z.literal("voiceover"),
      sceneNo: z.number().int().positive(),
    }),
    stepBase.extend({
      kind: z.literal("submit_approval"),
      sceneNo: z.number().int().positive(),
    }),
    stepBase.extend({
      kind: z.literal("record_to_database"),
      dbRef: z.string().trim().max(40),
      data: z.record(z.unknown()),
    }),
    stepBase.extend({
      kind: z.literal("create_note"),
      content: z.string().trim().min(1).max(80_000),
      notePurpose: z.enum(["research", "meeting", "decision", "summary", "handoff"]).optional(),
      mentionRefs: z.array(z.string().trim().max(40)).max(20).optional(),
    }),
    stepBase.extend({
      kind: z.literal("append_note"),
      noteRef: z.string().trim().max(40),
      content: z.string().trim().min(1).max(80_000),
      mentionRefs: z.array(z.string().trim().max(40)).max(20).optional(),
    }),
    stepBase.extend({
      kind: z.literal("create_schedule"),
      startsAt: z.string().trim().min(1).max(80),
      endsAt: z.string().trim().max(80).optional(),
      description: z.string().max(4_000).optional(),
      ownerRef: z.string().trim().max(40).optional(),
      mentionRefs: z.array(z.string().trim().max(40)).max(20).optional(),
    }),
    stepBase.extend({
      kind: z.literal("update_schedule"),
      scheduleRef: z.string().trim().max(40),
      scheduleTitle: z.string().trim().min(1).max(120).optional(),
      startsAt: z.string().trim().max(80).optional(),
      endsAt: z.string().trim().max(80).optional(),
      description: z.string().max(4_000).optional(),
      ownerRef: z.string().trim().max(40).optional(),
      mentionRefs: z.array(z.string().trim().max(40)).max(20).optional(),
    }),
    stepBase.extend({
      kind: z.literal("create_task"),
      ...humanFields,
      mentionRefs: z.array(z.string().trim().max(40)).max(20).optional(),
    }),
    stepBase.extend({
      kind: z.literal("wait_for_human"),
      ...humanFields,
      taskStepId: z.string().trim().min(1).max(100).optional(),
      taskRef: z.string().trim().max(40).optional(),
      mentionRefs: z.array(z.string().trim().max(40)).max(20).optional(),
    }),
    stepBase.extend({
      kind: z.literal("request_approval"),
      description: z.string().max(4_000).optional(),
      dueAt: z.string().trim().max(80).optional(),
      approverRole: z.enum(["project_owner", "group_leader", "admin"]).optional(),
    }),
  ])).min(1).max(MAX_DRAFT_STEPS),
});

export type CompletePlanDraft = z.infer<typeof completePlanDraftSchema>;

export interface PlannerAlias {
  ref: string;
  id: string;
  label: string;
}

export interface PlannerDatabaseAlias extends PlannerAlias {
  fields: Array<{ key: string; label: string; type: string; required?: boolean }>;
}

export interface PlannerAliases {
  members: PlannerAlias[];
  notes: PlannerAlias[];
  schedules: PlannerAlias[];
  tasks: PlannerAlias[];
  databases: PlannerDatabaseAlias[];
}

export interface ResolvedAgentPlan {
  summary: CompletePlanSummary;
  summaryText: string;
  steps: AgentStep[];
  estPoints: number;
}

const exactDateSchema = z.string().datetime({ offset: true });

function normalizeDate(
  value: string | undefined,
  fieldLabel: string,
  missingInformation: string[],
): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (exactDateSchema.safeParse(trimmed).success) return trimmed;
  missingInformation.push(`${fieldLabel}缺少含時區的確切日期時間（收到「${trimmed.slice(0, 40)}」）`);
  return undefined;
}

function normalizeEndDate(
  startsAt: string | undefined,
  rawEndsAt: string | undefined,
  fieldLabel: string,
  missingInformation: string[],
): string | undefined {
  const endsAt = normalizeDate(rawEndsAt, fieldLabel, missingInformation);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    missingInformation.push(`${fieldLabel}必須晚於開始時間`);
    return undefined;
  }
  return endsAt;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function aliasMap(rows: PlannerAlias[]): Map<string, PlannerAlias> {
  return new Map(rows.map((row) => [row.ref, row]));
}

function memberIds(
  refs: string[] | undefined,
  members: Map<string, PlannerAlias>,
  missingInformation: string[],
): string[] | undefined {
  if (!refs?.length) return undefined;
  const ids: string[] = [];
  for (const ref of refs) {
    const member = members.get(ref);
    if (member) ids.push(member.id);
    else missingInformation.push(`找不到團隊成員代號「${ref}」`);
  }
  return unique(ids);
}

function referenceFor(
  ref: string,
  aliases: PlannerAliases,
): PlanReference | undefined {
  const groups: Array<[string, PlannerAlias[]]> = [
    ["member", aliases.members],
    ["note", aliases.notes],
    ["schedule", aliases.schedules],
    ["task", aliases.tasks],
    ["database", aliases.databases],
  ];
  for (const [type, rows] of groups) {
    const row = rows.find((item) => item.ref === ref);
    if (row) return { type, id: row.id, label: row.label };
  }
  return undefined;
}

function actorFor(kind: CompletePlanDraft["steps"][number]["kind"]): "ai" | "human" | "system" {
  if (kind === "create_task" || kind === "wait_for_human" || kind === "request_approval") return "human";
  return "ai";
}

function safeModel(modelId: string | undefined) {
  const requested = modelId ? getModel(modelId) : undefined;
  if (requested && !requested.needs) return requested;
  return getModel(DEFAULT_IMAGE_MODEL);
}

export function resolveCompletePlanDraft(
  draft: CompletePlanDraft,
  aliases: PlannerAliases,
): ResolvedAgentPlan {
  const missingInformation = [...draft.summary.missingInformation];
  const members = aliasMap(aliases.members);
  const notes = aliasMap(aliases.notes);
  const schedules = aliasMap(aliases.schedules);
  const tasks = aliasMap(aliases.tasks);
  const databases = aliasMap(aliases.databases);
  const rawIds = new Set(draft.steps.map((step) => step.id));
  const retainedIds = new Set<string>();
  const steps: AgentStep[] = [];

  for (const source of draft.steps) {
    const sourceRefs: PlanReference[] = [];
    for (const ref of source.sourceRefs ?? []) {
      const resolved = referenceFor(ref, aliases);
      if (resolved) sourceRefs.push(resolved);
      else missingInformation.push(`步驟「${source.title}」引用了未知來源代號「${ref}」`);
    }
    const base: AgentStep = {
      id: source.id,
      kind: source.kind,
      title: source.title,
      note: source.note?.trim() || source.title,
      status: "pending",
      actorType: actorFor(source.kind),
      dependsOn: source.dependsOn,
      milestoneId: source.milestoneId,
      estimatedMinutes: source.estimatedMinutes,
      sourceRefs,
      executionMode: "dag",
    };

    if (source.kind === "record_to_database") {
      const target = databases.get(source.dbRef);
      if (!target) {
        missingInformation.push(`步驟「${source.title}」找不到可寫資料庫代號「${source.dbRef}」`);
        continue;
      }
      steps.push({ ...base, tableId: target.id, rowData: source.data, points: 0 });
    } else if (source.kind === "split_script") {
      steps.push({ ...base, script: source.script, points: 0 });
    } else if (source.kind === "create_scene") {
      steps.push({
        ...base,
        title: source.sceneTitle,
        sceneTitle: source.sceneTitle,
        voiceover: source.voiceover,
        durationSec: source.durationSec,
        scenePrompt: source.prompt,
        points: 0,
      });
    } else if (source.kind === "generate") {
      const model = safeModel(source.modelId);
      if (!model) {
        missingInformation.push(`步驟「${source.title}」沒有可用的生成模型`);
        continue;
      }
      steps.push({
        ...base,
        modelId: model.id,
        prompt: source.prompt,
        sceneNo: source.sceneNo,
        points: model.points,
      });
    } else if (source.kind === "voiceover") {
      steps.push({ ...base, sceneNo: source.sceneNo, points: getModel(TTS_MODEL)?.points ?? 1 });
    } else if (source.kind === "submit_approval") {
      steps.push({ ...base, sceneNo: source.sceneNo, points: 0 });
    } else if (source.kind === "create_note") {
      steps.push({
        ...base,
        content: source.content,
        notePurpose: source.notePurpose,
        mentions: memberIds(source.mentionRefs, members, missingInformation),
        points: 0,
      });
    } else if (source.kind === "append_note") {
      const target = notes.get(source.noteRef);
      if (!target) {
        missingInformation.push(`步驟「${source.title}」找不到筆記代號「${source.noteRef}」`);
        continue;
      }
      steps.push({
        ...base,
        noteId: target.id,
        content: source.content,
        mentions: memberIds(source.mentionRefs, members, missingInformation),
        points: 0,
      });
    } else if (source.kind === "create_schedule") {
      const startsAt = normalizeDate(source.startsAt, `行程「${source.title}」開始時間`, missingInformation);
      const endsAt = normalizeEndDate(startsAt, source.endsAt, `行程「${source.title}」結束時間`, missingInformation);
      if (!startsAt) continue;
      const owner = source.ownerRef ? members.get(source.ownerRef) : undefined;
      if (source.ownerRef && !owner) missingInformation.push(`找不到行程負責人代號「${source.ownerRef}」`);
      steps.push({
        ...base,
        startsAt,
        endsAt,
        content: source.description,
        ownerId: owner?.id,
        mentions: memberIds(source.mentionRefs, members, missingInformation),
        points: 0,
      });
    } else if (source.kind === "update_schedule") {
      const target = schedules.get(source.scheduleRef);
      if (!target) {
        missingInformation.push(`步驟「${source.title}」找不到行程代號「${source.scheduleRef}」`);
        continue;
      }
      const startsAt = normalizeDate(source.startsAt, `行程「${source.title}」開始時間`, missingInformation);
      const endsAt = normalizeEndDate(startsAt, source.endsAt, `行程「${source.title}」結束時間`, missingInformation);
      const owner = source.ownerRef ? members.get(source.ownerRef) : undefined;
      if (source.ownerRef && !owner) missingInformation.push(`找不到行程負責人代號「${source.ownerRef}」`);
      steps.push({
        ...base,
        scheduleItemId: target.id,
        scheduleTitle: source.scheduleTitle,
        startsAt,
        endsAt,
        content: source.description,
        ownerId: owner?.id,
        mentions: memberIds(source.mentionRefs, members, missingInformation),
        points: 0,
      });
    } else if (source.kind === "create_task" || source.kind === "wait_for_human") {
      const assignee = source.assigneeRef ? members.get(source.assigneeRef) : undefined;
      if (source.assigneeRef && !assignee) missingInformation.push(`找不到任務負責人代號「${source.assigneeRef}」`);
      const dueAt = normalizeDate(source.dueAt, `任務「${source.title}」期限`, missingInformation);
      const taskStepId = source.kind === "wait_for_human" && source.taskStepId && rawIds.has(source.taskStepId)
        ? source.taskStepId
        : undefined;
      const existingTask = source.kind === "wait_for_human" && source.taskRef
        ? tasks.get(source.taskRef)
        : undefined;
      if (source.kind === "wait_for_human" && source.taskStepId && !taskStepId) {
        missingInformation.push(`等待節點「${source.title}」找不到任務步驟「${source.taskStepId}」`);
      }
      if (source.kind === "wait_for_human" && source.taskRef && !existingTask) {
        missingInformation.push(`等待節點「${source.title}」找不到既有任務代號「${source.taskRef}」`);
      }
      steps.push({
        ...base,
        content: source.description,
        assigneeId: assignee?.id,
        dueAt,
        priority: source.priority,
        taskStepId,
        taskId: existingTask?.id,
        mentions: memberIds(source.mentionRefs, members, missingInformation),
        points: 0,
      });
    } else if (source.kind === "request_approval") {
      steps.push({
        ...base,
        content: source.description,
        dueAt: normalizeDate(source.dueAt, `核准「${source.title}」期限`, missingInformation),
        approverRole: source.approverRole ?? "group_leader",
        points: 0,
      });
    }
    retainedIds.add(source.id);
  }

  for (const step of steps) {
    const unresolved = (step.dependsOn ?? []).filter((id) => !retainedIds.has(id));
    if (unresolved.length) {
      missingInformation.push(`步驟「${step.note}」依賴未能建立的步驟：${unresolved.join("、")}`);
    }
    step.dependsOn = (step.dependsOn ?? []).filter((id) => retainedIds.has(id) && id !== step.id);
    if (!step.dependsOn.length) step.dependsOn = undefined;
  }

  const milestoneIds = new Set(draft.summary.milestones.map((milestone) => milestone.id));
  for (const step of steps) {
    if (step.milestoneId && !milestoneIds.has(step.milestoneId)) {
      missingInformation.push(`步驟「${step.note}」引用了未知里程碑「${step.milestoneId}」`);
      step.milestoneId = undefined;
    }
  }

  const estPoints = steps.reduce((sum, step) => sum + (step.points ?? 0), 0);
  const summary: CompletePlanSummary = {
    goal: draft.summary.goal,
    successCriteria: unique(draft.summary.successCriteria),
    assumptions: unique(draft.summary.assumptions),
    missingInformation: unique(missingInformation),
    expectedOutputs: unique(draft.summary.expectedOutputs),
    risks: draft.summary.risks,
    milestones: draft.summary.milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      dueAt: normalizeDate(milestone.dueAt, `里程碑「${milestone.title}」期限`, missingInformation),
    })),
    estimatedPoints: estPoints,
    estimatedDurationMinutes: draft.summary.estimatedDurationMinutes,
  };
  summary.missingInformation = unique(missingInformation);

  if (steps.length === 0) {
    return {
      summary,
      summaryText: `${summary.goal}｜目前沒有可安全執行的步驟｜預估 ${estPoints} 點`,
      steps,
      estPoints,
    };
  }
  const complete: CompletePlan = { summary, steps: steps.map((step) => ({
    ...step,
    id: step.id!,
    title: step.title ?? step.note,
    status: "pending" as const,
    actorType: step.actorType ?? actorFor(step.kind),
    estimatedPoints: step.points,
  })) };
  const checked = completePlanSchema.safeParse(complete);
  if (!checked.success) {
    throw new Error(`完整計畫驗證失敗：${checked.error.issues.map((issue) => issue.message).join("；")}`);
  }
  return {
    summary: checked.data.summary,
    summaryText: `${checked.data.summary.goal}｜${checked.data.steps.length} 個步驟｜預估 ${estPoints} 點`,
    steps,
    estPoints,
  };
}

export function extractPlanJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? raw.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}
