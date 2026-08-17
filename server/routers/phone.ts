/**
 * Phone-only read model (<768px).
 *
 * ## Why a dedicated router instead of reusing the desktop queries
 *
 * The desktop first screen is allowed to be chatty: `Launchpad` alone fires
 * `auth.me`, `projects.list`, `generation.pendingSummary`, `teamAssistant.agentOverview`
 * and `options.byGroup`, and `ProjectPage` fires eleven more (two of them polling).
 * Each returns whole rows — `projects.list` ships every column of every project
 * including the full `worldview` JSON blob.
 *
 * On a phone the first screen only has to answer two questions — *which project
 * am I on* and *what is the next step* — so paying for five round trips of
 * mostly-unread columns is the wrong trade. These two queries answer exactly
 * that, in one request each, with counts computed in SQL instead of by shipping
 * rows to the client and calling `.length` on them.
 *
 * Desktop keeps using the existing procedures untouched: nothing here replaces
 * or modifies them, so >=768px behaviour is bit-for-bit unchanged.
 *
 * ## Authorisation
 *
 * Same guards as the procedures it condenses: `requireGroup` for the group-scoped
 * query, project lookup + `requireGroup(project.groupId)` for the project-scoped
 * one. This router reads only; it has no mutations.
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { visibleProjectsWhere } from "../services/projectInventory";
// 階段字彙與推導是前後端共用的單一出處（見 shared/phoneStages.ts 檔頭）
import { inferPhoneStage } from "../../shared/phoneStages";

/** 手機首屏最多列幾個專案——「最近／目前」是一個很短的清單，不是專案總表 */
const HOME_PROJECT_LIMIT = 5;
/** 專案頁「最近素材」縮圖數：一行三張、兩行放得下 */
const RECENT_ASSET_LIMIT = 6;

/** count(*) 經 node-postgres 回來是字串——一律 Number()（比照 generation.pendingSummary） */
const n = (v: unknown): number => Number(v ?? 0);

