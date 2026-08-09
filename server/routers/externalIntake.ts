import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { authedProcedure, requireGroup, router } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";
import {
  importDriveFileIntoProject,
  importUrlIntoProject,
} from "../services/universalIntake";
import { finalizeAiTraceSession, recordAiTraceEventSafely, updateAiTraceSession } from "../services/aiTrace";
import {
  BUILT_IN_EXTERNAL_TOOLS,
  EXTERNAL_TOOL_CAPABILITIES,
  externalToolForTarget,
  type ExternalToolCapability,
} from "../../shared/externalTools";
import { INTAKE_SOURCES, deterministicMediaMetadataSchema, intakePageContextSchema } from "../../shared/universalIntake";

const ACTIVE_SESSION_STATUSES = ["prepared", "opened_external", "waiting_result", "result_imported"] as const;

async function loadProjectForActor(auth: Parameters<typeof requireGroup>[0], projectId: string, edit = false) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  if (edit) {
    assertProjectNotArchived(project);
    await assertProjectEditable(auth, project);
  }
  return project;
}

function validateLauncherUrl(raw: string): string {
  let url: URL;
  try { url = new URL(raw); } catch { throw new TRPCError({ code: "BAD_REQUEST", message: "工具網址格式不正確" }); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "工具網址只支援 http/https" });
  }
  return url.toString();
}

function intakeMetaOf(asset: typeof schema.assets.$inferSelect): Record<string, unknown> | null {
  const meta = asset.meta && typeof asset.meta === "object" ? asset.meta as Record<string, unknown> : {};
  const intake = meta.intake;
  return intake && typeof intake === "object" && !Array.isArray(intake) ? intake as Record<string, unknown> : null;
}

async function confirmImportedAsset(input: {
  auth: NonNullable<Parameters<typeof loadProjectForActor>[0]>;
  assetId: string;
  sceneId?: string;
  bindingId?: string;
}) {
  const [asset] = await db.select().from(schema.assets)
    .where(and(eq(schema.assets.id, input.assetId), isNull(schema.assets.deletedAt)));
  if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
  const project = await loadProjectForActor(input.auth, asset.projectId, true);
  let scene: typeof schema.scenes.$inferSelect | null = null;
  let scenePatch: { assetId: string } | { narrationAssetId: string } | null = null;
  if (input.sceneId) {
    [scene] = await db.select().from(schema.scenes)
      .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
    if (!scene || scene.projectId !== project.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "這個分鏡不屬於此專案" });
    }
    scenePatch = asset.kind === "image" || asset.kind === "video"
      ? { assetId: asset.id }
      : asset.kind === "audio"
        ? { narrationAssetId: asset.id }
        : null;
    if (!scenePatch) throw new TRPCError({ code: "BAD_REQUEST", message: "文件可留在素材庫，但不能設為分鏡畫面" });
  }
  const meta = asset.meta && typeof asset.meta === "object" ? asset.meta as Record<string, unknown> : {};
  const intake = intakeMetaOf(asset) ?? {};
  const nextMeta = {
    ...meta,
    intake: {
      ...intake,
      status: "ready",
      confirmedAt: new Date().toISOString(),
      confirmedBy: input.auth.user.id,
      confirmedSceneId: scene?.id ?? null,
    },
  };
  const externalSessionId = ((intake.provenance as Record<string, unknown> | undefined)?.externalSessionId);
  const updated = await db.transaction(async (tx) => {
    if (scene && scenePatch) {
      await tx.update(schema.scenes).set(scenePatch).where(eq(schema.scenes.id, scene.id));
    }
    if (input.bindingId) {
      const [confirmed] = await tx.update(schema.contextBindings).set({
        source: "USER_CONFIRMED",
        confirmedByUser: true,
        priority: "PRIMARY",
        updatedAt: new Date(),
      }).where(and(
        eq(schema.contextBindings.id, input.bindingId),
        eq(schema.contextBindings.projectId, project.id),
        eq(schema.contextBindings.resourceId, asset.id),
        ...(scene ? [eq(schema.contextBindings.scopeId, scene.id)] : []),
      )).returning({ id: schema.contextBindings.id });
      if (!confirmed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "分鏡建議已失效，請重新整理後再確認" });
      }
    }
    const [confirmedAsset] = await tx.update(schema.assets).set({ meta: nextMeta })
      .where(eq(schema.assets.id, asset.id)).returning();
    if (!confirmedAsset) throw new TRPCError({ code: "NOT_FOUND", message: "素材已不存在" });
    if (typeof externalSessionId === "string") {
      await tx.update(schema.externalGenerationSessions).set({
        status: "completed",
        importedAssetId: asset.id,
        completedAt: new Date(),
        updatedAt: new Date(),
      }).where(and(
        eq(schema.externalGenerationSessions.id, externalSessionId),
        eq(schema.externalGenerationSessions.userId, input.auth.user.id),
        eq(schema.externalGenerationSessions.projectId, project.id),
      ));
    }
    return confirmedAsset;
  });
  const traceSessionId = typeof intake.traceSessionId === "string" ? intake.traceSessionId : null;
  if (traceSessionId) {
    await recordAiTraceEventSafely({
      sessionId: traceSessionId,
      eventType: "completed",
      summary: scene ? `使用者已套用到「${scene.title}」` : "使用者已確認保留在素材庫",
      payload: { assetId: asset.id, sceneId: scene?.id ?? null },
    });
    await updateAiTraceSession(traceSessionId, { status: "completed", summary: scene ? "成果已回填分鏡" : "成果已確認入庫" }).catch(() => undefined);
  }
  return { ok: true, asset: updated, sceneId: scene?.id ?? null };
}

