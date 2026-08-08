import { z } from "zod";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedProcedure, requireGroup, router } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable } from "../services/projectAcl";
import { listDataHubResources } from "../services/dataHub";
import {
  hybridSearchIntelligence,
  intelligenceSummary,
  registerIntelligenceResource,
  retrieveIntelligenceContext,
} from "../services/intelligenceLibrary";
import { resolveReviewDecision } from "../services/intelligenceCore";

async function visibleProject(auth: Parameters<typeof requireGroup>[0], projectId?: string) {
  if (!projectId) return null;
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  return project;
}

function authGroupIds(auth: Parameters<typeof requireGroup>[0]): string[] {
  return [...new Set(auth.groups.map((group) => group.groupId))];
}

async function visibleIntelligenceResource(
  auth: Parameters<typeof requireGroup>[0],
  intelligenceId: string,
) {
  const [intelligence] = await db.select().from(schema.assetIntelligence)
    .where(eq(schema.assetIntelligence.id, intelligenceId));
  if (!intelligence) throw new TRPCError({ code: "NOT_FOUND", message: "找不到資料" });
  requireGroup(auth, intelligence.groupId);
  const visible = await listDataHubResources(auth, { kinds: [intelligence.resourceKind as "asset" | "knowledge" | "document"], perKindLimit: 200 });
  const resource = visible.resources.find((candidate) => candidate.kind === intelligence.resourceKind && candidate.rawId === intelligence.resourceId);
  if (!resource) throw new TRPCError({ code: "NOT_FOUND", message: "找不到資料" });
  return { intelligence, resource };
}