export const phoneRouter = router({
  /**
   * 手機首頁：最近專案 ＋ 每案的「做到哪裡」，一支查詢打完。
   *
   * 取代首頁原本的五支（auth.me／projects.list／pendingSummary／agentOverview／options）——
   * 首頁不需要選項清單，也不需要每個專案的完整 worldview。
   */
  home: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      /** 預設只給首屏那一小撮；使用者按「看全部專案」時才用大的（漸進式載入） */
      limit: z.number().int().min(1).max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      const limit = input.limit ?? HOME_PROJECT_LIMIT;
      const rows = await db
        .select({
          id: schema.projects.id,
          title: schema.projects.title,
          kind: schema.projects.kind,
          format: schema.projects.format,
          status: schema.projects.status,
          updatedAt: schema.projects.updatedAt,
          coverUrl: schema.assets.url,
        })
        .from(schema.projects)
        .leftJoin(
          schema.assets,
          and(eq(schema.assets.id, schema.projects.coverAssetId), isNull(schema.assets.deletedAt)),
        )
        .where(visibleProjectsWhere([input.groupId]))
        .orderBy(desc(schema.projects.updatedAt))
        .limit(limit);

      if (rows.length === 0) return { projects: [], totalAwaiting: 0 };
      const ids = rows.map((r) => r.id);

      // 三支彙總查詢（GROUP BY），而不是每案各打一次：專案數固定 ≤5，但請求數要是 O(1)。
      const [shotRows, genRows, storyRows] = await Promise.all([
        db
          .select({
            projectId: schema.scenes.projectId,
            shots: sql<number>`count(*)`,
            withVisual: sql<number>`count(${schema.scenes.assetId})`,
          })
          .from(schema.scenes)
          // 分鏡有回收桶（scenes.deletedAt）：不濾掉的話，使用者刪掉的鏡仍算進
          // 「8 鏡」，畫面上的分母永遠比專案頁看到的多，而且不會有人發現是哪裡錯。
          .where(and(inArray(schema.scenes.projectId, ids), isNull(schema.scenes.deletedAt)))
          .groupBy(schema.scenes.projectId),
        db
          .select({
            projectId: schema.generations.projectId,
            awaiting: sql<number>`count(*) filter (where ${schema.generations.status} = 'awaiting_approval')`,
            done: sql<number>`count(*) filter (where ${schema.generations.status} = 'done')`,
          })
          .from(schema.generations)
          .where(inArray(schema.generations.projectId, ids))
          .groupBy(schema.generations.projectId),
        db
          .select({ projectId: schema.stories.projectId })
          .from(schema.stories)
          .where(and(inArray(schema.stories.projectId, ids), ne(schema.stories.content, ""))),
      ]);

      const shotsBy = new Map(shotRows.map((r) => [r.projectId, r]));
      const genBy = new Map(genRows.map((r) => [r.projectId, r]));
      const withStory = new Set(storyRows.map((r) => r.projectId));

      const projects = rows.map((r) => {
        const shot = shotsBy.get(r.id);
        const gen = genBy.get(r.id);
        const shots = n(shot?.shots);
        const shotsWithVisual = n(shot?.withVisual);
        const generationsDone = n(gen?.done);
        return {
          id: r.id,
          title: r.title,
          kind: r.kind,
          format: r.format,
          status: r.status,
          updatedAt: r.updatedAt,
          coverUrl: r.coverUrl ?? null,
          shots,
          shotsWithVisual,
          awaitingGenerations: n(gen?.awaiting),
          stage: inferPhoneStage({
            hasStory: withStory.has(r.id),
            shots,
            shotsWithVisual,
            generationsDone,
            archived: r.status === "archived",
          }),
        };
      });

      return {
        projects,
        totalAwaiting: projects.reduce((sum, p) => sum + p.awaitingGenerations, 0),
      };
    }),

  /**
   * 手機專案頁首屏：專案名、進度、最近素材。
   *
   * 桌面 ProjectPage 掛載時打十一支（其中 assets 與 messages.unread 還在輪詢）。
   * 手機第一屏不需要角色、場景卡、道具、知識庫、選項——那些改成點進去才載。
   */
  project: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [project] = await db
        .select({
          id: schema.projects.id,
          groupId: schema.projects.groupId,
          title: schema.projects.title,
          kind: schema.projects.kind,
          format: schema.projects.format,
          status: schema.projects.status,
          updatedAt: schema.projects.updatedAt,
        })
        .from(schema.projects)
        .where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);

      const [[shot], [gen], [story], [assetCount], recentAssets] = await Promise.all([
        db
          .select({
            shots: sql<number>`count(*)`,
            withVisual: sql<number>`count(${schema.scenes.assetId})`,
            withNarration: sql<number>`count(${schema.scenes.narrationAssetId})`,
          })
          .from(schema.scenes)
          .where(and(eq(schema.scenes.projectId, input.projectId), isNull(schema.scenes.deletedAt))),
        db
          .select({
            awaiting: sql<number>`count(*) filter (where ${schema.generations.status} = 'awaiting_approval')`,
            running: sql<number>`count(*) filter (where ${schema.generations.status} in ('queued','running'))`,
            done: sql<number>`count(*) filter (where ${schema.generations.status} = 'done')`,
          })
          .from(schema.generations)
          .where(eq(schema.generations.projectId, input.projectId)),
        db
          .select({ length: sql<number>`length(${schema.stories.content})` })
          .from(schema.stories)
          .where(eq(schema.stories.projectId, input.projectId)),
        db
          .select({ total: sql<number>`count(*)` })
          .from(schema.assets)
          .where(and(eq(schema.assets.projectId, input.projectId), isNull(schema.assets.deletedAt))),
        // 縮圖牆只要能顯示的圖片素材，且只取六張——首屏不下載整個素材庫
        db
          .select({
            id: schema.assets.id,
            title: schema.assets.title,
            url: schema.assets.url,
            kind: schema.assets.kind,
            createdAt: schema.assets.createdAt,
          })
          .from(schema.assets)
          // kind = image only：這幾筆直接餵進手機專案頁的 <img> 縮圖牆，
          // 混進音檔／影片會變成一格永遠載不出來的破圖。
          // （原本還加了 isNotNull(url)，但 url 是 NOT NULL 欄位，那條件永遠為真。）
          .where(and(
            eq(schema.assets.projectId, input.projectId),
            isNull(schema.assets.deletedAt),
            eq(schema.assets.kind, "image"),
          ))
          .orderBy(desc(schema.assets.createdAt), desc(schema.assets.id))
          .limit(RECENT_ASSET_LIMIT),
      ]);

      const shots = n(shot?.shots);
      const shotsWithVisual = n(shot?.withVisual);
      const generationsDone = n(gen?.done);
      return {
        project: {
          id: project.id,
          groupId: project.groupId,
          title: project.title,
          kind: project.kind,
          format: project.format,
          status: project.status,
          updatedAt: project.updatedAt,
        },
        progress: {
          shots,
          shotsWithVisual,
          shotsWithNarration: n(shot?.withNarration),
          storyChars: n(story?.length),
          assets: n(assetCount?.total),
          awaitingGenerations: n(gen?.awaiting),
          runningGenerations: n(gen?.running),
          generationsDone,
        },
        stage: inferPhoneStage({
          hasStory: n(story?.length) > 0,
          shots,
          shotsWithVisual,
          generationsDone,
          archived: project.status === "archived",
        }),
        recentAssets,
      };
    }),
});
