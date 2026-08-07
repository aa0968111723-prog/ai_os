/**
 * Story Workspace（PE 計畫 §09）＋自動解析＋轉分鏡的 API。
 *
 * 設計原則：
 *  - 故事是專案的敘事來源（一專案一份），autosave 由 client debounce、server 端 upsert。
 *  - 版本沿用既有 text_versions 機制（kind='story'）：內容真的改變才快照（比照 knowledge）。
 *  - 解析／轉分鏡／Undo 的重活在 services/storyParse.ts；這裡只做守門與組回應。
 *  - ACL 全部走既有慣例：載專案 → requireGroup → 寫入再 assertProjectEditable（＋未封存）。
 */
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";
import {
  materializeStoryboard,
  runStoryParse,
  sha256Hex,
  undoParseRun,
} from "../services/storyParse";
import {
  environmentStateSchema,
  STORY_MAX_CHARS,
  STORY_SCENE_TITLE_MAX,
  type StoryParseSummary,
} from "../../shared/story";

async function getProjectChecked(ctx: { auth: NonNullable<Parameters<typeof requireGroup>[0]> }, projectId: string, forEdit: boolean) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND" });
  requireGroup(ctx.auth, project.groupId);
  if (forEdit) {
    await assertProjectEditable(ctx.auth, project);
    assertProjectNotArchived(project);
  }
  return project;
}

/** 內容真的改變才快照前一版（比照 knowledge.update）；標題固定給日期時間讓版本清單可讀 */
async function snapshotStory(story: typeof schema.stories.$inferSelect, userId: string) {
  if (!story.content.trim()) return; // 空內容不佔版本
  await db.insert(schema.textVersions).values({
    projectId: story.projectId,
    groupId: story.groupId,
    kind: "story",
    refId: story.id,
    title: null,
    content: story.content,
    createdBy: userId,
  });
}