export const intelligenceRouter = router({
  summary: authedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await visibleProject(ctx.auth, input?.projectId);
      return intelligenceSummary(ctx.auth, input?.projectId);
    }),

  /** ACL-first hybrid retrieval: permission filtering happens before vector scoring. */
  search: authedProcedure
    .input(z.object({
      q: z.string().trim().min(1).max(240),
      projectId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await visibleProject(ctx.auth, input.projectId);
      return hybridSearchIntelligence(ctx.auth, input);
    }),

  /** RAG-ready retrieval with reranked chunks, source trace and persisted debug run. */
  retrieve: authedProcedure
    .input(z.object({
      q: z.string().trim().min(1).max(1_000),
      projectId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(30).optional(),
      budgetChars: z.number().int().min(1_000).max(40_000).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await visibleProject(ctx.auth, input.projectId);
      return retrieveIntelligenceContext(ctx.auth, input);
    }),

  assetDetail: authedProcedure
    .input(z.object({ intelligenceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { intelligence, resource } = await visibleIntelligenceResource(ctx.auth, input.intelligenceId);
      const [classifications, tags, chunks, segments, relationships, versions, sources, faces] = await Promise.all([
        db.select().from(schema.aiClassifications).where(eq(schema.aiClassifications.intelligenceId, intelligence.id)).orderBy(desc(schema.aiClassifications.createdAt)),
        db.select({ tag: schema.intelligenceTags, link: schema.assetIntelligenceTags })
          .from(schema.assetIntelligenceTags)
          .innerJoin(schema.intelligenceTags, eq(schema.intelligenceTags.id, schema.assetIntelligenceTags.tagId))
          .where(eq(schema.assetIntelligenceTags.intelligenceId, intelligence.id)),
        db.select().from(schema.intelligenceChunks).where(eq(schema.intelligenceChunks.intelligenceId, intelligence.id)).orderBy(schema.intelligenceChunks.ordinal),
        db.select().from(schema.intelligenceSegments).where(eq(schema.intelligenceSegments.intelligenceId, intelligence.id)).orderBy(schema.intelligenceSegments.ordinal),
        db.select().from(schema.entityRelationships).where(and(
          eq(schema.entityRelationships.fromType, "asset_intelligence"),
          eq(schema.entityRelationships.fromId, intelligence.id),
        )),
        db.select().from(schema.intelligenceVersionLinks).where(or(
          eq(schema.intelligenceVersionLinks.parentIntelligenceId, intelligence.id),
          eq(schema.intelligenceVersionLinks.childIntelligenceId, intelligence.id),
        )),
        db.select().from(schema.intelligenceDataSources).where(eq(schema.intelligenceDataSources.intelligenceId, intelligence.id)),
        db.select().from(schema.detectedFaces).where(eq(schema.detectedFaces.intelligenceId, intelligence.id)),
      ]);
      return { resource, intelligence, classifications, tags, chunks, segments, relationships, versions, sources, faces };
    }),

  graph: authedProcedure
    .input(z.object({ projectId: z.string().uuid().optional(), limit: z.number().int().min(1).max(500).default(200) }).optional())
    .query(async ({ ctx, input }) => {
      await visibleProject(ctx.auth, input?.projectId);
      const groups = authGroupIds(ctx.auth);
      if (!groups.length) return { entities: [], relationships: [] };
      const [entities, relationships] = await Promise.all([
        db.select().from(schema.intelligenceEntities).where(and(
          inArray(schema.intelligenceEntities.groupId, groups),
          ...(input?.projectId ? [eq(schema.intelligenceEntities.projectId, input.projectId)] : []),
        )).limit(input?.limit ?? 200),
        db.select().from(schema.entityRelationships).where(and(
          inArray(schema.entityRelationships.groupId, groups),
          ...(input?.projectId ? [eq(schema.entityRelationships.projectId, input.projectId)] : []),
        )).limit(input?.limit ?? 200),
      ]);
      return { entities, relationships };
    }),

  reviewQueue: authedProcedure
    .input(z.object({ projectId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(40) }).optional())
    .query(async ({ ctx, input }) => {
      await visibleProject(ctx.auth, input?.projectId);
      const groupIds = authGroupIds(ctx.auth);
      if (!groupIds.length) return { items: [], total: 0 };
      const visible = await listDataHubResources(ctx.auth, { projectId: input?.projectId, perKindLimit: 200 });
      const resourceMap = new Map(visible.resources.map((resource) => [`${resource.kind}:${resource.rawId}`, resource]));
      const rows = await db.select({
        id: schema.aiReviewItems.id,
        kind: schema.aiReviewItems.kind,
        prompt: schema.aiReviewItems.prompt,
        prediction: schema.aiReviewItems.prediction,
        confidence: schema.aiReviewItems.confidence,
        priority: schema.aiReviewItems.priority,
        createdAt: schema.aiReviewItems.createdAt,
        intelligenceId: schema.assetIntelligence.id,
        resourceKind: schema.assetIntelligence.resourceKind,
        resourceId: schema.assetIntelligence.resourceId,
        category: schema.assetIntelligence.category,
        summary: schema.assetIntelligence.summary,
      }).from(schema.aiReviewItems)
        .innerJoin(schema.assetIntelligence, eq(schema.assetIntelligence.id, schema.aiReviewItems.intelligenceId))
        .where(and(
          inArray(schema.aiReviewItems.groupId, groupIds),
          eq(schema.aiReviewItems.status, "pending"),
          ...(input?.projectId ? [eq(schema.aiReviewItems.projectId, input.projectId)] : []),
        ))
        .orderBy(desc(schema.aiReviewItems.priority), desc(schema.aiReviewItems.createdAt))
        .limit(input?.limit ?? 40);
      const items = rows.flatMap((row) => {
        const resource = resourceMap.get(`${row.resourceKind}:${row.resourceId}`);
        return resource ? [{ ...row, resource }] : [];
      });
      return { items, total: items.length };
    }),

  resolveReview: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      action: z.enum(["confirm", "reject", "change", "ignore"]),
      correction: z.object({
        category: z.string().trim().min(1).max(120).optional(),
        tags: z.array(z.string().trim().min(1).max(80)).max(40).optional(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await db.select().from(schema.aiReviewItems).where(eq(schema.aiReviewItems.id, input.id));
      if (!item || item.status !== "pending") throw new TRPCError({ code: "NOT_FOUND", message: "這項確認已處理或不存在" });
      requireGroup(ctx.auth, item.groupId);
      const project = await visibleProject(ctx.auth, item.projectId ?? undefined);
      if (project) await assertProjectEditable(ctx.auth, project);
      const [intel] = await db.select().from(schema.assetIntelligence)
        .where(eq(schema.assetIntelligence.id, item.intelligenceId));
      if (!intel) throw new TRPCError({ code: "NOT_FOUND", message: "來源資料已不存在" });

      const decision = resolveReviewDecision({ action: input.action, prediction: item.prediction, correction: input.correction });
      const resolution = decision.resolution;
      await db.transaction(async (tx) => {
        await tx.update(schema.aiReviewItems).set({
          status: decision.reviewStatus,
          resolvedBy: ctx.auth.user.id,
          resolution,
          resolvedAt: new Date(),
        }).where(eq(schema.aiReviewItems.id, item.id));
        if (input.action === "confirm" || input.action === "change") {
          const category = decision.category;
          const tags = decision.tags;
          await tx.update(schema.assetIntelligence).set({
            ...(category ? { category, categoryConfidence: 1 } : {}),
            ...(tags ? { dynamicTags: tags, tagConfidence: 1 } : {}),
            analysisStatus: "ready",
            updatedAt: new Date(),
          }).where(eq(schema.assetIntelligence.id, intel.id));
          await tx.update(schema.aiClassifications).set({
            status: decision.classificationStatus,
            updatedAt: new Date(),
          }).where(and(
            eq(schema.aiClassifications.intelligenceId, intel.id),
            eq(schema.aiClassifications.dimension, item.kind),
          ));
        } else if (input.action === "reject") {
          await tx.update(schema.aiClassifications).set({ status: "rejected", updatedAt: new Date() })
            .where(and(
              eq(schema.aiClassifications.intelligenceId, intel.id),
              eq(schema.aiClassifications.dimension, item.kind),
            ));
        }
        await tx.insert(schema.aiFeedbackEvents).values({
          groupId: item.groupId,
          projectId: item.projectId,
          intelligenceId: item.intelligenceId,
          reviewItemId: item.id,
          action: input.action,
          entityType: item.kind,
          prediction: item.prediction,
          confidence: item.confidence,
          userCorrection: resolution,
          modelVersion: intel.modelVersion,
          createdBy: ctx.auth.user.id,
        });
      });
      return { ok: true };
    }),

  reprocess: authedProcedure
    .input(z.object({
      resourceKind: z.enum(["asset", "knowledge", "document"]),
      resourceId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const visible = await listDataHubResources(ctx.auth, { kinds: [input.resourceKind], perKindLimit: 200 });
      const resource = visible.resources.find((candidate) => candidate.kind === input.resourceKind && candidate.rawId === input.resourceId);
      if (!resource || !resource.groupId) throw new TRPCError({ code: "NOT_FOUND", message: "找不到資料" });
      const project = await visibleProject(ctx.auth, resource.projectId ?? undefined);
      if (project) await assertProjectEditable(ctx.auth, project);
      const row = await registerIntelligenceResource({
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        groupId: resource.groupId,
        projectId: resource.projectId,
        sourceType: resource.source,
        createdBy: ctx.auth.user.id,
        force: true,
      });
      return { ok: true, intelligenceId: row.id };
    }),

  processing: authedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await visibleProject(ctx.auth, input?.projectId);
      const groups = authGroupIds(ctx.auth);
      if (!groups.length) return { active: 0, failed: 0, progress: 100, stages: [] };
      const rows = await db.select({
        stage: schema.intelligenceProcessingJobs.stage,
        status: schema.intelligenceProcessingJobs.status,
        count: sql<number>`count(*)::int`,
        progress: sql<number>`coalesce(avg(${schema.intelligenceProcessingJobs.progress}), 0)::int`,
      }).from(schema.intelligenceProcessingJobs)
        .innerJoin(schema.assetIntelligence, eq(schema.assetIntelligence.id, schema.intelligenceProcessingJobs.intelligenceId))
        .where(and(
          inArray(schema.assetIntelligence.groupId, groups),
          ...(input?.projectId ? [eq(schema.assetIntelligence.projectId, input.projectId)] : []),
        ))
        .groupBy(schema.intelligenceProcessingJobs.stage, schema.intelligenceProcessingJobs.status);
      const activeRows = rows.filter((row) => row.status === "queued" || row.status === "running");
      const active = activeRows.reduce((sum, row) => sum + Number(row.count), 0);
      const failed = rows.filter((row) => row.status === "failed").reduce((sum, row) => sum + Number(row.count), 0);
      const progress = activeRows.length
        ? Math.round(activeRows.reduce((sum, row) => sum + Number(row.progress) * Number(row.count), 0) / active)
        : 100;
      return { active, failed, progress, stages: activeRows };
    }),

  people: authedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      await visibleProject(ctx.auth, input?.projectId);
      const groups = authGroupIds(ctx.auth);
      if (!groups.length) return { people: [], clusters: [] };
      const [people, clusters] = await Promise.all([
        db.select().from(schema.people).where(and(
          inArray(schema.people.groupId, groups),
          ...(input?.projectId ? [eq(schema.people.projectId, input.projectId)] : []),
        )).orderBy(desc(schema.people.updatedAt)),
        db.select().from(schema.faceClusters).where(and(
          inArray(schema.faceClusters.groupId, groups),
          ...(input?.projectId ? [eq(schema.faceClusters.projectId, input.projectId)] : []),
        )).orderBy(desc(schema.faceClusters.faceCount)),
      ]);
      return { people, clusters };
    }),

  personDetail: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [person] = await db.select().from(schema.people).where(eq(schema.people.id, input.id));
      if (!person) throw new TRPCError({ code: "NOT_FOUND", message: "找不到人物" });
      requireGroup(ctx.auth, person.groupId);
      const [faces, mentions, clusters] = await Promise.all([
        db.select().from(schema.detectedFaces).where(eq(schema.detectedFaces.personId, person.id)),
        db.select().from(schema.entityRelationships).where(and(
          eq(schema.entityRelationships.toType, "person"),
          eq(schema.entityRelationships.toId, person.id),
        )),
        db.select().from(schema.faceClusters).where(eq(schema.faceClusters.personId, person.id)),
      ]);
      const intelligenceIds = [...new Set([
        ...faces.map((face) => face.intelligenceId),
        ...mentions.filter((edge) => edge.fromType === "asset_intelligence").map((edge) => edge.fromId),
      ])];
      const intelligenceRows = intelligenceIds.length ? await db.select().from(schema.assetIntelligence)
        .where(inArray(schema.assetIntelligence.id, intelligenceIds)) : [];
      const visible = await listDataHubResources(ctx.auth, { projectId: person.projectId ?? undefined, perKindLimit: 200 });
      const allowed = new Map(visible.resources.map((resource) => [`${resource.kind}:${resource.rawId}`, resource]));
      const appearances = intelligenceRows.flatMap((row) => {
        const resource = allowed.get(`${row.resourceKind}:${row.resourceId}`);
        return resource ? [{ resource, intelligence: row }] : [];
      });
      return {
        person,
        clusters,
        appearances,
        counts: {
          photos: appearances.filter((item) => item.intelligence.canonicalType === "IMAGE").length,
          videos: appearances.filter((item) => item.intelligence.canonicalType === "VIDEO").length,
          documents: appearances.filter((item) => ["DOCUMENT", "TEXT", "WEB"].includes(item.intelligence.canonicalType)).length,
          projects: new Set(appearances.map((item) => item.intelligence.projectId).filter(Boolean)).size,
          mentions: mentions.length,
        },
      };
    }),

  createPerson: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(120),
      representativeIntelligenceId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      const project = await visibleProject(ctx.auth, input.projectId);
      if (project) {
        if (project.groupId !== input.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "人物與專案必須屬於同一團隊" });
        await assertProjectEditable(ctx.auth, project);
      }
      const [person] = await db.insert(schema.people).values({
        groupId: input.groupId,
        projectId: input.projectId ?? null,
        name: input.name,
        representativeIntelligenceId: input.representativeIntelligenceId ?? null,
        createdBy: ctx.auth.user.id,
      }).returning();
      return person!;
    }),

  resolveFaceCluster: authedProcedure
    .input(z.object({
      clusterId: z.string().uuid(),
      action: z.enum(["link", "create", "ignore", "split"]),
      personId: z.string().uuid().optional(),
      name: z.string().trim().min(1).max(120).optional(),
      faceIds: z.array(z.string().uuid()).max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [cluster] = await db.select().from(schema.faceClusters).where(eq(schema.faceClusters.id, input.clusterId));
      if (!cluster) throw new TRPCError({ code: "NOT_FOUND", message: "找不到人物群組" });
      requireGroup(ctx.auth, cluster.groupId);
      const project = await visibleProject(ctx.auth, cluster.projectId ?? undefined);
      if (project) await assertProjectEditable(ctx.auth, project);
      if (input.action === "ignore") {
        await db.update(schema.faceClusters).set({ status: "ignored", updatedAt: new Date() }).where(eq(schema.faceClusters.id, cluster.id));
        return { ok: true, clusterId: cluster.id, personId: null };
      }
      if (input.action === "split") {
        const faceIds = input.faceIds ?? [];
        if (!faceIds.length) throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇要拆分的人臉" });
        const selected = await db.select().from(schema.detectedFaces).where(and(
          eq(schema.detectedFaces.clusterId, cluster.id),
          inArray(schema.detectedFaces.id, faceIds),
        ));
        if (!selected.length) throw new TRPCError({ code: "BAD_REQUEST", message: "沒有可拆分的人臉" });
        const [newCluster] = await db.insert(schema.faceClusters).values({
          groupId: cluster.groupId,
          projectId: cluster.projectId,
          label: `${cluster.label}－拆分`,
          representativeIntelligenceId: selected[0]!.intelligenceId,
          faceCount: selected.length,
          status: "unconfirmed",
        }).returning({ id: schema.faceClusters.id });
        await db.update(schema.detectedFaces).set({ clusterId: newCluster!.id, updatedAt: new Date() })
          .where(inArray(schema.detectedFaces.id, selected.map((face) => face.id)));
        for (const face of selected) {
          await db.update(schema.faceClusterMembers).set({ clusterId: newCluster!.id })
            .where(and(
              eq(schema.faceClusterMembers.clusterId, cluster.id),
              eq(schema.faceClusterMembers.intelligenceId, face.intelligenceId),
              eq(schema.faceClusterMembers.faceIndex, face.faceIndex),
            ));
        }
        await db.update(schema.faceClusters).set({
          faceCount: Math.max(0, cluster.faceCount - selected.length), updatedAt: new Date(),
        }).where(eq(schema.faceClusters.id, cluster.id));
        return { ok: true, clusterId: newCluster!.id, personId: null };
      }
      let personId = input.personId;
      if (input.action === "create") {
        if (!input.name) throw new TRPCError({ code: "BAD_REQUEST", message: "請輸入人物名稱" });
        const [person] = await db.insert(schema.people).values({
          groupId: cluster.groupId,
          projectId: cluster.projectId,
          name: input.name,
          representativeIntelligenceId: cluster.representativeIntelligenceId,
          createdBy: ctx.auth.user.id,
        }).returning({ id: schema.people.id });
        personId = person!.id;
      }
      if (!personId) throw new TRPCError({ code: "BAD_REQUEST", message: "請選擇人物" });
      const [person] = await db.select().from(schema.people).where(eq(schema.people.id, personId));
      if (!person || person.groupId !== cluster.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "人物不屬於這個團隊" });
      await db.transaction(async (tx) => {
        await tx.update(schema.faceClusters).set({ personId, status: "confirmed", updatedAt: new Date() }).where(eq(schema.faceClusters.id, cluster.id));
        await tx.update(schema.detectedFaces).set({ personId, status: "identified", updatedAt: new Date() }).where(eq(schema.detectedFaces.clusterId, cluster.id));
        const members = await tx.select({ intelligenceId: schema.faceClusterMembers.intelligenceId })
          .from(schema.faceClusterMembers).where(eq(schema.faceClusterMembers.clusterId, cluster.id));
        for (const member of members) {
          await tx.insert(schema.entityRelationships).values({
            groupId: cluster.groupId,
            projectId: cluster.projectId,
            fromType: "asset_intelligence",
            fromId: member.intelligenceId,
            relationType: "APPEARS_IN",
            toType: "person",
            toId: personId!,
            confidence: 1,
            source: "user",
            status: "confirmed",
          }).onConflictDoNothing();
        }
        await tx.insert(schema.aiFeedbackEvents).values({
          groupId: cluster.groupId,
          projectId: cluster.projectId,
          action: input.action,
          entityType: "person_cluster",
          prediction: { clusterId: cluster.id, label: cluster.label },
          userCorrection: { personId, name: person.name },
          createdBy: ctx.auth.user.id,
        });
      });
      return { ok: true, clusterId: cluster.id, personId };
    }),

  mergePeople: authedProcedure
    .input(z.object({ sourcePersonId: z.string().uuid(), targetPersonId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (input.sourcePersonId === input.targetPersonId) throw new TRPCError({ code: "BAD_REQUEST", message: "人物不可與自己合併" });
      const people = await db.select().from(schema.people).where(inArray(schema.people.id, [input.sourcePersonId, input.targetPersonId]));
      const source = people.find((person) => person.id === input.sourcePersonId);
      const target = people.find((person) => person.id === input.targetPersonId);
      if (!source || !target || source.groupId !== target.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "人物不存在或不屬於同一團隊" });
      requireGroup(ctx.auth, source.groupId);
      await db.transaction(async (tx) => {
        await tx.update(schema.faceClusters).set({ personId: target.id, updatedAt: new Date() }).where(eq(schema.faceClusters.personId, source.id));
        await tx.update(schema.detectedFaces).set({ personId: target.id, updatedAt: new Date() }).where(eq(schema.detectedFaces.personId, source.id));
        const sourceEdges = await tx.select().from(schema.entityRelationships).where(and(
          eq(schema.entityRelationships.toType, "person"), eq(schema.entityRelationships.toId, source.id),
        ));
        for (const edge of sourceEdges) {
          await tx.insert(schema.entityRelationships).values({
            groupId: edge.groupId, projectId: edge.projectId, fromType: edge.fromType, fromId: edge.fromId,
            relationType: edge.relationType, toType: "person", toId: target.id,
            confidence: edge.confidence, source: "user", status: "confirmed",
          }).onConflictDoNothing();
        }
        await tx.delete(schema.entityRelationships).where(and(
          eq(schema.entityRelationships.toType, "person"), eq(schema.entityRelationships.toId, source.id),
        ));
        await tx.update(schema.people).set({ status: "merged", metadata: { mergedInto: target.id }, updatedAt: new Date() }).where(eq(schema.people.id, source.id));
        await tx.insert(schema.aiFeedbackEvents).values({
          groupId: source.groupId, projectId: source.projectId, action: "merge",
          entityType: "person", prediction: { source: source.id }, userCorrection: { target: target.id },
          createdBy: ctx.auth.user.id,
        });
      });
      return { ok: true, personId: target.id };
    }),

  duplicateQueue: authedProcedure
    .input(z.object({ projectId: z.string().uuid().optional(), limit: z.number().int().min(1).max(100).default(30) }).optional())
    .query(async ({ ctx, input }) => {
      await visibleProject(ctx.auth, input?.projectId);
      const groups = authGroupIds(ctx.auth);
      if (!groups.length) return { groups: [] };
      const duplicateGroups = await db.select().from(schema.duplicateGroups).where(and(
        inArray(schema.duplicateGroups.groupId, groups), eq(schema.duplicateGroups.status, "pending"),
      )).orderBy(desc(schema.duplicateGroups.createdAt)).limit(input?.limit ?? 30);
      const groupIds = duplicateGroups.map((group) => group.id);
      const members = groupIds.length ? await db.select({
        id: schema.duplicateGroupMembers.id,
        duplicateGroupId: schema.duplicateGroupMembers.duplicateGroupId,
        intelligenceId: schema.duplicateGroupMembers.intelligenceId,
        similarity: schema.duplicateGroupMembers.similarity,
        createdAt: schema.duplicateGroupMembers.createdAt,
        projectId: schema.assetIntelligence.projectId,
        resourceKind: schema.assetIntelligence.resourceKind,
        resourceId: schema.assetIntelligence.resourceId,
        category: schema.assetIntelligence.category,
        summary: schema.assetIntelligence.summary,
      }).from(schema.duplicateGroupMembers)
        .innerJoin(schema.assetIntelligence, eq(schema.assetIntelligence.id, schema.duplicateGroupMembers.intelligenceId))
        .where(inArray(schema.duplicateGroupMembers.duplicateGroupId, groupIds)) : [];
      const scopedGroups = input?.projectId
        ? duplicateGroups.filter((group) => members.some((member) => member.duplicateGroupId === group.id && member.projectId === input.projectId))
        : duplicateGroups;
      return {
        groups: scopedGroups.map((group) => ({
          ...group,
          members: members.filter((member) => member.duplicateGroupId === group.id && (!input?.projectId || member.projectId === input.projectId)),
        })),
      };
    }),

  resolveDuplicate: authedProcedure
    .input(z.object({ id: z.string().uuid(), action: z.enum(["keep", "merge", "ignore"]), primaryIntelligenceId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const [group] = await db.select().from(schema.duplicateGroups).where(eq(schema.duplicateGroups.id, input.id));
      if (!group) throw new TRPCError({ code: "NOT_FOUND", message: "找不到重複群組" });
      requireGroup(ctx.auth, group.groupId);
      await db.update(schema.duplicateGroups).set({
        status: input.action === "ignore" ? "ignored" : input.action === "merge" ? "merged" : "resolved",
        primaryIntelligenceId: input.primaryIntelligenceId ?? group.primaryIntelligenceId,
        updatedAt: new Date(),
      }).where(eq(schema.duplicateGroups.id, group.id));
      await db.insert(schema.aiFeedbackEvents).values({
        groupId: group.groupId, action: input.action, entityType: "duplicate_group",
        prediction: { duplicateGroupId: group.id, method: group.method },
        userCorrection: { primaryIntelligenceId: input.primaryIntelligenceId ?? group.primaryIntelligenceId },
        createdBy: ctx.auth.user.id,
      });
      return { ok: true };
    }),
});