export const externalIntakeRouter = router({
  tools: authedProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireGroup(ctx.auth, input.groupId);
    const custom = await db.select().from(schema.userExternalTools).where(and(
      eq(schema.userExternalTools.userId, ctx.auth.user.id),
      eq(schema.userExternalTools.groupId, input.groupId),
    )).orderBy(desc(schema.userExternalTools.favorite), schema.userExternalTools.name);
    return [
      ...BUILT_IN_EXTERNAL_TOOLS,
      ...custom.map((tool) => ({
        key: tool.id,
        name: tool.name,
        url: tool.url,
        capabilities: tool.capabilities,
        instructions: tool.instructions ?? "自訂外部 AI 工具",
        builtIn: false,
        favorite: tool.favorite,
      })),
    ];
  }),

  saveTool: authedProcedure.input(z.object({
    groupId: z.string().uuid(),
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(80),
    url: z.string().trim().min(1).max(2_000),
    capabilities: z.array(z.enum(EXTERNAL_TOOL_CAPABILITIES)).min(1).max(5),
    favorite: z.boolean().default(false),
    instructions: z.string().trim().max(500).optional(),
  })).mutation(async ({ ctx, input }) => {
    requireGroup(ctx.auth, input.groupId);
    const values = {
      userId: ctx.auth.user.id,
      groupId: input.groupId,
      name: input.name,
      url: validateLauncherUrl(input.url),
      capabilities: input.capabilities,
      favorite: input.favorite,
      instructions: input.instructions ?? null,
      updatedAt: new Date(),
    };
    if (input.id) {
      const [row] = await db.update(schema.userExternalTools).set(values).where(and(
        eq(schema.userExternalTools.id, input.id),
        eq(schema.userExternalTools.userId, ctx.auth.user.id),
        eq(schema.userExternalTools.groupId, input.groupId),
      )).returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個工具" });
      return row;
    }
    const [row] = await db.insert(schema.userExternalTools).values(values).onConflictDoUpdate({
      target: [
        schema.userExternalTools.userId,
        schema.userExternalTools.groupId,
        schema.userExternalTools.name,
      ],
      set: {
        url: values.url,
        capabilities: values.capabilities,
        favorite: values.favorite,
        instructions: values.instructions,
        updatedAt: values.updatedAt,
      },
    }).returning();
    return row;
  }),

  removeTool: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const rows = await db.delete(schema.userExternalTools).where(and(
      eq(schema.userExternalTools.id, input.id),
      eq(schema.userExternalTools.userId, ctx.auth.user.id),
    )).returning({ id: schema.userExternalTools.id });
    return { ok: true, removed: rows.length > 0 };
  }),

  prepareSession: authedProcedure.input(z.object({
    projectId: z.string().uuid(),
    sceneId: z.string().uuid().optional(),
    targetType: z.enum(["image", "video", "audio", "music", "text"]),
    externalTool: z.string().trim().min(1).max(100),
    prompt: z.string().trim().min(1).max(20_000),
    negativePrompt: z.string().max(8_000).optional(),
    referenceAssetIds: z.array(z.string().uuid()).max(30).default([]),
  })).mutation(async ({ ctx, input }) => {
    const project = await loadProjectForActor(ctx.auth, input.projectId, true);
    if (input.sceneId) {
      const [scene] = await db.select().from(schema.scenes).where(and(
        eq(schema.scenes.id, input.sceneId),
        isNull(schema.scenes.deletedAt),
      ));
      if (!scene || scene.projectId !== project.id) throw new TRPCError({ code: "BAD_REQUEST", message: "找不到這個分鏡" });
    }
    if (input.referenceAssetIds.length) {
      const rows = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
        eq(schema.assets.projectId, project.id),
        isNull(schema.assets.deletedAt),
      ));
      const allowed = new Set(rows.map((row) => row.id));
      if (input.referenceAssetIds.some((id) => !allowed.has(id))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "有參考素材不屬於此專案" });
      }
    }
    const builtin = BUILT_IN_EXTERNAL_TOOLS.find((tool) => tool.key === input.externalTool);
    const [custom] = builtin ? [null] : await db.select().from(schema.userExternalTools).where(and(
      eq(schema.userExternalTools.id, input.externalTool),
      eq(schema.userExternalTools.userId, ctx.auth.user.id),
      eq(schema.userExternalTools.groupId, project.groupId),
    ));
    const tool = builtin ?? (custom ? {
      key: custom.id, name: custom.name, url: custom.url, capabilities: custom.capabilities,
    } : null);
    if (!tool) throw new TRPCError({ code: "NOT_FOUND", message: "找不到此外部工具" });
    if (!externalToolForTarget(input.targetType, tool.capabilities as ExternalToolCapability[])) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${tool.name} 不支援這次要生成的內容類型` });
    }
    const [session] = await db.insert(schema.externalGenerationSessions).values({
      projectId: project.id,
      groupId: project.groupId,
      userId: ctx.auth.user.id,
      sceneId: input.sceneId ?? null,
      targetType: input.targetType,
      externalTool: tool.key,
      externalToolName: tool.name,
      externalUrl: tool.url,
      prompt: input.prompt,
      negativePrompt: input.negativePrompt ?? null,
      referenceAssetIds: input.referenceAssetIds,
    }).returning();
    const trace = await createSessionTrace({
      groupId: project.groupId,
      projectId: project.id,
      userId: ctx.auth.user.id,
      sceneId: input.sceneId,
      toolName: tool.name,
      prompt: input.prompt,
      referenceAssetIds: input.referenceAssetIds,
    });
    if (!trace) return session;
    await updateAiTraceSession(trace.id, { sourceType: "external_generation_session", sourceId: session!.id }).catch(() => undefined);
    const [tracedSession] = await db.update(schema.externalGenerationSessions)
      .set({ traceSessionId: trace.id, updatedAt: new Date() })
      .where(eq(schema.externalGenerationSessions.id, session!.id))
      .returning();
    return tracedSession ?? session;
  }),

  markOpened: authedProcedure.input(z.object({ sessionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [session] = await db.select().from(schema.externalGenerationSessions)
      .where(eq(schema.externalGenerationSessions.id, input.sessionId));
    if (!session || session.userId !== ctx.auth.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工作階段" });
    await loadProjectForActor(ctx.auth, session.projectId, true);
    if (session.status === "waiting_result") return session;
    if (session.status !== "prepared" && session.status !== "opened_external") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "這個外部生成工作階段已結束，不能重新開啟" });
    }
    const [updated] = await db.update(schema.externalGenerationSessions).set({
      status: "waiting_result",
      updatedAt: new Date(),
    }).where(eq(schema.externalGenerationSessions.id, session.id)).returning();
    if (session.traceSessionId) {
      await recordAiTraceEventSafely({
        sessionId: session.traceSessionId,
        eventType: "tool_call",
        summary: `已開啟 ${session.externalToolName}，等待外部成果`,
        payload: { externalTool: session.externalTool, sceneId: session.sceneId },
      });
      await updateAiTraceSession(session.traceSessionId, { status: "running", summary: "等待使用者帶回外部生成成果" }).catch(() => undefined);
    }
    return updated;
  }),

  activeSessions: authedProcedure.input(z.object({
    projectId: z.string().uuid(),
    sceneId: z.string().uuid().optional(),
  })).query(async ({ ctx, input }) => {
    await loadProjectForActor(ctx.auth, input.projectId);
    const rows = await db.select().from(schema.externalGenerationSessions).where(and(
      eq(schema.externalGenerationSessions.projectId, input.projectId),
      eq(schema.externalGenerationSessions.userId, ctx.auth.user.id),
      sql`${schema.externalGenerationSessions.status} in (${sql.join(ACTIVE_SESSION_STATUSES.map((s) => sql`${s}`), sql`, `)})`,
      ...(input.sceneId ? [eq(schema.externalGenerationSessions.sceneId, input.sceneId)] : []),
    )).orderBy(desc(schema.externalGenerationSessions.createdAt)).limit(20);
    return rows;
  }),

  cancelSession: authedProcedure.input(z.object({ sessionId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [session] = await db.select().from(schema.externalGenerationSessions)
      .where(eq(schema.externalGenerationSessions.id, input.sessionId));
    if (!session || session.userId !== ctx.auth.user.id) throw new TRPCError({ code: "NOT_FOUND", message: "找不到工作階段" });
    await loadProjectForActor(ctx.auth, session.projectId, true);
    if (session.status === "cancelled" || session.status === "completed") return { ok: true };
    if (session.status === "result_imported") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "成果已帶入，請在匯入收件匣確認或保留" });
    }
    await db.update(schema.externalGenerationSessions).set({ status: "cancelled", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.externalGenerationSessions.id, session.id));
    if (session.traceSessionId) await finalizeAiTraceSession({ sessionId: session.traceSessionId, status: "stopped", summary: "使用者取消外部生成工作階段" }).catch(() => false);
    return { ok: true };
  }),

  inbox: authedProcedure.input(z.object({ projectId: z.string().uuid(), limit: z.number().int().min(1).max(200).default(100) }))
    .query(async ({ ctx, input }) => {
      await loadProjectForActor(ctx.auth, input.projectId);
      const assets = await db.select().from(schema.assets).where(and(
        eq(schema.assets.projectId, input.projectId),
        isNull(schema.assets.deletedAt),
        sql`${schema.assets.meta} ? 'intake'`,
      )).orderBy(desc(schema.assets.createdAt)).limit(input.limit);
      const scenes = await db.select({ id: schema.scenes.id, title: schema.scenes.title, orderIndex: schema.scenes.orderIndex })
        .from(schema.scenes).where(and(eq(schema.scenes.projectId, input.projectId), isNull(schema.scenes.deletedAt)));
      const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
      const intelligence = await db.select({
        resourceId: schema.assetIntelligence.resourceId,
        status: schema.assetIntelligence.analysisStatus,
        category: schema.assetIntelligence.category,
        summary: schema.assetIntelligence.summary,
      }).from(schema.assetIntelligence).where(eq(schema.assetIntelligence.projectId, input.projectId));
      const intelligenceByAsset = new Map(intelligence.map((row) => [row.resourceId, row]));
      const items = assets.map((asset) => {
        const intake = intakeMetaOf(asset) ?? {};
        const suggestion = intake.suggestion && typeof intake.suggestion === "object"
          ? intake.suggestion as Record<string, unknown> : null;
        const sceneId = typeof suggestion?.sceneId === "string" ? suggestion.sceneId : null;
        return {
          asset,
          status: typeof intake.status === "string" ? intake.status : "needs_review",
          provenance: intake.provenance ?? null,
          media: intake.media ?? null,
          suggestion: sceneId ? {
            bindingId: typeof suggestion?.bindingId === "string" ? suggestion.bindingId : null,
            scene: sceneById.get(sceneId) ?? null,
            confidence: typeof suggestion?.confidence === "number" ? suggestion.confidence : null,
            reasons: Array.isArray(suggestion?.reasons) ? suggestion.reasons.filter((r): r is string => typeof r === "string") : [],
          } : null,
          intelligence: intelligenceByAsset.get(asset.id) ?? null,
        };
      });
      return {
        items,
        counts: {
          total: items.length,
          needsReview: items.filter((item) => item.status !== "ready").length,
          ready: items.filter((item) => item.status === "ready").length,
          unmatched: items.filter((item) => item.status !== "ready" && !item.suggestion).length,
        },
      };
    }),

  confirm: authedProcedure.input(z.object({
    assetId: z.string().uuid(),
    sceneId: z.string().uuid().optional(),
    bindingId: z.string().uuid().optional(),
  }).refine((value) => !value.bindingId || !!value.sceneId, {
    message: "確認分鏡建議時必須指定分鏡",
    path: ["sceneId"],
  })).mutation(async ({ ctx, input }) => confirmImportedAsset({ auth: ctx.auth, ...input })),

  importUrl: authedProcedure.input(z.object({
    projectId: z.string().uuid(),
    url: z.string().trim().min(1).max(4_000),
    source: z.enum(INTAKE_SOURCES).default("url"),
    sourceTool: z.string().trim().max(100).optional(),
    externalSessionId: z.string().uuid().optional(),
    context: intakePageContextSchema.optional(),
    mediaMetadata: deterministicMediaMetadataSchema.optional(),
    forceDuplicate: z.boolean().default(false),
  })).mutation(async ({ ctx, input }) => {
    return importUrlIntoProject({ auth: ctx.auth, ...input });
  }),

  importDriveFile: authedProcedure.input(z.object({
    projectId: z.string().uuid(),
    fileId: z.string().regex(/^[\w-]{5,200}$/, "Google 檔案 id 格式不正確"),
    externalSessionId: z.string().uuid().optional(),
    context: intakePageContextSchema.optional(),
    forceDuplicate: z.boolean().default(false),
  })).mutation(async ({ ctx, input }) => {
    return importDriveFileIntoProject({ auth: ctx.auth, ...input });
  }),
});

async function createSessionTrace(input: {
  groupId: string;
  projectId: string;
  userId: string;
  sceneId?: string;
  toolName: string;
  prompt: string;
  referenceAssetIds: string[];
}) {
  const { createAiTraceSession } = await import("../services/aiTrace");
  const trace = await createAiTraceSession({
    groupId: input.groupId,
    projectId: input.projectId,
    userId: input.userId,
    mode: "intake",
    title: `準備前往 ${input.toolName} 生成`,
    summary: "Prompt 與參考素材已整理，尚未開啟外部工具",
  }).catch(() => null);
  if (trace) await recordAiTraceEventSafely({
    sessionId: trace.id,
    eventType: "prepared",
    summary: "已準備外部生成交接",
    payload: {
      sceneId: input.sceneId ?? null,
      externalTool: input.toolName,
      promptChars: input.prompt.length,
      referenceAssetIds: input.referenceAssetIds,
    },
  });
  return trace;
}