export const storyRouter = router({
  /** 故事工作台一次拉齊：故事本文＋解析摘要 counts＋待確認候選＋最近一次 run */
  get: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = await getProjectChecked(ctx, input.projectId, false);
    const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));

    const [charN, locN, propN, lookN, storySceneN, shotN, pendingRows, flaggedRows, lastRuns] = await Promise.all([
      db.select({ n: sql<number>`count(*)` }).from(schema.characters).where(eq(schema.characters.projectId, project.id)),
      db.select({ n: sql<number>`count(*)` }).from(schema.scenePresets).where(eq(schema.scenePresets.projectId, project.id)),
      db.select({ n: sql<number>`count(*)` }).from(schema.props).where(eq(schema.props.projectId, project.id)),
      db.select({ n: sql<number>`count(*)` }).from(schema.characterLooks).where(eq(schema.characterLooks.projectId, project.id)),
      db.select({ n: sql<number>`count(*)` }).from(schema.storyScenes).where(eq(schema.storyScenes.projectId, project.id)),
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt))),
      db
        .select()
        .from(schema.parseCandidates)
        .where(and(eq(schema.parseCandidates.projectId, project.id), eq(schema.parseCandidates.status, "pending")))
        .orderBy(desc(schema.parseCandidates.confidence), asc(schema.parseCandidates.createdAt))
        .limit(20),
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.parseCandidates)
        .where(
          and(
            eq(schema.parseCandidates.projectId, project.id),
            eq(schema.parseCandidates.status, "applied"),
            sql`${schema.parseCandidates.confidence} < 0.9`,
          ),
        ),
      db
        .select({
          id: schema.parseRuns.id,
          status: schema.parseRuns.status,
          stats: schema.parseRuns.stats,
          applied: schema.parseRuns.applied,
          createdAt: schema.parseRuns.createdAt,
        })
        .from(schema.parseRuns)
        .where(eq(schema.parseRuns.projectId, project.id))
        .orderBy(desc(schema.parseRuns.createdAt))
        .limit(1),
    ]);

    const content = story?.content ?? "";
    const summary: StoryParseSummary = {
      characters: Number(charN[0]?.n ?? 0),
      locations: Number(locN[0]?.n ?? 0),
      props: Number(propN[0]?.n ?? 0),
      looks: Number(lookN[0]?.n ?? 0),
      storyScenes: Number(storySceneN[0]?.n ?? 0),
      shots: Number(shotN[0]?.n ?? 0),
      pending: pendingRows.length,
      flagged: Number(flaggedRows[0]?.n ?? 0),
    };
    const lastRun = lastRuns[0] ?? null;
    return {
      story: story
        ? {
            id: story.id,
            content,
            updatedAt: story.updatedAt,
            lastParsedAt: story.lastParsedAt,
            /** 內容改過但還沒重新解析（差異更新的觸發訊號） */
            isDirty: Boolean(content.trim()) && story.parsedContentHash !== sha256Hex(content.trim()),
          }
        : null,
      summary,
      pending: pendingRows.map((c) => ({
        id: c.id,
        kind: c.kind,
        name: c.name,
        payload: c.payload,
        confidence: c.confidence,
        sourceExcerpt: c.sourceExcerpt,
      })),
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            stats: lastRun.stats,
            hasStoryboard: Boolean(lastRun.applied?.storyboard),
            createdAt: lastRun.createdAt,
          }
        : null,
    };
  }),

  /** autosave：upsert 故事本文；內容真的改變才寫版本快照（比照 knowledge.update） */
  save: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        content: z.string().max(STORY_MAX_CHARS, `故事過長（上限 ${STORY_MAX_CHARS.toLocaleString()} 字）`),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectChecked(ctx, input.projectId, true);
      const [existing] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));
      if (!existing) {
        const [row] = await db
          .insert(schema.stories)
          .values({
            projectId: project.id,
            groupId: project.groupId,
            content: input.content,
            updatedBy: ctx.auth.user.id,
          })
          .returning();
        return { id: row.id, updatedAt: row.updatedAt, versioned: false };
      }
      if (existing.content === input.content) {
        return { id: existing.id, updatedAt: existing.updatedAt, versioned: false };
      }
      // 快照門檻：內容變動 ≥ 200 字元差（或首次超過門檻）才寫版本——autosave 每 800ms 一發，
      // 逐字快照會把版本表灌爆；200 字約一小段，回溯粒度足夠。
      const delta = Math.abs(existing.content.length - input.content.length);
      const versioned = delta >= 200 || (existing.content.trim().length > 0 && input.content.trim().length === 0);
      if (versioned) await snapshotStory(existing, ctx.auth.user.id);
      const [row] = await db
        .update(schema.stories)
        .set({ content: input.content, updatedBy: ctx.auth.user.id, updatedAt: new Date() })
        .where(eq(schema.stories.id, existing.id))
        .returning();
      return { id: row.id, updatedAt: row.updatedAt, versioned };
    }),

  /** 版本清單（story 版）：由新到舊，只回摘要不回全文（比照 knowledge.listVersions） */
  listVersions: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = await getProjectChecked(ctx, input.projectId, false);
    const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));
    if (!story) return [];
    return db
      .select({
        id: schema.textVersions.id,
        chars: sql<number>`length(${schema.textVersions.content})`.mapWith(Number),
        preview: sql<string>`left(${schema.textVersions.content}, 120)`,
        createdAt: schema.textVersions.createdAt,
      })
      .from(schema.textVersions)
      .where(and(eq(schema.textVersions.kind, "story"), eq(schema.textVersions.refId, story.id)))
      .orderBy(desc(schema.textVersions.createdAt))
      .limit(50);
  }),

  /** 還原版本：先把當前內容存一版（還原本身可反悔），再覆寫（比照 knowledge.restoreVersion） */
  restoreVersion: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectChecked(ctx, input.projectId, true);
      const [story] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, project.id));
      if (!story) throw new TRPCError({ code: "NOT_FOUND", message: "這個專案還沒有故事" });
      const [version] = await db
        .select()
        .from(schema.textVersions)
        .where(
          and(
            eq(schema.textVersions.id, input.versionId),
            eq(schema.textVersions.kind, "story"),
            eq(schema.textVersions.refId, story.id),
          ),
        );
      if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個版本" });
      await snapshotStory(story, ctx.auth.user.id);
      const [row] = await db
        .update(schema.stories)
        .set({ content: version.content, updatedBy: ctx.auth.user.id, updatedAt: new Date() })
        .where(eq(schema.stories.id, story.id))
        .returning();
      return { id: row.id, updatedAt: row.updatedAt };
    }),

  /** AI 自動解析（EXTRACT→…→SAVE）：同步呼叫（假模式即時、真模式最長 90 秒） */
  parse: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), force: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      return runStoryParse({
        userId: ctx.auth.user.id,
        projectId: input.projectId,
        force: input.force,
        assertAccess: async (project) => {
          requireGroup(ctx.auth, project.groupId);
          await assertProjectEditable(ctx.auth, project);
          assertProjectNotArchived(project);
        },
      });
    }),

  /** 確認卡：建立／併入既有／略過（PE 計畫 §06——使用者只處理 AI 真正不確定的事） */
  confirmCandidate: authedProcedure
    .input(
      z.object({
        candidateId: z.string().uuid(),
        action: z.enum(["create", "merge", "dismiss"]),
        /** merge 時必填：併入哪個既有實體 */
        targetId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [cand] = await db.select().from(schema.parseCandidates).where(eq(schema.parseCandidates.id, input.candidateId));
      if (!cand) throw new TRPCError({ code: "NOT_FOUND" });
      const project = await getProjectChecked(ctx, cand.projectId, true);
      if (cand.status !== "pending") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "這張確認卡已處理過" });
      }
      const payload = cand.payload ?? {};
      const resolvedBase = { resolvedAt: new Date(), resolvedBy: ctx.auth.user.id };

      if (input.action === "dismiss") {
        await db.update(schema.parseCandidates).set({ status: "dismissed", ...resolvedBase }).where(eq(schema.parseCandidates.id, cand.id));
        return { ok: true as const, entityId: null };
      }

      if (input.action === "merge") {
        if (!input.targetId) throw new TRPCError({ code: "BAD_REQUEST", message: "請選要併入哪一張既有卡" });
        // 目標必須是同專案、同類型的實體
        const table =
          cand.kind === "character" ? schema.characters : cand.kind === "location" ? schema.scenePresets : cand.kind === "prop" ? schema.props : null;
        if (!table) throw new TRPCError({ code: "BAD_REQUEST", message: "此類型不支援併入" });
        const [target] = await db.select().from(table).where(eq(table.id, input.targetId));
        if (!target || target.projectId !== project.id) throw new TRPCError({ code: "NOT_FOUND", message: "找不到併入目標" });
        await db
          .update(schema.parseCandidates)
          .set({ status: "merged", matchedEntityId: input.targetId, ...resolvedBase })
          .where(eq(schema.parseCandidates.id, cand.id));
        return { ok: true as const, entityId: input.targetId };
      }

      // create
      let entityId: string;
      if (cand.kind === "character") {
        const [row] = await db
          .insert(schema.characters)
          .values({
            projectId: project.id,
            groupId: project.groupId,
            name: cand.name,
            appearance: payload.appearance?.trim() || `${cand.name}（外觀待補）`,
            createdBy: ctx.auth.user.id,
          })
          .returning();
        entityId = row.id;
        // 帶服裝資訊的角色候選：確認建立時一併建 Look（Identity/Look 分層）
        if (payload.costume?.trim()) {
          await db.insert(schema.characterLooks).values({
            projectId: project.id,
            groupId: project.groupId,
            characterId: row.id,
            name: payload.costume.trim().slice(0, 40),
            costume: payload.costume.trim(),
            source: "parse",
            createdBy: ctx.auth.user.id,
          });
        }
      } else if (cand.kind === "location") {
        const [row] = await db
          .insert(schema.scenePresets)
          .values({
            projectId: project.id,
            groupId: project.groupId,
            name: cand.name,
            palette: payload.features?.trim() || `${cand.name}（特徵待補）`,
            lighting: payload.lighting?.trim() || null,
            createdBy: ctx.auth.user.id,
          })
          .returning();
        entityId = row.id;
      } else if (cand.kind === "prop") {
        const [row] = await db
          .insert(schema.props)
          .values({
            projectId: project.id,
            groupId: project.groupId,
            name: cand.name,
            appearance: payload.appearance?.trim() || `${cand.name}（外觀待補）`,
            createdBy: ctx.auth.user.id,
          })
          .returning();
        entityId = row.id;
      } else if (cand.kind === "look") {
        if (!payload.characterId) throw new TRPCError({ code: "BAD_REQUEST", message: "造型候選缺角色歸屬" });
        const [owner] = await db.select().from(schema.characters).where(eq(schema.characters.id, payload.characterId));
        if (!owner || owner.projectId !== project.id) throw new TRPCError({ code: "NOT_FOUND", message: "找不到造型所屬角色" });
        const [row] = await db
          .insert(schema.characterLooks)
          .values({
            projectId: project.id,
            groupId: project.groupId,
            characterId: owner.id,
            name: cand.name.slice(0, 40),
            costume: payload.costume?.trim() || cand.name,
            source: "parse",
            createdBy: ctx.auth.user.id,
          })
          .returning();
        entityId = row.id;
      } else {
        throw new TRPCError({ code: "BAD_REQUEST", message: "未知的候選類型" });
      }

      await db
        .update(schema.parseCandidates)
        .set({ status: "confirmed", matchedEntityId: entityId, ...resolvedBase })
        .where(eq(schema.parseCandidates.id, cand.id));
      return { ok: true as const, entityId };
    }),

  /** 轉分鏡前的預覽：計畫規模＋既有分鏡數（前端據此決定要不要提示「會附加在後面」） */
  storyboardPreview: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = await getProjectChecked(ctx, input.projectId, false);
    const [run] = await db
      .select({ id: schema.parseRuns.id, plan: schema.parseRuns.plan, applied: schema.parseRuns.applied, status: schema.parseRuns.status })
      .from(schema.parseRuns)
      .where(and(eq(schema.parseRuns.projectId, project.id), eq(schema.parseRuns.status, "done")))
      .orderBy(desc(schema.parseRuns.createdAt))
      .limit(1);
    const [{ n: existingShots }] = await db
      .select({ n: sql<number>`count(*)` })
      .from(schema.scenes)
      .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)));
    if (!run?.plan) return { ready: false as const, existingShots: Number(existingShots) };
    return {
      ready: true as const,
      runId: run.id,
      alreadyMaterialized: Boolean(run.applied?.storyboard),
      planScenes: run.plan.scenes.length,
      planShots: run.plan.scenes.reduce((s, sc) => s + sc.shots.length, 0),
      existingShots: Number(existingShots),
      scenes: run.plan.scenes.map((sc) => ({ title: sc.title, shots: sc.shots.length })),
    };
  }),

  /** 產生分鏡（materialize）：最近一次解析計畫 → story_scenes＋Shot；同 run 冪等 */
  generateStoryboard: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), runId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      return materializeStoryboard({
        userId: ctx.auth.user.id,
        projectId: input.projectId,
        runId: input.runId,
        assertAccess: async (project) => {
          requireGroup(ctx.auth, project.groupId);
          await assertProjectEditable(ctx.auth, project);
          assertProjectNotArchived(project);
        },
      });
    }),

  /** 撤銷一次解析（含它轉出的分鏡；Shot 進回收桶可再還原） */
  undoRun: authedProcedure.input(z.object({ runId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    return undoParseRun({
      userId: ctx.auth.user.id,
      runId: input.runId,
      assertAccess: async (project) => {
        requireGroup(ctx.auth, project.groupId);
        await assertProjectEditable(ctx.auth, project);
        assertProjectNotArchived(project);
      },
    });
  }),

  /**
   * 雙向影響（PE 計畫 §23）：改一張卡之前，先知道它牽動哪些鏡、哪些畫面會過時。
   *
   * 為什麼要有這支：紅傘改成黃傘，引用它的 8 個鏡與已經生成的 3 張畫面會**靜默**變成
   * 「描述與成品不一致」——使用者不會發現，直到成片才看出傘是紅的。這支把後果先講出來，
   * 讓「只改這一鏡／改整個專案」是使用者的決定，不是系統替他默默選了。
   *
   * 唯讀（不改任何資料、不自動重生成）——重生成永遠是使用者按的。
   */
  entityImpact: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        kind: z.enum(["character", "location", "prop", "look"]),
        entityId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = await getProjectChecked(ctx, input.projectId, false);
      const column =
        input.kind === "character"
          ? schema.scenes.characterIds
          : input.kind === "location"
            ? schema.scenes.scenePresetIds
            : input.kind === "prop"
              ? schema.scenes.propIds
              : schema.scenes.lookIds;

      // 引用這張卡的鏡（未軟刪）。轉分鏡時場的地點卡已寫進鏡的 scenePresetIds，
      // 所以這一個 jsonb 包含查詢就涵蓋「繼承自場」的情況，不必再 join story_scenes。
      const shots = await db
        .select({ id: schema.scenes.id, title: schema.scenes.title, assetId: schema.scenes.assetId })
        .from(schema.scenes)
        .where(
          and(
            eq(schema.scenes.projectId, project.id),
            isNull(schema.scenes.deletedAt),
            sql`${column} @> ${JSON.stringify([input.entityId])}::jsonb`,
          ),
        )
        .orderBy(asc(schema.scenes.orderIndex))
        .limit(200);

      const shotIds = shots.map((s) => s.id);
      const [doneGen] = shotIds.length
        ? await db
            .select({ n: sql<number>`count(*)` })
            .from(schema.generations)
            .where(and(inArray(schema.generations.sceneId, shotIds), eq(schema.generations.status, "done")))
        : [{ n: 0 }];

      return {
        shots: shots.length,
        /** 已經有落地畫面的鏡：這些是「改了卡但畫面還是舊的」看得見的部分 */
        shotsWithVisual: shots.filter((s) => s.assetId).length,
        /** 這些鏡累計完成過的生成數（含舊版本；重生成前的可追溯基準） */
        generations: Number(doneGen?.n ?? 0),
        /** 前幾鏡的標題，讓提示句具體（「影響：SHOT 02、SHOT 05…」） */
        sampleTitles: shots.slice(0, 5).map((s) => s.title),
      };
    }),

  /* ── 場（story_scenes）管理：分鏡中心的場標頭 ───────────── */

  scenesList: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = await getProjectChecked(ctx, input.projectId, false);
    return db
      .select()
      .from(schema.storyScenes)
      .where(eq(schema.storyScenes.projectId, project.id))
      .orderBy(asc(schema.storyScenes.orderIndex), asc(schema.storyScenes.createdAt));
  }),

  sceneUpdate: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        title: z.string().trim().min(1).max(STORY_SCENE_TITLE_MAX).optional(),
        summary: z.string().trim().max(300).nullable().optional(),
        locationId: z.string().uuid().nullable().optional(),
        environment: environmentStateSchema.nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.storyScenes).where(eq(schema.storyScenes.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      const project = await getProjectChecked(ctx, row.projectId, true);
      if (input.locationId) {
        const [loc] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, input.locationId));
        if (!loc || loc.projectId !== project.id) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個場景卡" });
      }
      const patch: Partial<typeof schema.storyScenes.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.summary !== undefined) patch.summary = input.summary;
      if (input.locationId !== undefined) patch.locationId = input.locationId;
      if (input.environment !== undefined) {
        patch.environment = input.environment && Object.values(input.environment).some((v) => v?.trim()) ? input.environment : null;
      }
      if (Object.keys(patch).length === 0) return row;
      patch.updatedAt = new Date();
      const [updated] = await db.update(schema.storyScenes).set(patch).where(eq(schema.storyScenes.id, input.id)).returning();
      return updated;
    }),

  /** 刪一場：底下的鏡解除歸屬（變「未分場」），不刪鏡（刪內容走各鏡自己的回收桶） */
  sceneRemove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.storyScenes).where(eq(schema.storyScenes.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    await getProjectChecked(ctx, row.projectId, true);
    await db.transaction(async (tx) => {
      await tx.update(schema.scenes).set({ storySceneId: null }).where(eq(schema.scenes.storySceneId, row.id));
      await tx.delete(schema.storyScenes).where(eq(schema.storyScenes.id, row.id));
    });
    return { ok: true };
  }),
});
