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
import { applyWithRevisionTrpc } from "../services/revisionGuard";
import {
  loadExistingStoryScenes,
  loadOrphanShots,
  matchByName,
  materializeStoryboard,
  runStoryParse,
  sha256Hex,
  undoParseRun,
} from "../services/storyParse";
import { sanitizeCharacterProposalName } from "../../shared/assistantCharacterPropose";
import { checkProjectContinuity } from "../services/continuityCheck";
import { flushStoryDocNow } from "../services/collabDoc";
import {
  diffStoryboardPlan,
  planOrphanAdoption,
  planReuseOrphanAttach,
  summarizeStoryboardDiff,
  environmentStateSchema,
  STORY_MAX_CHARS,
  STORY_SCENE_TITLE_MAX,
  type StoryParseSummary,
} from "../../shared/story";
import { expandShotSuggestions, shotAssetSuggestionsBatchInputSchema } from "../../shared/shotAssetSuggestions";
import { loadShotAssetSuggestionsForProject } from "../services/shotAssetSuggestions";
import { publishToProject } from "../services/realtime";

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
            /** 樂觀併發版本（shared/revision.ts）：編輯器把它原樣回傳給 story.save */
            rev: story.rev,
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
        /**
         * 樂觀併發（shared/revision.ts）。故事是整份全文覆寫、autosave 每 800ms 送一次，
         * 是全站最容易靜默吃掉別人整段內容的地方——**編輯器一定要帶這個**。
         * 不給＝維持舊行為（匯入、解析回填等單寫路徑）。
         */
        expectedRev: z.number().int().min(0).optional(),
        /** 我開始編輯時的內文（用來判定「別人到底有沒有動過」）。 */
        baseline: z.string().optional(),
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
        return { id: row.id, rev: row.rev, updatedAt: row.updatedAt, versioned: false, merged: false };
      }
      if (existing.content === input.content) {
        return { id: existing.id, rev: existing.rev, updatedAt: existing.updatedAt, versioned: false, merged: false };
      }
      // 快照門檻：內容變動 ≥ 200 字元差（或首次超過門檻）才寫版本——autosave 每 800ms 一發，
      // 逐字快照會把版本表灌爆；200 字約一小段，回溯粒度足夠。
      const delta = Math.abs(existing.content.length - input.content.length);
      const versioned = delta >= 200 || (existing.content.trim().length > 0 && input.content.trim().length === 0);
      if (versioned) await snapshotStory(existing, ctx.auth.user.id);
      // 條件寫入。故事只有 content 一欄會撞，所以「可合併」在這裡等同於
      // 「別人根本沒動過內文」——真的兩人同時打字時一律走衝突路徑交給人決定，
      // 不做文字層的自動三方合併（那是 Yjs 的工作，猜錯會把兩段話絞在一起）。
      const { row, merged } = await applyWithRevisionTrpc({
        entity: "story",
        table: schema.stories,
        idColumn: schema.stories.id,
        revColumn: schema.stories.rev,
        row: existing,
        patch: { content: input.content },
        bookkeeping: { updatedBy: ctx.auth.user.id, updatedAt: new Date() },
        expectedRev: input.expectedRev,
        baseline: input.baseline === undefined ? null : { content: input.baseline },
        reload: async () => {
          const [fresh] = await db.select().from(schema.stories).where(eq(schema.stories.id, existing.id));
          return fresh;
        },
        updatedByField: "updatedBy",
        updatedAtField: "updatedAt",
      });
      return { id: row.id, rev: row.rev, updatedAt: row.updatedAt, versioned, merged };
    }),

  /**
   * 一鍵生成前強制把共編 Y.Doc 落到 stories.content。
   * 成功才回；失敗讓呼叫端中止，避免用舊伺服器文字去解析／生成。
   */
  flushCollab: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const project = await getProjectChecked(ctx, input.projectId, true);
      const flushed = await flushStoryDocNow(project.id);
      if (flushed.conflict) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "故事有衝突尚未處理，沒有用共編裡還沒存進去的字去解析",
        });
      }
      return flushed;
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
      const { row } = await applyWithRevisionTrpc({
        entity: "story",
        table: schema.stories,
        idColumn: schema.stories.id,
        revColumn: schema.stories.rev,
        row: story,
        patch: { content: version.content },
        bookkeeping: { updatedBy: ctx.auth.user.id, updatedAt: new Date() },
        expectedRev: story.rev,
        baseline: { content: story.content },
        reload: async () => {
          const [fresh] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
          return fresh;
        },
        updatedByField: "updatedBy",
        updatedAtField: "updatedAt",
      });
      return { id: row.id, rev: row.rev, updatedAt: row.updatedAt };
    }),

  /** AI 自動解析（EXTRACT→…→SAVE）：同步呼叫（假模式即時、真模式旗艦約 55s + 70B 約 55s，合計不超過約 120s） */
  parse: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), force: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await runStoryParse({
        userId: ctx.auth.user.id,
        projectId: input.projectId,
        force: input.force,
        assertAccess: async (project) => {
          requireGroup(ctx.auth, project.groupId);
          await assertProjectEditable(ctx.auth, project);
          assertProjectNotArchived(project);
        },
      });
      try {
        const { resolveStoryEntityBindings } = await import("../services/storyEntityBinding");
        await resolveStoryEntityBindings({
          auth: ctx.auth,
          projectId: input.projectId,
          persist: true,
        });
      } catch (error) {
        console.warn("[story.parse] entity binding skipped:", error instanceof Error ? error.message : error);
      }
      return result;
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
        const name = sanitizeCharacterProposalName(cand.name);
        if (!name) throw new TRPCError({ code: "BAD_REQUEST", message: "這是指示句，不是角色名" });
        const existing = await db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id));
        const matched = matchByName(existing, name);
        if (matched) {
          entityId = matched.id;
        } else {
          const [row] = await db
            .insert(schema.characters)
            .values({
              projectId: project.id,
              groupId: project.groupId,
              name,
              appearance: payload.appearance?.trim() || `${name}（外觀待補）`,
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

    // §22／§33 變更預覽：用與實際套用同一支純函式算逐場計畫，
    // 使用者按下前看到的數字就是待會真的會發生的事（不是另外估一份）。
    const existingScenes = await loadExistingStoryScenes(db, project.id);
    const diff = diffStoryboardPlan(
      run.plan.scenes.map((sc) => ({ title: sc.title, shots: sc.shots })),
      existingScenes,
    );
    const summary = summarizeStoryboardDiff(diff);
    const orphans = await loadOrphanShots(db, project.id);
    return {
      ready: true as const,
      runId: run.id,
      alreadyMaterialized: Boolean(run.applied?.storyboard),
      planScenes: run.plan.scenes.length,
      planShots: run.plan.scenes.reduce((s, sc) => s + sc.shots.length, 0),
      existingShots: Number(existingShots),
      orphanShots: orphans.length,
      adoption: run.applied?.storyboard
        ? planReuseOrphanAttach(Number(existingShots), orphans.length)
        : planOrphanAdoption(summary.newShots, orphans.length),
      scenes: run.plan.scenes.map((sc) => ({ title: sc.title, shots: sc.shots.length })),
      /** 逐場計畫：哪一場會新建、哪一場只補鏡、哪一場完全不動 */
      diff,
      summary,
    };
  }),

  /** 產生分鏡（materialize）：最近一次解析計畫 → story_scenes＋Shot；同 run 冪等 */
  generateStoryboard: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), runId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await materializeStoryboard({
        userId: ctx.auth.user.id,
        projectId: input.projectId,
        runId: input.runId,
        assertAccess: async (project) => {
          requireGroup(ctx.auth, project.groupId);
          await assertProjectEditable(ctx.auth, project);
          assertProjectNotArchived(project);
        },
      });
      try {
        // §6：先凍結每場戲的 Scene Package，Shot packet 才能繼承（順序刻意）
        const { freezeScenePackage } = await import("../services/scenePackages");
        for (const storySceneId of result.storySceneIds ?? []) {
          await freezeScenePackage({
            auth: ctx.auth,
            projectId: input.projectId,
            storySceneId,
          });
        }
        const { freezeShotContextPacket } = await import("../services/shotContextPackets");
        for (const shotId of result.sceneIds ?? []) {
          await freezeShotContextPacket({
            auth: ctx.auth,
            projectId: input.projectId,
            shotId,
          });
        }
      } catch (error) {
        console.warn("[story.generateStoryboard] packet freeze skipped:", error instanceof Error ? error.message : error);
      }
      // Same projectId as /p/ and /studio/:id. Without this, an open studio tab
      // keeps the cached empty list (refetchOnWindowFocus is false).
      const firstShotId = result.sceneIds?.[0] ?? null;
      publishToProject(input.projectId, { kind: "scene", id: firstShotId }, result.reused ? "分鏡已就緒" : "已產生分鏡");
      return result;
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

      // 已經對不上卡片的畫面（比對凍結快照；不自動重生成，只回報）
      const shotIdSet = new Set(shotIds);
      const outdated = shotIds.length
        ? (await checkProjectContinuity(project.id)).filter((s) => shotIdSet.has(s.shotId))
        : [];

      return {
        shots: shots.length,
        /** 已經有落地畫面的鏡：這些是「改了卡但畫面還是舊的」看得見的部分 */
        shotsWithVisual: shots.filter((s) => s.assetId).length,
        /** 這些鏡累計完成過的生成數（含舊版本；重生成前的可追溯基準） */
        generations: Number(doneGen?.n ?? 0),
        /** 前幾鏡的標題，讓提示句具體（「影響：SHOT 02、SHOT 05…」） */
        sampleTitles: shots.slice(0, 5).map((s) => s.title),
        /** 其中畫面已經與卡片對不上的鏡數（＝這次修改真正「已經造成落差」的部分） */
        outdatedShots: outdated.length,
      };
    }),

  /**
   * 這一鏡的相關素材（PE 計畫 §13／§26）：用這一鏡綁定的角色／場景／道具名字，
   * 去比對素材的標題與標籤。**不是語意檢索**，回傳也帶著命中的詞，
   * 讓 UI 能誠實地說「名稱或標籤對得上」而不是假裝「AI 已分析」（§60）。
   *
   * 單鏡相容入口；分鏡板請改走 shotAssetSuggestionsBatch，避免 N 卡 N 請求。
   */
  shotAssetSuggestions: authedProcedure
    .input(z.object({ sceneId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [shot] = await db
        .select({ id: schema.scenes.id, projectId: schema.scenes.projectId })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.sceneId), isNull(schema.scenes.deletedAt)));
      if (!shot) throw new TRPCError({ code: "NOT_FOUND" });
      const project = await getProjectChecked(ctx, shot.projectId, false);
      const batch = await loadShotAssetSuggestionsForProject({ projectId: project.id, shotIds: [shot.id] });
      const compact = batch.byShotId[shot.id] ?? { terms: [], items: [] };
      return { terms: compact.terms, items: expandShotSuggestions(batch, shot.id) };
    }),

  /**
   * 專案範圍一次讀完各鏡相關素材。輸入以 projectId 為主（一個小 GET），
   * 可選 shotIds 最多 80 個——禁止把 300 個 id 塞進 query string。
   * Server 端是固定少量 SQL，不是 N 次單鏡查詢的 Promise.all。
   */
  shotAssetSuggestionsBatch: authedProcedure
    .input(shotAssetSuggestionsBatchInputSchema)
    .query(async ({ ctx, input }) => {
      const project = await getProjectChecked(ctx, input.projectId, false);
      return loadShotAssetSuggestionsForProject({ projectId: project.id, shotIds: input.shotIds });
    }),

  /**
   * 連戲檢查（PE 計畫 P3 Continuity Checker 第一版）：全專案哪些鏡的畫面已經跟卡片對不上。
   * 唯讀——只回報，重生成由使用者逐鏡決定。
   */
  continuityCheck: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const project = await getProjectChecked(ctx, input.projectId, false);
    const stale = await checkProjectContinuity(project.id);
    return {
      outdated: stale.map((s) => ({ shotId: s.shotId, title: s.title, reason: s.reason })),
      total: stale.length,
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
        /** 樂觀併發（shared/revision.ts）：載入時的 rev；不給＝維持舊行為 */
        expectedRev: z.number().int().min(0).optional(),
        /** 載入時這些欄位的原值——rev 撞了但欄位沒撞時據此自動合併 */
        baseline: z.record(z.unknown()).optional(),
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
      // updatedAt 走 bookkeeping 而不是 patch：它每次都變，混進逐欄比對會讓
      // 這一列在第一次被改過之後，往後每一次儲存都跳假衝突。
      const { row: updated, merged } = await applyWithRevisionTrpc({
        entity: "storyScene",
        table: schema.storyScenes,
        idColumn: schema.storyScenes.id,
        revColumn: schema.storyScenes.rev,
        row,
        patch,
        bookkeeping: { updatedAt: new Date() },
        expectedRev: input.expectedRev,
        baseline: input.baseline,
        reload: async () => {
          const [fresh] = await db.select().from(schema.storyScenes).where(eq(schema.storyScenes.id, input.id));
          return fresh;
        },
      });
      return { ...updated, merged };
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
