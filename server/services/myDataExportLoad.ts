/**
 * 個資匯出資料載入（更深版）：組 payload 給 renderMyDataHtml / JSON。
 * 範圍：帳號偏好、組、相關專案（深摘要）、生成錨點、帳本用量、專案／組代理、
 * 任務、提示詞、審批、私訊、版本歷史、個人資料庫、整合狀態（無密鑰）…等「你本人」資料。
 */
import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import {
  summarizeWorldview,
  type MyDataExportPayload,
  type MyDataProjectExport,
} from "./myDataExport";

const LIMIT = {
  projects: 200,
  scenesPerProject: 120,
  knowledgePerProject: 60,
  charactersPerProject: 40,
  presetsPerProject: 40,
  assetsPerProject: 80,
  generations: 1000,
  messages: 1000,
  notes: 300,
  schedule: 300,
  feedback: 200,
  costLedger: 500,
  agentRuns: 100,
  groupAgentRuns: 50,
  prompts: 200,
  approvals: 300,
  dm: 500,
  exportJobs: 100,
  workflowRuns: 100,
  textVersions: 150,
  projectTasks: 200,
  personalDb: 40,
  sampleRowsPerDb: 5,
  knowledgeContent: 12_000,
  textVersionContent: 4_000,
} as const;

type AssetRow = NonNullable<MyDataProjectExport["assets"]>[number];
type MemberRow = NonNullable<MyDataProjectExport["members"]>[number];
type SceneRow = MyDataProjectExport["scenes"][number];
type KnowledgeRow = MyDataProjectExport["knowledge"][number];
type CharacterRow = MyDataProjectExport["characters"][number];
type PresetRow = MyDataProjectExport["scenePresets"][number];

function pushCap<T>(map: Map<string, T[]>, projectId: string, item: T, cap: number) {
  const list = map.get(projectId) ?? [];
  if (list.length < cap) {
    list.push(item);
    map.set(projectId, list);
  }
}

function idListLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function paramKeysOf(params: unknown): string[] {
  if (!params || typeof params !== "object" || Array.isArray(params)) return [];
  return Object.keys(params as Record<string, unknown>).slice(0, 24);
}

function tagsOf(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is string => typeof t === "string").slice(0, 20);
}

function simplifySteps(steps: unknown): Array<{ note?: string; status?: string; kind?: string }> {
  if (!Array.isArray(steps)) return [];
  return steps.slice(0, 40).map((s) => {
    const o = s && typeof s === "object" ? (s as Record<string, unknown>) : {};
    return {
      note: typeof o.note === "string" ? o.note.slice(0, 200) : undefined,
      status: typeof o.status === "string" ? o.status : undefined,
      kind: typeof o.kind === "string" ? o.kind : undefined,
    };
  });
}

/** 從 planSummary jsonb 抽可讀重點（不展開整包嵌套） */
function planHighlights(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const o = raw as Record<string, unknown>;
  const out: string[] = [];
  const push = (label: string, v: unknown) => {
    if (typeof v === "string" && v.trim()) out.push(`${label}：${v.slice(0, 200)}`);
    else if (Array.isArray(v)) {
      const bits = v
        .filter((x): x is string => typeof x === "string")
        .slice(0, 4)
        .map((x) => x.slice(0, 80));
      if (bits.length) out.push(`${label}：${bits.join("；")}`);
    }
  };
  push("成功條件", o.successCriteria ?? o.success_conditions);
  push("假設", o.assumptions);
  push("風險", o.risks);
  push("缺少資訊", o.missingInfo ?? o.missing_info);
  push("里程碑", o.milestones);
  return out.slice(0, 8);
}

function fieldLabelsOf(fields: unknown): string[] {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((f) => {
      if (!f || typeof f !== "object") return null;
      const o = f as Record<string, unknown>;
      if (typeof o.label === "string") return o.label;
      if (typeof o.name === "string") return o.name;
      if (typeof o.key === "string") return o.key;
      return null;
    })
    .filter((x): x is string => !!x)
    .slice(0, 40);
}

