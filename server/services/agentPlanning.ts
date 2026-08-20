import { z } from "zod";
import {
  completePlanSchema,
  MAX_PLAN_STEPS,
  type CompletePlan,
  type CompletePlanSummary,
  type PlanReference,
} from "../../shared/plan";
import { MAX_GENERATE_CHARACTERS, MAX_GENERATE_PROPS, MAX_GENERATE_SCENE_PRESETS } from "../../shared/cardLimits";
import type { AgentStep } from "./agentRunner";
import {
  modelIsOperationallyReady,
  selectAiGenerationModel,
} from "./aiModelPolicy";
import { resolveModel } from "./modelResolve";
import type { ModelEntry } from "../../shared/models";

const TTS_MODEL = "fal-ai/kokoro/mandarin-chinese";

const stepBase = z.object({
  id: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(160),
  note: z.string().trim().max(2_000).optional(),
  rationale: z.string().trim().min(1).max(300).optional(),
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
    rationale: z.string().trim().min(1).max(500).optional(),
    contextUsed: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
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
      kind: z.literal("update_scene"),
      sceneNo: z.number().int().positive(),
      sceneTitle: z.string().trim().min(1).max(60).optional(),
      durationSec: z.number().min(1).max(60).optional(),
      prompt: z.string().max(2_000).optional(),
      voiceover: z.string().max(500).optional(),
      ambience: z.string().max(500).optional(),
      trimStartMs: z.number().int().min(0).max(3_600_000).optional(),
      trimEndMs: z.number().int().min(1).max(3_600_000).optional(),
    }),
    stepBase.extend({
      kind: z.literal("reorder_scenes"),
      orderedSceneNos: z.array(z.number().int().positive()).min(2).max(60),
    }),
    stepBase.extend({
      kind: z.literal("generate"),
      prompt: z.string().trim().min(1).max(8_000),
      sceneNo: z.number().int().positive().optional(),
      modelId: z.string().trim().max(200).optional(),
      // CA-01：代號（char1／preset1／asset1）— resolve 時轉 UUID，禁止把未解析字串寫入 step
      characterRefs: z.array(z.string().trim().min(1).max(40)).max(MAX_GENERATE_CHARACTERS).optional(),
      scenePresetRefs: z.array(z.string().trim().min(1).max(40)).max(MAX_GENERATE_SCENE_PRESETS).optional(),
      propRefs: z.array(z.string().trim().min(1).max(40)).max(MAX_GENERATE_PROPS).optional(),
      sourceAssetRef: z.string().trim().min(1).max(40).optional(),
      sourceUrl: z.string().trim().max(2_000).optional(),
    }),
    stepBase.extend({
      kind: z.literal("voiceover"),
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
  ])).min(1).max(MAX_PLAN_STEPS),
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
  /** CA-01：角色定裝（char1…） */
  characters: PlannerAlias[];
  /** CA-01：場景設定卡（preset1…） */
  scenePresets: PlannerAlias[];
  /** 素材設定卡（prop1…）：道具外觀／材質錨點 */
  props: PlannerAlias[];
  /** CA-01：素材庫（asset1…）— 供 needs 模型來源 */
  assets: PlannerAlias[];
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
    ["character", aliases.characters],
    ["scene_preset", aliases.scenePresets],
    ["prop", aliases.props],
    ["asset", aliases.assets],
  ];
  for (const [type, rows] of groups) {
    const row = rows.find((item) => item.ref === ref);
    if (row) return { type, id: row.id, label: row.label };
  }
  return undefined;
}

/**
 * Widened past the draft union: resolved steps carry the executor's kind set
 * (which includes `tool_call`), and every kind still has to land on an actor.
 */
function actorFor(kind: AgentStep["kind"]): "ai" | "human" | "system" {
  if (kind === "create_task" || kind === "wait_for_human" || kind === "request_approval") return "human";
  return "ai";
}

/**
 * CA-01：`resolveGenerateModel`（取代舊 safeModel 靜默降級）。
 * - 未指定 modelId → 預設已驗證文生圖
 * - 無 needs → 保留 requested（須 operationally ready）
 * - 有 needs 且已有來源 → 保留 needs 模型（不經 AI_GENERATION_CATEGORIES 濾掉 i2i／i2v）
 * - 有 needs 但缺來源 → 不靜默降級（回 needs_source）
 * - 明確指定無效／未就緒 id → invalid（不塞 DEFAULT）
 */
function resolveGenerateModel(
  modelId: string | undefined,
  hasSource: boolean,
): { model: ModelEntry | null; issue?: "invalid" | "needs_source" | "none_available" } {
  const preferred = modelId?.trim();
  if (!preferred) {
    try {
      return {
        model: selectAiGenerationModel({
          category: "text-to-image",
          preference: "balanced",
          requireVerified: true,
        }).model,
      };
    } catch {
      return { model: null, issue: "none_available" };
    }
  }

  const requested = resolveModel(preferred);
  if (!requested || !modelIsOperationallyReady(requested)) {
    return { model: null, issue: "invalid" };
  }
  if (requested.needs) {
    if (!hasSource) return { model: null, issue: "needs_source" };
    return { model: requested };
  }
  return { model: requested };
}

