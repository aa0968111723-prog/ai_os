import { randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import {
  boundAssistantActionResults,
  type ImportActionResult,
} from "../../shared/assistantActions";
import {
  assistantInteractionRequestSchema,
  type AssistantInteractionLifecycle,
  type AssistantInteractionImportResult,
  type AssistantInteractionRequest,
  type AssistantInteractionSubmission,
  type AssistantInteractionType,
} from "../../shared/assistantInteractions";
import type { AssistantActiveGoal } from "../../shared/assistantGoalFrame";
import type { AgentEvent } from "../../shared/agentEvents";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { listResolvableModels } from "./modelResolve";
import { modelIsOperationallyReady } from "./aiModelPolicy";
import { AgentEventStream } from "./agentEventStream";
import { attachAssetsToShotVerified } from "./assistantAssetBinding";

const INTERACTION_TTL_MS = 30 * 60 * 1_000;
const MAX_DURABLE_MESSAGES = 12;
const MAX_DURABLE_EVENTS = 200;

function uniqueInteractionEvents(stream: AgentEventStream): AgentEvent[] {
  return stream.snapshotEvents().map((event) => ({
    ...event,
    eventId: `${event.runId}:interaction:${randomUUID()}`,
  }));
}

export function createAssistantInteraction(input: {
  runId: string;
  goalId: string;
  type: AssistantInteractionType;
  title: string;
  description?: string;
  options?: AssistantInteractionRequest["options"];
  capabilityId?: string;
  missingSlot?: string;
  targetProjectId?: string;
  expectedResultType?: AssistantInteractionRequest["expectedResultType"];
  now?: Date;
}): AssistantInteractionRequest {
  const now = input.now ?? new Date();
  return assistantInteractionRequestSchema.parse({
    interactionId: randomUUID(),
    runId: input.runId,
    goalId: input.goalId,
    type: input.type,
    title: input.title,
    description: input.description,
    required: true,
    options: input.options,
    capabilityId: input.capabilityId,
    missingSlot: input.missingSlot,
    resumeToken: randomUUID(),
    expiresAt: new Date(now.getTime() + INTERACTION_TTL_MS).toISOString(),
    targetProjectId: input.targetProjectId,
    expectedResultType: input.expectedResultType ?? "selection",
    status: "pending",
    createdAt: now.toISOString(),
  });
}

function constantTimeTokenEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

function assertCurrentInteraction(
  row: typeof schema.assistantConversationStates.$inferSelect,
  input: Pick<AssistantInteractionLifecycle, "runId" | "goalId" | "interactionId" | "resumeToken">,
): AssistantInteractionRequest {
  if (!row.activeGoal) throw new TRPCError({ code: "NOT_FOUND", message: "找不到可恢復的 Assistant goal" });
  const request = row.activeGoal.pendingInteraction;
  if (!request || request.status !== "pending") throw new TRPCError({ code: "CONFLICT", message: "Interaction 已完成或不存在" });
  if (row.runId !== input.runId || row.goalId !== input.goalId || request.runId !== input.runId
    || request.goalId !== input.goalId || request.interactionId !== input.interactionId) {
    throw new TRPCError({ code: "CONFLICT", message: "Stale interaction callback 已拒絕" });
  }
  if (!constantTimeTokenEqual(request.resumeToken, input.resumeToken)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Interaction resume token 無效" });
  }
  if (Date.parse(request.expiresAt) <= Date.now()) {
    throw new TRPCError({ code: "CONFLICT", message: "Interaction 已過期，請重新開啟" });
  }
  if (request.status !== "pending") {
    throw new TRPCError({ code: "CONFLICT", message: "Interaction 已完成或不存在" });
  }
  return request;
}

export async function recordAssistantInteractionLifecycle(auth: AuthState, input: AssistantInteractionLifecycle) {
  requireGroup(auth, input.groupId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`assistant-conversation:${input.conversationId}`}, 0))`);
    const [row] = await tx.select().from(schema.assistantConversationStates).where(and(
      eq(schema.assistantConversationStates.conversationId, input.conversationId),
      eq(schema.assistantConversationStates.groupId, input.groupId),
      eq(schema.assistantConversationStates.userId, auth.user.id),
    ));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到 Assistant conversation" });
    const request = assertCurrentInteraction(row, input);
    const eventType = input.event === "presented" ? "interaction.presented"
      : input.event === "opened" ? "handoff.opened" : "interaction.cancelled";
    const alreadyRecorded = (row.events ?? []).some((event) => (
      event.type === eventType && event.metadata?.interactionId === request.interactionId
    ));
    if (alreadyRecorded) return { accepted: true, runId: input.runId, goalId: input.goalId };
    const stream = new AgentEventStream(input.runId);
    stream.emit({
      type: eventType,
      title: input.event === "presented" ? "已顯示選擇介面" : input.event === "opened" ? "已開啟 Picker" : "已關閉 Picker，可稍後繼續",
      status: input.event === "cancelled" ? "waiting" : "ok",
      metadata: { interactionId: request.interactionId, interactionType: request.type },
    });
    const lifecycleEvents = uniqueInteractionEvents(stream);
    // Cancel/expire must leave durable state that rejects stale callbacks (#664).
    let nextActiveGoal = row.activeGoal;
    if (input.event === "cancelled" && row.activeGoal?.pendingInteraction) {
      const cancelledInteraction = {
        ...row.activeGoal.pendingInteraction,
        status: "cancelled" as const,
      };
      nextActiveGoal = {
        ...row.activeGoal,
        status: "ready",
        pendingInteraction: cancelledInteraction,
        missingSlots: row.activeGoal.missingSlots,
      };
    }
    await tx.update(schema.assistantConversationStates).set({
      events: [...(row.events ?? []), ...lifecycleEvents].slice(-MAX_DURABLE_EVENTS),
      ...(input.event === "cancelled" ? { activeGoal: nextActiveGoal } : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(schema.assistantConversationStates.conversationId, input.conversationId),
      eq(schema.assistantConversationStates.groupId, input.groupId),
      eq(schema.assistantConversationStates.userId, auth.user.id),
    ));
    return { accepted: true, runId: input.runId, goalId: input.goalId };
  });
}

async function editableProject(auth: AuthState, projectId: string, groupId: string) {
  const [project] = await db.select().from(schema.projects).where(and(
    eq(schema.projects.id, projectId),
    eq(schema.projects.groupId, groupId),
    eq(schema.projects.status, "active"),
  ));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到可用專案" });
  requireGroup(auth, project.groupId);
  assertProjectNotArchived(project);
  await assertProjectEditable(auth, project);
  return project;
}

function pickerForSource(source: unknown): AssistantInteractionType | undefined {
  if (source === "GOOGLE_DRIVE" || source === "google-drive") return "DRIVE_PICKER";
  if (source === "LOCAL_FOLDER" || source === "folder" || source === "local-folder") return "FOLDER_PICKER";
  if (source === "LOCAL_FILE" || source === "file" || source === "local-file") return "FILE_PICKER";
  if (source === "AIOS_LIBRARY" || source === "PROJECT_ASSETS" || source === "aios-assets") return "ASSET_PICKER";
  return undefined;
}

function sourceValue(id: string): AssistantActiveGoal["frame"]["source"] | undefined {
  if (id === "google-drive") return { type: "GOOGLE_DRIVE", provider: "google-drive" };
  if (id === "local-file") return { type: "LOCAL_FILE", provider: "local" };
  if (id === "aios-assets") return { type: "PROJECT_ASSETS", provider: "aios" };
  if (id === "google-photos") return { type: "GOOGLE_PHOTOS", provider: "google-photos" };
  return undefined;
}

function sourceForPicker(type: AssistantInteractionType): AssistantInteractionImportResult["source"] | undefined {
  if (type === "DRIVE_PICKER") return "google-drive";
  if (type === "FILE_PICKER") return "file";
  if (type === "FOLDER_PICKER") return "folder";
  return undefined;
}

async function validateImportResult(
  auth: AuthState,
  groupId: string,
  request: AssistantInteractionRequest,
  result: AssistantInteractionImportResult,
): Promise<ImportActionResult> {
  const expectedSource = sourceForPicker(request.type);
  if (!expectedSource || expectedSource !== result.source) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Picker 回傳來源與原始 handoff 不一致" });
  }
  if (!request.targetProjectId || result.projectId !== request.targetProjectId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Picker 回傳的專案與原始 handoff 不一致" });
  }
  const project = await editableProject(auth, result.projectId, groupId);

  if (result.source === "folder") {
    if (!result.folderImportSessionId) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少資料夾匯入 session" });
    const [session] = await db.select().from(schema.folderImportSessions).where(and(
      eq(schema.folderImportSessions.id, result.folderImportSessionId),
      eq(schema.folderImportSessions.groupId, groupId),
      eq(schema.folderImportSessions.projectId, project.id),
      eq(schema.folderImportSessions.createdBy, auth.user.id),
    ));
    if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這次資料夾匯入" });
    const persistedCount = session.uploadedFiles;
    if (persistedCount < 1 || result.count !== persistedCount) {
      throw new TRPCError({ code: "CONFLICT", message: "資料夾匯入計數尚未通過重新讀取驗證" });
    }
    return {
      type: "import", source: "folder", resourceIds: [], assetIds: [], intelligenceIds: [],
      folderImportSessionId: session.id, projectId: project.id, count: persistedCount,
      duplicateCount: session.skippedFiles, needsReviewCount: persistedCount,
      backgroundProcessing: true,
      verification: { status: "verified", message: "已重新讀取 Folder Import session" },
    };
  }

  const assetIds = [...new Set(result.assetIds)];
  if (!assetIds.length || result.count !== assetIds.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "匯入筆數與素材參照不一致" });
  }
  const assets = await db.select({ id: schema.assets.id, meta: schema.assets.meta }).from(schema.assets).where(and(
    inArray(schema.assets.id, assetIds),
    eq(schema.assets.projectId, project.id),
    eq(schema.assets.groupId, groupId),
    isNull(schema.assets.deletedAt),
  ));
  if (assets.length !== assetIds.length) throw new TRPCError({ code: "FORBIDDEN", message: "部分素材不存在或不在可用專案" });
  const expectedProvenance = result.source === "google-drive" ? "google-drive" : "upload";
  if (expectedProvenance && assets.some((asset) => {
    const intake = (asset.meta as { intake?: { provenance?: { sourceType?: unknown } } } | null)?.intake;
    return intake?.provenance?.sourceType !== expectedProvenance;
  })) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "素材 provenance 與 Drive handoff 不一致" });
  }

  const resources = result.resourceIds.length ? await db.select({ id: schema.libraryResources.id, resourceId: schema.libraryResources.resourceId })
    .from(schema.libraryResources).where(and(
      inArray(schema.libraryResources.id, [...new Set(result.resourceIds)]),
      inArray(schema.libraryResources.resourceId, assetIds),
      eq(schema.libraryResources.groupId, groupId),
    )) : [];
  if (resources.length !== new Set(result.resourceIds).size) throw new TRPCError({ code: "CONFLICT", message: "Library refs 未通過重新讀取驗證" });
  const intelligence = result.intelligenceIds.length ? await db.select({ id: schema.assetIntelligence.id, resourceId: schema.assetIntelligence.resourceId })
    .from(schema.assetIntelligence).where(and(
      inArray(schema.assetIntelligence.id, [...new Set(result.intelligenceIds)]),
      inArray(schema.assetIntelligence.resourceId, assetIds),
      eq(schema.assetIntelligence.groupId, groupId),
    )) : [];
  if (intelligence.length !== new Set(result.intelligenceIds).size) throw new TRPCError({ code: "CONFLICT", message: "Intelligence refs 未通過重新讀取驗證" });
  return {
    type: "import", source: result.source, resourceIds: resources.map((row) => row.id), assetIds,
    intelligenceIds: intelligence.map((row) => row.id), projectId: project.id, count: assetIds.length,
    duplicateCount: 0, needsReviewCount: assetIds.length, backgroundProcessing: true,
    verification: { status: "verified", message: "已重新讀取素材、Library 與 Intelligence 參照" },
  };
}

async function validateEntitySelection(
  auth: AuthState,
  groupId: string,
  request: AssistantInteractionRequest,
  selectedIds: string[],
): Promise<{ slot: string; value: string | string[]; label?: string }> {
  const allowed = new Set((request.options ?? []).filter((option) => option.availability !== "BLOCKED").map((option) => option.id));
  if (!selectedIds.length || selectedIds.some((id) => !allowed.has(id))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "選項已失效或不可用" });
  }
  const ids = [...new Set(selectedIds)];
  if (request.type === "SOURCE_PICKER") {
    const source = sourceValue(ids[0]);
    if (!source) throw new TRPCError({ code: "BAD_REQUEST", message: "未知資料來源" });
    return { slot: "source", value: ids[0], label: source.type };
  }
  if (request.type === "PROJECT_PICKER") {
    const project = await editableProject(auth, ids[0], groupId);
    return { slot: "projectId", value: project.id, label: project.title };
  }
  if (request.type === "MODEL_PICKER") {
    const model = listResolvableModels({}).filter(modelIsOperationallyReady).find((candidate) => candidate.id === ids[0]);
    if (!model) throw new TRPCError({ code: "NOT_FOUND", message: "模型已不可用" });
    return { slot: "modelId", value: model.id, label: model.label };
  }
  if (!request.targetProjectId) throw new TRPCError({ code: "BAD_REQUEST", message: "Interaction 缺少專案範圍" });
  const project = await editableProject(auth, request.targetProjectId, groupId);
  if (request.type === "ASSET_PICKER") {
    const rows = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
      inArray(schema.assets.id, ids), eq(schema.assets.projectId, project.id), eq(schema.assets.groupId, groupId), isNull(schema.assets.deletedAt),
    ));
    if (rows.length !== ids.length) throw new TRPCError({ code: "FORBIDDEN", message: "部分素材已不可用" });
    return { slot: "assetIds", value: ids };
  }
  if (request.type === "SCENE_PICKER" || request.type === "SHOT_PICKER") {
    const rows = await db.select({ id: schema.scenes.id, title: schema.scenes.title }).from(schema.scenes).where(and(
      inArray(schema.scenes.id, ids), eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt),
    ));
    if (rows.length !== ids.length) throw new TRPCError({ code: "FORBIDDEN", message: "分鏡已不可用" });
    return { slot: request.type === "SHOT_PICKER" ? "shotId" : "sceneId", value: ids[0], label: rows[0]?.title };
  }
  throw new TRPCError({ code: "BAD_REQUEST", message: "這個 interaction 不接受選項回傳" });
}

export async function submitAssistantInteraction(auth: AuthState, input: AssistantInteractionSubmission) {
  requireGroup(auth, input.groupId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`assistant-conversation:${input.conversationId}`}, 0))`);
    const [row] = await tx.select().from(schema.assistantConversationStates).where(and(
      eq(schema.assistantConversationStates.conversationId, input.conversationId),
      eq(schema.assistantConversationStates.groupId, input.groupId),
      eq(schema.assistantConversationStates.userId, auth.user.id),
    ));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到 Assistant conversation" });
    const request = assertCurrentInteraction(row, input);

    let activeGoal: AssistantActiveGoal = row.activeGoal!;
    let nextInteraction: AssistantInteractionRequest | undefined;
    let actionResult: ImportActionResult | undefined;
    let answer = "已收到你的選擇，Aios 會接著同一個工作繼續。";
    const eventStream = new AgentEventStream(input.runId);
    eventStream.emit({ type: "interaction.submitted", title: "已收到選擇", status: "ok", metadata: { interactionType: request.type } });

    if (input.importResult) {
      actionResult = await validateImportResult(auth, input.groupId, request, input.importResult);
      activeGoal = { ...activeGoal, status: "completed", missingSlots: [], pendingInteraction: undefined, resultRefIds: actionResult.assetIds.slice(0, 20) };
      answer = `✓ ${actionResult.count} 項資料已安全加入。AI 正在背景整理，你可以繼續聊天。`;
      eventStream.emit({ type: "handoff.returned", title: "Picker 已回到原本對話", status: "ok", resultCount: actionResult.count });
      eventStream.emit({ type: "verification.completed", title: actionResult.verification.message, status: "ok", resultCount: actionResult.count });
      eventStream.emit({ type: "agent.resumed", title: "已在同一個工作繼續", status: "ok" });
      eventStream.emit({ type: "agent.completed", title: "資料已安全加入", status: "ok", resultCount: actionResult.count });
    } else {
      const selected = await validateEntitySelection(auth, input.groupId, request, input.selectedIds ?? []);
      const resolvedSlots = { ...activeGoal.resolvedSlots, [selected.slot]: selected.value, ...(selected.label ? { [`${selected.slot}Label`]: selected.label } : {}) };
      let frame = activeGoal.frame;
      if (selected.slot === "projectId") frame = { ...frame, scope: { ...frame.scope, projectId: selected.value as string } };
      if (selected.slot === "source") frame = { ...frame, source: sourceValue(selected.value as string) };
      const projectId = selected.slot === "projectId" ? selected.value as string : (request.targetProjectId ?? frame.scope.projectId);
      const pickerType = selected.slot === "source"
        ? pickerForSource(selected.value)
        : selected.slot === "projectId"
          ? pickerForSource(frame.source?.type)
          : undefined;
      const pendingProjects = Array.isArray(activeGoal.resolvedSlots.projectCandidates)
        ? activeGoal.resolvedSlots.projectCandidates as Array<{ id?: unknown; title?: unknown }>
        : [];
      if (selected.slot === "source" && !projectId) {
        if (!pendingProjects.length) {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "目前沒有可加入的專案，請先建立專案" });
        }
        nextInteraction = createAssistantInteraction({
          runId: input.runId, goalId: input.goalId, type: "PROJECT_PICKER",
          title: "要加入哪個專案？", description: "選擇後會直接開啟來源 picker。",
          capabilityId: request.capabilityId, missingSlot: "projectId",
          options: pendingProjects
            .filter((candidate): candidate is { id: string; title: string } => typeof candidate.id === "string" && typeof candidate.title === "string")
            .map((candidate) => ({ id: candidate.id, label: candidate.title, availability: "AVAILABLE" as const })),
        });
        activeGoal = { ...activeGoal, frame, resolvedSlots, status: "waiting_user_input", missingSlots: ["projectId"], pendingInteraction: nextInteraction };
        answer = nextInteraction.description ?? nextInteraction.title;
        eventStream.emit({ type: "agent.resumed", title: "已套用來源並繼續原本工作", status: "running" });
        eventStream.emit({ type: "interaction.requested", title: nextInteraction.title, status: "waiting", metadata: { interactionType: nextInteraction.type } });
        eventStream.emit({ type: "waiting.user_input", title: nextInteraction.title, status: "waiting" });
      } else if (pickerType && projectId && pickerType !== "ASSET_PICKER") {
        const project = await editableProject(auth, projectId, input.groupId);
        nextInteraction = createAssistantInteraction({
          runId: input.runId, goalId: input.goalId, type: pickerType,
          title: pickerType === "DRIVE_PICKER" ? "選擇 Google Drive 檔案" : pickerType === "FOLDER_PICKER" ? "選擇資料夾" : "選擇檔案",
          description: `加入「${project.title}」；完成後會回到同一個對話。`,
          capabilityId: request.capabilityId, targetProjectId: project.id, expectedResultType: "import",
        });
        activeGoal = { ...activeGoal, frame, resolvedSlots, status: "waiting_user_input", missingSlots: [], pendingInteraction: nextInteraction };
        answer = nextInteraction.description ?? nextInteraction.title;
        eventStream.emit({ type: "agent.resumed", title: "已套用選擇並繼續原本工作", status: "running" });
        eventStream.emit({ type: "interaction.requested", title: nextInteraction.title, status: "waiting", metadata: { interactionType: nextInteraction.type } });
        eventStream.emit({ type: "waiting.user_input", title: nextInteraction.title, status: "waiting" });
      } else if (pickerType === "ASSET_PICKER" && projectId) {
        const project = await editableProject(auth, projectId, input.groupId);
        const rows = await db.select({ id: schema.assets.id, title: schema.assets.title, kind: schema.assets.kind })
          .from(schema.assets).where(and(
            eq(schema.assets.projectId, project.id), eq(schema.assets.groupId, input.groupId), isNull(schema.assets.deletedAt),
          )).limit(60);
        nextInteraction = createAssistantInteraction({
          runId: input.runId, goalId: input.goalId, type: "ASSET_PICKER",
          title: "選擇 Aios 素材", description: `從「${project.title}」選擇素材。`,
          capabilityId: request.capabilityId, missingSlot: "assetIds", targetProjectId: project.id,
          options: rows.map((asset) => ({ id: asset.id, label: asset.title, subtitle: asset.kind, availability: "AVAILABLE" as const })),
        });
        activeGoal = { ...activeGoal, frame, resolvedSlots, status: "waiting_user_input", missingSlots: ["assetIds"], pendingInteraction: nextInteraction };
        answer = nextInteraction.description ?? nextInteraction.title;
        eventStream.emit({ type: "agent.resumed", title: "已套用來源並繼續原本工作", status: "running" });
        eventStream.emit({ type: "interaction.requested", title: nextInteraction.title, status: "waiting", metadata: { interactionType: nextInteraction.type } });
        eventStream.emit({ type: "waiting.user_input", title: nextInteraction.title, status: "waiting" });
      } else if (request.capabilityId === "attach_asset_to_shot") {
        const assetIds = (resolvedSlots.assetIds ?? []) as string[];
        const shotId = resolvedSlots.shotId as string | undefined;
        if (!projectId || !assetIds.length || !shotId) {
          const missingSlot = !assetIds.length ? "assetIds" : "shotId";
          if (!projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "續跑素材綁定時缺少專案" });
          const project = await editableProject(auth, projectId, input.groupId);
          const options = missingSlot === "assetIds"
            ? (await db.select({ id: schema.assets.id, title: schema.assets.title, kind: schema.assets.kind })
                .from(schema.assets).where(and(
                  eq(schema.assets.projectId, project.id), eq(schema.assets.groupId, input.groupId), isNull(schema.assets.deletedAt),
                )).limit(60))
                .map((item) => ({ id: item.id, label: item.title, subtitle: item.kind, availability: "AVAILABLE" as const }))
            : (await db.select({ id: schema.scenes.id, title: schema.scenes.title })
                .from(schema.scenes).where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt))).limit(60))
                .map((item, index) => ({ id: item.id, label: item.title, subtitle: `第 ${index + 1} 鏡`, availability: "AVAILABLE" as const }));
          nextInteraction = createAssistantInteraction({
            runId: input.runId,
            goalId: input.goalId,
            type: missingSlot === "assetIds" ? "ASSET_PICKER" : "SHOT_PICKER",
            title: missingSlot === "assetIds" ? "選擇要加入的素材" : "選擇分鏡",
            description: "已記住上一個選擇；這次選完會直接續跑原操作。",
            capabilityId: request.capabilityId,
            missingSlot,
            targetProjectId: project.id,
            options,
          });
          activeGoal = { ...activeGoal, frame, resolvedSlots, status: "waiting_user_input", missingSlots: [missingSlot], pendingInteraction: nextInteraction };
          answer = nextInteraction.description ?? nextInteraction.title;
          eventStream.emit({ type: "agent.resumed", title: "已在同一個工作繼續", status: "waiting" });
          eventStream.emit({ type: "interaction.requested", title: nextInteraction.title, status: "waiting", metadata: { interactionType: nextInteraction.type } });
          eventStream.emit({ type: "waiting.user_input", title: nextInteraction.title, status: "waiting" });
        } else {
          const bound = await attachAssetsToShotVerified({ auth, projectId, shotId, assetIds });
          const verified = bound.verification.status === "verified";
          activeGoal = {
            ...activeGoal, frame, resolvedSlots, status: verified ? "completed" : "failed",
            missingSlots: [], pendingInteraction: undefined, resultRefIds: bound.assetIds.slice(0, 20),
          };
          answer = verified
            ? `✓ 已把 ${bound.assetIds.length} 項素材加入分鏡，並重新讀取確認。`
            : "素材綁定後未通過重新讀取驗證，因此沒有標示為完成。";
          eventStream.emit({ type: "agent.resumed", title: "已在同一個工作繼續", status: "ok" });
          eventStream.emit({ type: "verification.completed", title: bound.verification.message, status: verified ? "ok" : "failed", resultCount: bound.assetIds.length });
          eventStream.emit({ type: verified ? "agent.completed" : "agent.failed", title: answer, status: verified ? "ok" : "failed", resultCount: bound.assetIds.length });
        }
      } else {
        activeGoal = { ...activeGoal, frame, resolvedSlots, status: "ready", missingSlots: activeGoal.missingSlots.filter((slot) => slot !== selected.slot), pendingInteraction: undefined };
        answer = `已選擇${selected.label ? `「${selected.label}」` : "項目"}，並接回同一個工作。`;
        eventStream.emit({ type: "agent.resumed", title: "已在同一個工作繼續", status: "ok" });
      }
    }

    const recentActionResults = actionResult
      ? boundAssistantActionResults([...(row.recentActionResults ?? []), actionResult])
      : row.recentActionResults;
    const interactionEvents = uniqueInteractionEvents(eventStream);
    const events = [...(row.events ?? []), ...interactionEvents].slice(-MAX_DURABLE_EVENTS);
    const messages = activeGoal.status === "completed" || activeGoal.status === "failed"
      ? [...row.messages, { role: "assistant" as const, text: answer }].slice(-MAX_DURABLE_MESSAGES)
      : row.messages;
    const [updated] = await tx.update(schema.assistantConversationStates).set({
      projectId: activeGoal.frame.scope.projectId ?? row.projectId,
      status: activeGoal.status === "completed" ? "completed" : activeGoal.status === "failed" ? "failed" : "waiting_user_input",
      activeGoal,
      recentActionResults,
      events,
      messages,
      updatedAt: new Date(),
    }).where(and(
      eq(schema.assistantConversationStates.conversationId, input.conversationId),
      eq(schema.assistantConversationStates.userId, auth.user.id),
      eq(schema.assistantConversationStates.groupId, input.groupId),
    )).returning({ conversationId: schema.assistantConversationStates.conversationId });
    if (!updated) throw new TRPCError({ code: "CONFLICT", message: "Conversation 在 callback 期間已變更" });
    return { runId: input.runId, goalId: input.goalId, interactionId: input.interactionId, activeGoal, nextInteraction, actionResult, answer, events: interactionEvents };
  });
}