export async function loadMyDataExportPayload(auth: AuthState): Promise<MyDataExportPayload> {
  const uid = auth.user.id;
  const groupNameById = new Map(auth.groups.map((g) => [g.groupId, g.groupName]));

  const [me] = await db.select().from(schema.users).where(eq(schema.users.id, uid));

  const ownedProjects = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.ownerId, uid))
    .orderBy(desc(schema.projects.updatedAt))
    .limit(LIMIT.projects);

  const membershipRows = await db
    .select({
      projectId: schema.projectMembers.projectId,
      role: schema.projectMembers.role,
    })
    .from(schema.projectMembers)
    .where(eq(schema.projectMembers.userId, uid));
  const memberProjectIds = membershipRows.map((r) => r.projectId);
  const memberRoleByProject = new Map(membershipRows.map((r) => [r.projectId, r.role as "editor" | "viewer"]));

  const contributedIds = await db
    .selectDistinct({ projectId: schema.generations.projectId })
    .from(schema.generations)
    .where(eq(schema.generations.userId, uid))
    .limit(300);

  const projectIdSet = new Set<string>([
    ...ownedProjects.map((p) => p.id),
    ...memberProjectIds,
    ...contributedIds.map((r) => r.projectId),
  ]);

  const needFetch = [...projectIdSet].filter((id) => !ownedProjects.some((p) => p.id === id));
  const extraProjects =
    needFetch.length > 0
      ? await db.select().from(schema.projects).where(inArray(schema.projects.id, needFetch.slice(0, LIMIT.projects)))
      : [];
  const projectById = new Map([...ownedProjects, ...extraProjects].map((p) => [p.id, p]));
  const projectIds = [...projectById.keys()].slice(0, LIMIT.projects);
  const titleByProjectId = new Map([...projectById.values()].map((p) => [p.id, p.title] as const));
  const ownedSet = new Set(ownedProjects.map((p) => p.id));
  const memberSet = new Set(memberProjectIds);

  const withProjectTitle = <T extends { projectId?: string | null }>(rows: T[]) =>
    rows.map((r) => ({
      ...r,
      projectTitle: r.projectId ? titleByProjectId.get(r.projectId) ?? null : null,
    }));

  const toCountMap = (rows: Array<{ projectId: string; n: number }>) =>
    new Map(rows.map((r) => [r.projectId, r.n]));
  const empty = () => new Map<string, number>();

  const [sceneCounts, knowledgeCounts, characterCounts, presetCounts, assetCounts, myGenCounts, deletedSceneCounts, deletedKnowledgeCounts] =
    projectIds.length === 0
      ? [empty(), empty(), empty(), empty(), empty(), empty(), empty(), empty()]
      : await Promise.all([
          db
            .select({ projectId: schema.scenes.projectId, n: sql<number>`count(*)::int` })
            .from(schema.scenes)
            .where(and(inArray(schema.scenes.projectId, projectIds), isNull(schema.scenes.deletedAt)))
            .groupBy(schema.scenes.projectId)
            .then(toCountMap),
          db
            .select({ projectId: schema.knowledge.projectId, n: sql<number>`count(*)::int` })
            .from(schema.knowledge)
            .where(and(inArray(schema.knowledge.projectId, projectIds), isNull(schema.knowledge.deletedAt)))
            .groupBy(schema.knowledge.projectId)
            .then(toCountMap),
          db
            .select({ projectId: schema.characters.projectId, n: sql<number>`count(*)::int` })
            .from(schema.characters)
            .where(inArray(schema.characters.projectId, projectIds))
            .groupBy(schema.characters.projectId)
            .then(toCountMap),
          db
            .select({ projectId: schema.scenePresets.projectId, n: sql<number>`count(*)::int` })
            .from(schema.scenePresets)
            .where(inArray(schema.scenePresets.projectId, projectIds))
            .groupBy(schema.scenePresets.projectId)
            .then(toCountMap),
          db
            .select({ projectId: schema.assets.projectId, n: sql<number>`count(*)::int` })
            .from(schema.assets)
            .where(and(inArray(schema.assets.projectId, projectIds), isNull(schema.assets.deletedAt)))
            .groupBy(schema.assets.projectId)
            .then(toCountMap),
          db
            .select({ projectId: schema.generations.projectId, n: sql<number>`count(*)::int` })
            .from(schema.generations)
            .where(and(eq(schema.generations.userId, uid), inArray(schema.generations.projectId, projectIds)))
            .groupBy(schema.generations.projectId)
            .then(toCountMap),
          db
            .select({ projectId: schema.scenes.projectId, n: sql<number>`count(*)::int` })
            .from(schema.scenes)
            .where(and(inArray(schema.scenes.projectId, projectIds), isNotNull(schema.scenes.deletedAt)))
            .groupBy(schema.scenes.projectId)
            .then(toCountMap),
          db
            .select({ projectId: schema.knowledge.projectId, n: sql<number>`count(*)::int` })
            .from(schema.knowledge)
            .where(and(inArray(schema.knowledge.projectId, projectIds), isNotNull(schema.knowledge.deletedAt)))
            .groupBy(schema.knowledge.projectId)
            .then(toCountMap),
        ]);

  const scenesByProject = new Map<string, SceneRow[]>();
  const knowledgeByProject = new Map<string, KnowledgeRow[]>();
  const charactersByProject = new Map<string, CharacterRow[]>();
  const presetsByProject = new Map<string, PresetRow[]>();
  const assetsByProject = new Map<string, AssetRow[]>();
  const myAssetsByProject = new Map<string, AssetRow[]>();
  const membersByProject = new Map<string, MemberRow[]>();

  if (projectIds.length > 0) {
    const [sceneRows, knowledgeRows, characterRows, presetRows, assetRows, memberDetailRows] = await Promise.all([
      db
        .select({
          projectId: schema.scenes.projectId,
          orderIndex: schema.scenes.orderIndex,
          title: schema.scenes.title,
          status: schema.scenes.status,
          durationSec: schema.scenes.durationSec,
          prompt: schema.scenes.prompt,
          voiceover: schema.scenes.voiceover,
          deletedAt: schema.scenes.deletedAt,
          assetId: schema.scenes.assetId,
          narrationAssetId: schema.scenes.narrationAssetId,
        })
        .from(schema.scenes)
        .where(inArray(schema.scenes.projectId, projectIds))
        .orderBy(asc(schema.scenes.orderIndex))
        .limit(3000),
      db
        .select({
          projectId: schema.knowledge.projectId,
          title: schema.knowledge.title,
          kind: schema.knowledge.kind,
          pinned: schema.knowledge.pinned,
          content: schema.knowledge.content,
          summary: schema.knowledge.summary,
          deletedAt: schema.knowledge.deletedAt,
          createdAt: schema.knowledge.createdAt,
          createdBy: schema.knowledge.createdBy,
        })
        .from(schema.knowledge)
        .where(inArray(schema.knowledge.projectId, projectIds))
        .orderBy(desc(schema.knowledge.pinned), desc(schema.knowledge.createdAt))
        .limit(1500),
      db
        .select({
          projectId: schema.characters.projectId,
          name: schema.characters.name,
          appearance: schema.characters.appearance,
          notes: schema.characters.notes,
          referenceAssetId: schema.characters.referenceAssetId,
        })
        .from(schema.characters)
        .where(inArray(schema.characters.projectId, projectIds))
        .limit(800),
      db
        .select({
          projectId: schema.scenePresets.projectId,
          name: schema.scenePresets.name,
          palette: schema.scenePresets.palette,
          lighting: schema.scenePresets.lighting,
          referenceAssetId: schema.scenePresets.referenceAssetId,
        })
        .from(schema.scenePresets)
        .where(inArray(schema.scenePresets.projectId, projectIds))
        .limit(800),
      db
        .select({
          projectId: schema.assets.projectId,
          title: schema.assets.title,
          kind: schema.assets.kind,
          mime: schema.assets.mime,
          sizeBytes: schema.assets.sizeBytes,
          locked: schema.assets.locked,
          isAiGenerated: schema.assets.isAiGenerated,
          landState: schema.assets.landState,
          uploadedBy: schema.assets.uploadedBy,
          deletedAt: schema.assets.deletedAt,
          createdAt: schema.assets.createdAt,
          tags: schema.assets.tags,
        })
        .from(schema.assets)
        .where(inArray(schema.assets.projectId, projectIds))
        .orderBy(desc(schema.assets.createdAt))
        .limit(2500),
      db
        .select({
          projectId: schema.projectMembers.projectId,
          userId: schema.projectMembers.userId,
          role: schema.projectMembers.role,
          name: schema.users.name,
        })
        .from(schema.projectMembers)
        .innerJoin(schema.users, eq(schema.users.id, schema.projectMembers.userId))
        .where(inArray(schema.projectMembers.projectId, projectIds))
        .limit(1000),
    ]);

    for (const s of sceneRows) {
      pushCap(
        scenesByProject,
        s.projectId,
        {
          orderIndex: s.orderIndex,
          title: s.title,
          status: s.status,
          durationSec: s.durationSec,
          prompt: s.prompt,
          voiceover: s.voiceover,
          inTrash: s.deletedAt != null,
          hasVisualAsset: s.assetId != null,
          hasNarration: s.narrationAssetId != null,
        },
        LIMIT.scenesPerProject,
      );
    }
    for (const k of knowledgeRows) {
      const content = (k.content ?? "").slice(0, LIMIT.knowledgeContent);
      pushCap(
        knowledgeByProject,
        k.projectId,
        {
          title: k.title,
          kind: k.kind,
          pinned: k.pinned,
          summary: k.summary,
          content,
          contentTruncated: (k.content?.length ?? 0) > LIMIT.knowledgeContent,
          inTrash: k.deletedAt != null,
          createdAt: k.createdAt,
          createdByMe: k.createdBy === uid,
        },
        LIMIT.knowledgePerProject,
      );
    }
    for (const c of characterRows) {
      pushCap(
        charactersByProject,
        c.projectId,
        {
          name: c.name,
          appearance: c.appearance,
          notes: c.notes,
          hasReferenceImage: c.referenceAssetId != null,
        },
        LIMIT.charactersPerProject,
      );
    }
    for (const c of presetRows) {
      pushCap(
        presetsByProject,
        c.projectId,
        {
          name: c.name,
          palette: c.palette,
          lighting: c.lighting,
          hasReferenceImage: c.referenceAssetId != null,
        },
        LIMIT.presetsPerProject,
      );
    }
    for (const a of assetRows) {
      const row: AssetRow = {
        title: a.title,
        kind: a.kind,
        mime: a.mime,
        sizeBytes: a.sizeBytes,
        locked: a.locked,
        isAiGenerated: a.isAiGenerated,
        landState: a.landState,
        uploadedByMe: a.uploadedBy === uid,
        inTrash: a.deletedAt != null,
        tags: tagsOf(a.tags),
        createdAt: a.createdAt,
      };
      const canSeeAll = ownedSet.has(a.projectId) || memberSet.has(a.projectId);
      if (canSeeAll) {
        pushCap(assetsByProject, a.projectId, row, LIMIT.assetsPerProject);
      }
      if (a.uploadedBy === uid) {
        pushCap(myAssetsByProject, a.projectId, row, LIMIT.assetsPerProject);
      }
    }
    for (const m of memberDetailRows) {
      pushCap(
        membersByProject,
        m.projectId,
        { userId: m.userId, name: m.name, role: m.role },
        50,
      );
    }
  }

  const projects: MyDataProjectExport[] = [...projectById.values()]
    .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .map((p) => {
      let relation: MyDataProjectExport["relation"] = "contributor";
      if (ownedSet.has(p.id)) relation = "owner";
      else if (memberSet.has(p.id)) relation = "member";
      const myProjectRole: MyDataProjectExport["myProjectRole"] = ownedSet.has(p.id)
        ? "owner"
        : memberRoleByProject.get(p.id) ?? null;
      return {
        id: p.id,
        title: p.title,
        kind: p.kind,
        platform: p.platform,
        format: p.format,
        status: p.status,
        groupId: p.groupId,
        groupName: groupNameById.get(p.groupId) ?? p.groupId,
        relation,
        myProjectRole,
        worldview: summarizeWorldview(p.worldview),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        counts: {
          scenes: sceneCounts.get(p.id) ?? 0,
          knowledge: knowledgeCounts.get(p.id) ?? 0,
          characters: characterCounts.get(p.id) ?? 0,
          scenePresets: presetCounts.get(p.id) ?? 0,
          assets: assetCounts.get(p.id) ?? 0,
          myGenerations: myGenCounts.get(p.id) ?? 0,
          scenesInTrash: deletedSceneCounts.get(p.id) ?? 0,
          knowledgeInTrash: deletedKnowledgeCounts.get(p.id) ?? 0,
        },
        scenes: scenesByProject.get(p.id) ?? [],
        knowledge: knowledgeByProject.get(p.id) ?? [],
        characters: charactersByProject.get(p.id) ?? [],
        scenePresets: presetsByProject.get(p.id) ?? [],
        assets: assetsByProject.get(p.id) ?? [],
        myAssets: myAssetsByProject.get(p.id) ?? [],
        members: membersByProject.get(p.id) ?? [],
      };
    });

  const [
    generations,
    myMessages,
    myFeedback,
    myNotes,
    mySchedule,
    costRows,
    agentRows,
    groupAgentRows,
    promptRows,
    approvalRows,
    dmRows,
    exportJobRows,
    workflowRows,
    textVersionRows,
    taskRows,
    personalDbRows,
    integrationRows,
    gcalRows,
    externalAccountRows,
  ] = await Promise.all([
    db
      .select({
        id: schema.generations.id,
        projectId: schema.generations.projectId,
        modelId: schema.generations.modelId,
        kind: schema.generations.kind,
        prompt: schema.generations.prompt,
        status: schema.generations.status,
        pointsEst: schema.generations.pointsEst,
        pointsActual: schema.generations.pointsActual,
        pointsRefunded: schema.generations.pointsRefunded,
        name: schema.generations.name,
        favorite: schema.generations.favorite,
        error: schema.generations.error,
        resultText: schema.generations.resultText,
        sceneRole: schema.generations.sceneRole,
        characterIds: schema.generations.characterIds,
        scenePresetIds: schema.generations.scenePresetIds,
        workflowRunId: schema.generations.workflowRunId,
        agentRunId: schema.generations.agentRunId,
        params: schema.generations.params,
        createdAt: schema.generations.createdAt,
      })
      .from(schema.generations)
      .where(eq(schema.generations.userId, uid))
      .orderBy(desc(schema.generations.createdAt))
      .limit(LIMIT.generations),
    db
      .select({
        id: schema.messages.id,
        projectId: schema.messages.projectId,
        body: schema.messages.body,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.userId, uid))
      .orderBy(desc(schema.messages.createdAt))
      .limit(LIMIT.messages),
    db
      .select()
      .from(schema.feedback)
      .where(eq(schema.feedback.userId, uid))
      .orderBy(desc(schema.feedback.createdAt))
      .limit(LIMIT.feedback),
    db
      .select({
        id: schema.notes.id,
        title: schema.notes.title,
        content: schema.notes.content,
        projectId: schema.notes.projectId,
        updatedAt: schema.notes.updatedAt,
        mentions: schema.notes.mentions,
        sourceMessageId: schema.notes.sourceMessageId,
      })
      .from(schema.notes)
      .where(eq(schema.notes.createdBy, uid))
      .orderBy(desc(schema.notes.updatedAt))
      .limit(LIMIT.notes),
    db
      .select({
        id: schema.scheduleItems.id,
        title: schema.scheduleItems.title,
        startsAt: schema.scheduleItems.startsAt,
        endsAt: schema.scheduleItems.endsAt,
        note: schema.scheduleItems.note,
        projectId: schema.scheduleItems.projectId,
        createdAt: schema.scheduleItems.createdAt,
        mentions: schema.scheduleItems.mentions,
        sourceMessageId: schema.scheduleItems.sourceMessageId,
      })
      .from(schema.scheduleItems)
      .where(eq(schema.scheduleItems.createdBy, uid))
      .orderBy(desc(schema.scheduleItems.createdAt))
      .limit(LIMIT.schedule),
    db
      .select({
        id: schema.costLedger.id,
        groupId: schema.costLedger.groupId,
        delta: schema.costLedger.delta,
        reason: schema.costLedger.reason,
        generationId: schema.costLedger.generationId,
        createdAt: schema.costLedger.createdAt,
      })
      .from(schema.costLedger)
      .where(eq(schema.costLedger.userId, uid))
      .orderBy(desc(schema.costLedger.createdAt))
      .limit(LIMIT.costLedger),
    db
      .select({
        id: schema.agentRuns.id,
        projectId: schema.agentRuns.projectId,
        goal: schema.agentRuns.goal,
        summary: schema.agentRuns.summary,
        status: schema.agentRuns.status,
        estPoints: schema.agentRuns.estPoints,
        error: schema.agentRuns.error,
        steps: schema.agentRuns.steps,
        planSummary: schema.agentRuns.planSummary,
        createdAt: schema.agentRuns.createdAt,
        updatedAt: schema.agentRuns.updatedAt,
      })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.userId, uid))
      .orderBy(desc(schema.agentRuns.createdAt))
      .limit(LIMIT.agentRuns),
    db
      .select({
        id: schema.groupAgentRuns.id,
        groupId: schema.groupAgentRuns.groupId,
        goal: schema.groupAgentRuns.goal,
        summary: schema.groupAgentRuns.summary,
        status: schema.groupAgentRuns.status,
        budgetPoints: schema.groupAgentRuns.budgetPoints,
        spentPoints: schema.groupAgentRuns.spentPoints,
        steps: schema.groupAgentRuns.steps,
        error: schema.groupAgentRuns.error,
        createdAt: schema.groupAgentRuns.createdAt,
        updatedAt: schema.groupAgentRuns.updatedAt,
      })
      .from(schema.groupAgentRuns)
      .where(eq(schema.groupAgentRuns.userId, uid))
      .orderBy(desc(schema.groupAgentRuns.createdAt))
      .limit(LIMIT.groupAgentRuns),
    db
      .select({
        id: schema.prompts.id,
        projectId: schema.prompts.projectId,
        text: schema.prompts.text,
        modelId: schema.prompts.modelId,
        useCount: schema.prompts.useCount,
        characterIds: schema.prompts.characterIds,
        scenePresetIds: schema.prompts.scenePresetIds,
        createdAt: schema.prompts.createdAt,
        updatedAt: schema.prompts.updatedAt,
      })
      .from(schema.prompts)
      .where(eq(schema.prompts.createdBy, uid))
      .orderBy(desc(schema.prompts.updatedAt))
      .limit(LIMIT.prompts),
    db
      .select({
        id: schema.approvals.id,
        projectId: schema.approvals.projectId,
        sceneId: schema.approvals.sceneId,
        version: schema.approvals.version,
        status: schema.approvals.status,
        reason: schema.approvals.reason,
        submittedBy: schema.approvals.submittedBy,
        decidedBy: schema.approvals.decidedBy,
        createdAt: schema.approvals.createdAt,
        decidedAt: schema.approvals.decidedAt,
      })
      .from(schema.approvals)
      .where(or(eq(schema.approvals.submittedBy, uid), eq(schema.approvals.decidedBy, uid)))
      .orderBy(desc(schema.approvals.createdAt))
      .limit(LIMIT.approvals),
    db
      .select({
        id: schema.dmMessages.id,
        senderId: schema.dmMessages.senderId,
        recipientId: schema.dmMessages.recipientId,
        body: schema.dmMessages.body,
        kind: schema.dmMessages.kind,
        createdAt: schema.dmMessages.createdAt,
      })
      .from(schema.dmMessages)
      .where(or(eq(schema.dmMessages.senderId, uid), eq(schema.dmMessages.recipientId, uid)))
      .orderBy(desc(schema.dmMessages.createdAt))
      .limit(LIMIT.dm),
    db
      .select({
        id: schema.exportJobs.id,
        projectId: schema.exportJobs.projectId,
        status: schema.exportJobs.status,
        zipName: schema.exportJobs.zipName,
        error: schema.exportJobs.error,
        doneEntries: schema.exportJobs.doneEntries,
        totalEntries: schema.exportJobs.totalEntries,
        bytesWritten: schema.exportJobs.bytesWritten,
        createdAt: schema.exportJobs.createdAt,
      })
      .from(schema.exportJobs)
      .where(eq(schema.exportJobs.userId, uid))
      .orderBy(desc(schema.exportJobs.createdAt))
      .limit(LIMIT.exportJobs),
    db
      .select({
        id: schema.workflowRuns.id,
        projectId: schema.workflowRuns.projectId,
        presetId: schema.workflowRuns.presetId,
        prompt: schema.workflowRuns.prompt,
        status: schema.workflowRuns.status,
        currentStep: schema.workflowRuns.currentStep,
        error: schema.workflowRuns.error,
        steps: schema.workflowRuns.steps,
        characterIds: schema.workflowRuns.characterIds,
        scenePresetIds: schema.workflowRuns.scenePresetIds,
        createdAt: schema.workflowRuns.createdAt,
      })
      .from(schema.workflowRuns)
      .where(eq(schema.workflowRuns.userId, uid))
      .orderBy(desc(schema.workflowRuns.createdAt))
      .limit(LIMIT.workflowRuns),
    db
      .select({
        id: schema.textVersions.id,
        projectId: schema.textVersions.projectId,
        kind: schema.textVersions.kind,
        title: schema.textVersions.title,
        content: schema.textVersions.content,
        createdAt: schema.textVersions.createdAt,
      })
      .from(schema.textVersions)
      .where(eq(schema.textVersions.createdBy, uid))
      .orderBy(desc(schema.textVersions.createdAt))
      .limit(LIMIT.textVersions),
    db
      .select({
        id: schema.projectTasks.id,
        projectId: schema.projectTasks.projectId,
        title: schema.projectTasks.title,
        description: schema.projectTasks.description,
        status: schema.projectTasks.status,
        priority: schema.projectTasks.priority,
        taskType: schema.projectTasks.taskType,
        assigneeId: schema.projectTasks.assigneeId,
        createdBy: schema.projectTasks.createdBy,
        dueAt: schema.projectTasks.dueAt,
        createdAt: schema.projectTasks.createdAt,
      })
      .from(schema.projectTasks)
      .where(or(eq(schema.projectTasks.assigneeId, uid), eq(schema.projectTasks.createdBy, uid)))
      .orderBy(desc(schema.projectTasks.createdAt))
      .limit(LIMIT.projectTasks),
    db
      .select({
        id: schema.dataTables.id,
        name: schema.dataTables.name,
        description: schema.dataTables.description,
        fields: schema.dataTables.fields,
        agentAccess: schema.dataTables.agentAccess,
        createdAt: schema.dataTables.createdAt,
        updatedAt: schema.dataTables.updatedAt,
      })
      .from(schema.dataTables)
      .where(
        and(
          eq(schema.dataTables.scope, "personal"),
          eq(schema.dataTables.ownerId, uid),
          isNull(schema.dataTables.deletedAt),
        ),
      )
      .orderBy(desc(schema.dataTables.updatedAt))
      .limit(LIMIT.personalDb),
    db
      .select({
        kind: schema.userIntegrations.kind,
        name: schema.userIntegrations.name,
        status: schema.userIntegrations.status,
        baseUrl: schema.userIntegrations.baseUrl,
        lastUsedAt: schema.userIntegrations.lastUsedAt,
        createdAt: schema.userIntegrations.createdAt,
      })
      .from(schema.userIntegrations)
      .where(eq(schema.userIntegrations.userId, uid))
      .orderBy(desc(schema.userIntegrations.createdAt))
      .limit(50),
    db
      .select({
        googleEmail: schema.googleCalendarConnections.googleEmail,
        status: schema.googleCalendarConnections.status,
        lastSyncAt: schema.googleCalendarConnections.lastSyncAt,
      })
      .from(schema.googleCalendarConnections)
      .where(eq(schema.googleCalendarConnections.userId, uid))
      .limit(1),
    db
      .select({
        provider: schema.externalAccounts.provider,
        accountEmail: schema.externalAccounts.accountEmail,
        status: schema.externalAccounts.status,
        mode: schema.externalAccounts.mode,
        lastUsedAt: schema.externalAccounts.lastUsedAt,
        createdAt: schema.externalAccounts.createdAt,
      })
      .from(schema.externalAccounts)
      .where(eq(schema.externalAccounts.userId, uid))
      .limit(20),
  ]);

  // 個人資料庫列／檔案計數與樣例
  const personalDbIds = personalDbRows.map((d) => d.id);
  const rowCountByTable = new Map<string, number>();
  const fileCountByTable = new Map<string, number>();
  const sampleByTable = new Map<string, Array<Record<string, unknown>>>();
  if (personalDbIds.length > 0) {
    const [rowCounts, fileCounts, sampleRows] = await Promise.all([
      db
        .select({ tableId: schema.dataRows.tableId, n: sql<number>`count(*)::int` })
        .from(schema.dataRows)
        .where(inArray(schema.dataRows.tableId, personalDbIds))
        .groupBy(schema.dataRows.tableId),
      db
        .select({ tableId: schema.dataFiles.tableId, n: sql<number>`count(*)::int` })
        .from(schema.dataFiles)
        .where(inArray(schema.dataFiles.tableId, personalDbIds))
        .groupBy(schema.dataFiles.tableId),
      db
        .select({
          tableId: schema.dataRows.tableId,
          data: schema.dataRows.data,
          createdAt: schema.dataRows.createdAt,
        })
        .from(schema.dataRows)
        .where(inArray(schema.dataRows.tableId, personalDbIds))
        .orderBy(desc(schema.dataRows.createdAt))
        .limit(personalDbIds.length * LIMIT.sampleRowsPerDb),
    ]);
    for (const r of rowCounts) rowCountByTable.set(r.tableId, r.n);
    for (const r of fileCounts) fileCountByTable.set(r.tableId, r.n);
    for (const r of sampleRows) {
      const list = sampleByTable.get(r.tableId) ?? [];
      if (list.length < LIMIT.sampleRowsPerDb) {
        const data =
          r.data && typeof r.data === "object" && !Array.isArray(r.data)
            ? (r.data as Record<string, unknown>)
            : {};
        // 截斷過長字串值
        const clipped: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(data).slice(0, 20)) {
          if (typeof v === "string") clipped[k] = v.slice(0, 200);
          else clipped[k] = v;
        }
        list.push(clipped);
        sampleByTable.set(r.tableId, list);
      }
    }
  }

  // 私訊對方顯示名
  const peerIds = new Set<string>();
  for (const d of dmRows) {
    peerIds.add(d.senderId === uid ? d.recipientId : d.senderId);
  }
  const peerNames = new Map<string, string>();
  if (peerIds.size > 0) {
    const peers = await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, [...peerIds]));
    for (const p of peers) peerNames.set(p.id, p.name);
  }

  // 用量摘要
  let pointsCharged = 0;
  let pointsRefunded = 0;
  for (const c of costRows) {
    if (c.delta < 0) pointsCharged += -c.delta;
    else if (c.delta > 0) pointsRefunded += c.delta;
  }
  const generationsByStatus: Record<string, number> = {};
  const generationsByKind: Record<string, number> = {};
  for (const g of generations) {
    generationsByStatus[g.status] = (generationsByStatus[g.status] ?? 0) + 1;
    generationsByKind[g.kind] = (generationsByKind[g.kind] ?? 0) + 1;
  }

  const gcal = gcalRows[0];

  return {
    exportedAt: new Date().toISOString(),
    user: {
      id: uid,
      name: auth.user.name,
      email: auth.user.email,
      createdAt: me?.createdAt ?? null,
      uiDensity: me?.uiDensity ?? null,
      accountStatus: me?.status ?? null,
    },
    groups: auth.groups,
    projects,
    usageSummary: {
      pointsCharged,
      pointsRefunded,
      pointsNet: pointsCharged - pointsRefunded,
      generationsByStatus,
      generationsByKind,
    },
    generations: withProjectTitle(
      generations.map((g) => ({
        id: g.id,
        projectId: g.projectId,
        modelId: g.modelId,
        kind: g.kind,
        prompt: g.prompt,
        status: g.status,
        pointsEst: g.pointsEst,
        pointsActual: g.pointsActual,
        pointsRefunded: g.pointsRefunded,
        name: g.name,
        favorite: g.favorite,
        error: g.error,
        resultText: g.resultText ? g.resultText.slice(0, 4000) : null,
        resultTextTruncated: (g.resultText?.length ?? 0) > 4000,
        sceneRole: g.sceneRole,
        characterCount: idListLen(g.characterIds),
        scenePresetCount: idListLen(g.scenePresetIds),
        linkedWorkflow: g.workflowRunId != null,
        linkedAgent: g.agentRunId != null,
        paramKeys: paramKeysOf(g.params),
        createdAt: g.createdAt,
      })),
    ),
    messages: withProjectTitle(myMessages),
    feedback: myFeedback,
    notes: withProjectTitle(
      myNotes.map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content.slice(0, 20_000),
        projectId: n.projectId,
        mentionCount: idListLen(n.mentions),
        fromMessage: n.sourceMessageId != null,
        updatedAt: n.updatedAt,
      })),
    ),
    scheduleItems: withProjectTitle(
      mySchedule.map((s) => ({
        id: s.id,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        note: s.note,
        projectId: s.projectId,
        mentionCount: idListLen(s.mentions),
        fromMessage: s.sourceMessageId != null,
        createdAt: s.createdAt,
      })),
    ),
    costLedger: costRows.map((r) => ({
      ...r,
      groupName: groupNameById.get(r.groupId) ?? r.groupId,
    })),
    agentRuns: agentRows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectTitle: titleByProjectId.get(r.projectId) ?? null,
      goal: r.goal,
      summary: r.summary,
      status: r.status,
      estPoints: r.estPoints,
      error: r.error,
      steps: simplifySteps(r.steps),
      planHighlights: planHighlights(r.planSummary),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    groupAgentRuns: groupAgentRows.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      groupName: groupNameById.get(r.groupId) ?? r.groupId,
      goal: r.goal,
      summary: r.summary,
      status: r.status,
      budgetPoints: r.budgetPoints,
      spentPoints: r.spentPoints,
      steps: simplifySteps(r.steps),
      error: r.error,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
    prompts: withProjectTitle(
      promptRows.map((p) => ({
        id: p.id,
        projectId: p.projectId,
        text: p.text,
        modelId: p.modelId,
        useCount: p.useCount,
        characterCount: idListLen(p.characterIds),
        scenePresetCount: idListLen(p.scenePresetIds),
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
    ),
    approvals: withProjectTitle(
      approvalRows.map((a) => ({
        id: a.id,
        projectId: a.projectId,
        sceneId: a.sceneId,
        version: a.version,
        status: a.status,
        reason: a.reason,
        role: a.submittedBy === uid ? ("submitted" as const) : ("decided" as const),
        createdAt: a.createdAt,
        decidedAt: a.decidedAt,
      })),
    ),
    dmMessages: dmRows.map((d) => {
      const peerId = d.senderId === uid ? d.recipientId : d.senderId;
      return {
        id: d.id,
        direction: d.senderId === uid ? ("out" as const) : ("in" as const),
        peerId,
        peerName: peerNames.get(peerId) ?? peerId,
        body: d.body.slice(0, 4000),
        kind: d.kind,
        createdAt: d.createdAt,
      };
    }),
    exportJobs: withProjectTitle(exportJobRows),
    workflowRuns: withProjectTitle(
      workflowRows.map((w) => ({
        id: w.id,
        projectId: w.projectId,
        presetId: w.presetId,
        prompt: w.prompt,
        status: w.status,
        currentStep: w.currentStep,
        error: w.error,
        steps: simplifySteps(w.steps).map((s) => ({ note: s.note, status: s.status })),
        characterCount: idListLen(w.characterIds),
        scenePresetCount: idListLen(w.scenePresetIds),
        createdAt: w.createdAt,
      })),
    ),
    textVersions: withProjectTitle(
      textVersionRows.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        kind: t.kind,
        title: t.title,
        contentPreview: t.content.slice(0, LIMIT.textVersionContent),
        contentTruncated: t.content.length > LIMIT.textVersionContent,
        createdAt: t.createdAt,
      })),
    ),
    projectTasks: withProjectTitle(
      taskRows.map((t) => {
        const isAssignee = t.assigneeId === uid;
        const isCreator = t.createdBy === uid;
        const relation: "assignee" | "creator" | "both" =
          isAssignee && isCreator ? "both" : isAssignee ? "assignee" : "creator";
        return {
          id: t.id,
          projectId: t.projectId,
          title: t.title,
          description: t.description ? t.description.slice(0, 2000) : null,
          status: t.status,
          priority: t.priority,
          taskType: t.taskType,
          relation,
          dueAt: t.dueAt,
          createdAt: t.createdAt,
        };
      }),
    ),
    personalDatabases: personalDbRows.map((d) => ({
      id: d.id,
      name: d.name,
      description: d.description,
      fieldLabels: fieldLabelsOf(d.fields),
      rowCount: rowCountByTable.get(d.id) ?? 0,
      fileCount: fileCountByTable.get(d.id) ?? 0,
      agentAccess: d.agentAccess,
      sampleRows: sampleByTable.get(d.id) ?? [],
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
    integrations: integrationRows,
    googleCalendar: gcal
      ? {
          connected: true,
          googleEmail: gcal.googleEmail,
          status: gcal.status,
          lastSyncAt: gcal.lastSyncAt,
        }
      : { connected: false },
    externalAccounts: externalAccountRows,
  };
}