/** 解析 char／preset 等多代號；未知 → missingInformation，不得寫入未解析字串 */
function resolveAliasIdList(
  refs: string[] | undefined,
  map: Map<string, PlannerAlias>,
  missingInformation: string[],
  stepTitle: string,
  kindLabel: string,
  sourceRefs: PlanReference[],
  refType: string,
): string[] | undefined {
  if (!refs?.length) return undefined;
  const ids: string[] = [];
  for (const ref of refs) {
    const row = map.get(ref);
    if (row) {
      ids.push(row.id);
      sourceRefs.push({ type: refType, id: row.id, label: row.label });
    } else {
      missingInformation.push(`步驟「${stepTitle}」找不到${kindLabel}代號「${ref}」`);
    }
  }
  const uniqueIds = unique(ids);
  return uniqueIds.length ? uniqueIds : undefined;
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
  const characters = aliasMap(aliases.characters);
  const scenePresets = aliasMap(aliases.scenePresets);
  const props = aliasMap(aliases.props);
  const assets = aliasMap(aliases.assets);
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
      rationale: source.rationale,
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
    } else if (source.kind === "update_scene") {
      steps.push({
        ...base,
        sceneNo: source.sceneNo,
        sceneTitle: source.sceneTitle,
        durationSec: source.durationSec,
        scenePrompt: source.prompt,
        voiceover: source.voiceover,
        ambience: source.ambience,
        trimStartMs: source.trimStartMs,
        trimEndMs: source.trimEndMs,
        points: 0,
      });
    } else if (source.kind === "reorder_scenes") {
      steps.push({ ...base, orderedSceneNos: source.orderedSceneNos, points: 0 });
    } else if (source.kind === "generate") {
      const characterIds = resolveAliasIdList(
        source.characterRefs,
        characters,
        missingInformation,
        source.title,
        "角色定裝",
        sourceRefs,
        "character",
      );
      const scenePresetIds = resolveAliasIdList(
        source.scenePresetRefs,
        scenePresets,
        missingInformation,
        source.title,
        "場景設定",
        sourceRefs,
        "scene_preset",
      );
      const propIds = resolveAliasIdList(
        source.propRefs,
        props,
        missingInformation,
        source.title,
        "素材設定",
        sourceRefs,
        "prop",
      );
      let sourceAssetId: string | undefined;
      if (source.sourceAssetRef) {
        const asset = assets.get(source.sourceAssetRef);
        if (asset) {
          sourceAssetId = asset.id;
          sourceRefs.push({ type: "asset", id: asset.id, label: asset.label });
        } else {
          missingInformation.push(`步驟「${source.title}」找不到素材代號「${source.sourceAssetRef}」`);
        }
      }
      const rawSourceUrl = source.sourceUrl?.trim();
      let sourceUrl: string | undefined;
      if (rawSourceUrl && !sourceAssetId) {
        // 規劃端拒非 https（執行期 generationCore 另有 SSRF／needs 守門）
        if (!/^https:\/\//i.test(rawSourceUrl)) {
          missingInformation.push(`步驟「${source.title}」的 sourceUrl 必須是 https:// 網址`);
        } else {
          sourceUrl = rawSourceUrl;
        }
      }
      const hasSource = !!(sourceAssetId || sourceUrl);
      const { model, issue } = resolveGenerateModel(source.modelId, hasSource);
      if (!model) {
        if (issue === "needs_source") {
          missingInformation.push(
            `步驟「${source.title}」模型需要來源素材，請指定 sourceAssetRef 或改用無 needs 模型`,
          );
        } else if (issue === "invalid") {
          missingInformation.push(`步驟「${source.title}」指定的模型無效或尚未通過正式生成驗證`);
        } else {
          missingInformation.push(`步驟「${source.title}」沒有可用的生成模型`);
        }
        continue;
      }
      steps.push({
        ...base,
        modelId: model.id,
        prompt: source.prompt,
        sceneNo: source.sceneNo,
        characterIds,
        scenePresetIds,
        propIds,
        sourceAssetId,
        sourceUrl,
        points: model.points,
      });
    } else if (source.kind === "voiceover") {
      const voiceModel = selectAiGenerationModel({
        category: "text-to-speech",
        preferredId: TTS_MODEL,
        preference: "balanced",
        requireVerified: true,
      }).model;
      steps.push({
        ...base,
        sceneNo: source.sceneNo,
        modelId: voiceModel.id,
        points: voiceModel.points,
      });
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
  const contextUsed = unique(draft.summary.contextUsed ?? []);
  const summary: CompletePlanSummary = {
    goal: draft.summary.goal,
    rationale: draft.summary.rationale,
    contextUsed: contextUsed.length ? contextUsed : undefined,
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

export function summarizePlanDraftIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 12).map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "root";
    return `${path}: ${issue.message}`;
  });
}
