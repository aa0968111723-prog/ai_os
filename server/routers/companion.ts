/**
 * Companion 讀模型（手機原生 App 的 AI 夥伴）。
 *
 * ## 為什麼是新的 router，而不是再擴充 phone.ts
 *
 * `phone.ts` 服務的是**手機 Web 殼層**：它回答「這個專案做到哪、下一步按哪裡」，
 * 是一份給畫面看的專案投影。Companion 要的是另一個問題的答案：
 * **「使用者現在的處境是什麼，AI 需要知道哪些事才不用每次重講」**——
 * 專案名、上一張圖、上一個鏡頭、誰在等你、什麼壞了。
 *
 * 兩者資料重疊但**形狀與消費者都不同**：phone 的消費者是 React 元件，
 * companion.context 的消費者是助手的提示詞組裝。硬塞進同一支查詢的結果是
 * 手機 Web 每次進首頁都要多付一份它不會渲染的欄位。
 *
 * ## 這裡只讀，而且只讀既有的表
 *
 * 沒有 mutation。真正的寫入全部走既有 `globalAssistant.runSiteAction` /
 * `creativeContext` / `scenes` 等路徑，連 ACL 都不在這裡重寫一份
 *（任務書 §14：禁止為 App 另建一套後端）。
 *
 * ## 授權
 *
 * 與它濃縮的那些 procedure 同守衛：組級查詢 `requireGroup`，
 * 專案級先查專案再 `requireGroup(project.groupId)`。與 phone.ts 完全一致。
 */
import { z } from "zod";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { visibleProjectsWhere } from "../services/projectInventory";
import { inferPhoneStage } from "../../shared/phoneStages";

/** 首頁投影用的專案數；Companion 首頁最多三張卡，多抓只是浪費。 */
const DIGEST_PROJECT_LIMIT = 6;
/** 「剛完成、還沒被看過」的時間窗。站內沒有 per-user 已讀水位，用時間窗誠實近似。 */
const FRESH_RESULT_WINDOW_MS = 12 * 60 * 60 * 1000;
/** 上下文包裡各清單的長度上限——這份東西會進提示詞，不能無界。 */
const CONTEXT_RECENT_PROJECTS = 5;
const CONTEXT_RECENT_ASSETS = 6;
const CONTEXT_RECENT_GENERATIONS = 8;
const CONTEXT_CHARACTERS = 8;
const CONTEXT_TASKS = 8;

/** count(*) 經 node-postgres 回來是字串——一律 Number()（比照 phone.ts / generation.pendingSummary） */
const n = (v: unknown): number => Number(v ?? 0);

/** 生成狀態的分桶：三個地方都要用同一組定義，寫死一次。 */
const RUNNING_STATUSES = ["queued", "running"] as const;

export const companionRouter = router({
  /**
   * Companion 首頁投影：每個專案的「有沒有人在等你 / 有沒有東西壞了 / 有沒有東西在跑」。
   *
   * 與 `phone.home` 的差別是**多了 failed 與 freshResults**，因為 Companion 首頁的
   * 三張卡就是照這三個數字挑的（見 shared/companionDigest.ts 的優先序）。
   * 卡片的挑選與文案全部在 shared 的純函式裡，伺服器只給事實。
   */
  digest: authedProcedure
    .input(z.object({ groupId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      const rows = await db
        .select({
          id: schema.projects.id,
          title: schema.projects.title,
          status: schema.projects.status,
          updatedAt: schema.projects.updatedAt,
        })
        .from(schema.projects)
        .where(visibleProjectsWhere([input.groupId]))
        .orderBy(desc(schema.projects.updatedAt))
        .limit(DIGEST_PROJECT_LIMIT);

      if (rows.length === 0) return { projects: [], totals: emptyTotals() };
      const ids = rows.map((r) => r.id);
      const freshSince = new Date(Date.now() - FRESH_RESULT_WINDOW_MS);

      // 兩支 GROUP BY，而不是每案各打一次：專案數有上限，但請求數要是 O(1)。
      const [shotRows, genRows, storyRows] = await Promise.all([
        db
          .select({
            projectId: schema.scenes.projectId,
            shots: sql<number>`count(*)`,
            withVisual: sql<number>`count(${schema.scenes.assetId})`,
          })
          .from(schema.scenes)
          // 分鏡有回收桶：不濾掉的話刪過的鏡仍算進分母，而沒有人會發現是哪裡錯。
          .where(and(inArray(schema.scenes.projectId, ids), isNull(schema.scenes.deletedAt)))
          .groupBy(schema.scenes.projectId),
        db
          .select({
            projectId: schema.generations.projectId,
            awaiting: sql<number>`count(*) filter (where ${schema.generations.status} = 'awaiting_approval')`,
            running: sql<number>`count(*) filter (where ${schema.generations.status} in ('queued','running'))`,
            failed: sql<number>`count(*) filter (where ${schema.generations.status} = 'failed')`,
            done: sql<number>`count(*) filter (where ${schema.generations.status} = 'done')`,
            fresh: sql<number>`count(*) filter (where ${schema.generations.status} = 'done' and ${schema.generations.updatedAt} >= ${freshSince})`,
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
        return {
          id: r.id,
          title: r.title,
          stage: inferPhoneStage({
            hasStory: withStory.has(r.id),
            shots,
            shotsWithVisual,
            generationsDone: n(gen?.done),
            archived: r.status === "archived",
          }),
          shots,
          shotsWithVisual,
          awaitingGenerations: n(gen?.awaiting),
          runningGenerations: n(gen?.running),
          failedGenerations: n(gen?.failed),
          freshResults: n(gen?.fresh),
          updatedAt: r.updatedAt.toISOString(),
        };
      });

      return {
        projects,
        totals: {
          awaiting: sum(projects, (p) => p.awaitingGenerations),
          running: sum(projects, (p) => p.runningGenerations),
          failed: sum(projects, (p) => p.failedGenerations),
          fresh: sum(projects, (p) => p.freshResults),
        },
      };
    }),

  /**
   * Context Awareness 包（任務書 §6）。
   *
   * ## 這份東西是給誰看的
   *
   * 給**助手的提示詞組裝**看的，不是給畫面看的。所以每一項都要能回答
   * 「使用者說『這張』『上一鏡』『那個角色』時指的是什麼」——列表因此帶 id 與
   * 人看得懂的標籤，而不是整列資料。
   *
   * ## 為什麼帶 id 不危險
   *
   * 這些 id 只用來組深連結與**下一句話**。任何寫入仍由伺服器端重新
   * requireGroup／assertProjectAllows／CAS。這份包不授權任何事情，
   * 偽造它不會多出任何權限（與 lib/assistantContext 的不變式 2 同原則）。
   *
   * ## 為什麼有 projectId 就不用再猜
   *
   * 沒帶 projectId 時取「最近更新的可見專案」當 currentProject——那正是使用者
   * 心裡的「目前這個案子」。猜錯的成本是助手講到另一個專案，而使用者一眼看得出來
   * （Companion 的上下文膠囊會把專案名寫在輸入框上方）。
   */
  context: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);

      const recentProjects = await db
        .select({
          id: schema.projects.id,
          title: schema.projects.title,
          groupId: schema.projects.groupId,
          status: schema.projects.status,
          updatedAt: schema.projects.updatedAt,
        })
        .from(schema.projects)
        .where(visibleProjectsWhere([input.groupId]))
        .orderBy(desc(schema.projects.updatedAt))
        .limit(CONTEXT_RECENT_PROJECTS);

      const current = input.projectId
        ? recentProjects.find((p) => p.id === input.projectId) ?? await loadProjectChecked(input.projectId, input.groupId)
        : recentProjects[0];

      const base = {
        user: { id: ctx.auth.user.id, name: ctx.auth.user.name },
        workspace: { groupId: input.groupId },
        recentProjects: recentProjects.map((p) => ({
          id: p.id,
          title: p.title,
          updatedAt: p.updatedAt.toISOString(),
        })),
      };

      if (!current) {
        return {
          ...base,
          project: null,
          shots: [],
          focusShot: null,
          characters: [],
          recentAssets: [],
          recentGenerations: [],
          tasks: { pending: [], running: 0, failed: 0, awaiting: 0 },
        };
      }

      const projectId = current.id;
      const [shotRows, characterRows, assetRows, generationRows, taskRows, genCounts] = await Promise.all([
        db
          .select({
            id: schema.scenes.id,
            orderIndex: schema.scenes.orderIndex,
            title: schema.scenes.title,
            status: schema.scenes.status,
            assetId: schema.scenes.assetId,
          })
          .from(schema.scenes)
          .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt)))
          .orderBy(schema.scenes.orderIndex)
          .limit(300),
        db
          .select({ id: schema.characters.id, name: schema.characters.name, referenceAssetId: schema.characters.referenceAssetId })
          .from(schema.characters)
          .where(eq(schema.characters.projectId, projectId))
          .orderBy(desc(schema.characters.createdAt))
          .limit(CONTEXT_CHARACTERS),
        db
          .select({
            id: schema.assets.id,
            title: schema.assets.title,
            kind: schema.assets.kind,
            url: schema.assets.url,
            createdAt: schema.assets.createdAt,
          })
          .from(schema.assets)
          .where(and(eq(schema.assets.projectId, projectId), isNull(schema.assets.deletedAt)))
          .orderBy(desc(schema.assets.createdAt), desc(schema.assets.id))
          .limit(CONTEXT_RECENT_ASSETS),
        db
          .select({
            id: schema.generations.id,
            status: schema.generations.status,
            kind: schema.generations.kind,
            sceneId: schema.generations.sceneId,
            modelId: schema.generations.modelId,
            error: schema.generations.error,
            updatedAt: schema.generations.updatedAt,
          })
          .from(schema.generations)
          .where(eq(schema.generations.projectId, projectId))
          .orderBy(desc(schema.generations.updatedAt))
          .limit(CONTEXT_RECENT_GENERATIONS),
        db
          .select({
            id: schema.projectTasks.id,
            title: schema.projectTasks.title,
            status: schema.projectTasks.status,
            priority: schema.projectTasks.priority,
            taskType: schema.projectTasks.taskType,
          })
          .from(schema.projectTasks)
          .where(and(
            eq(schema.projectTasks.projectId, projectId),
            inArray(schema.projectTasks.status, ["todo", "doing", "waiting", "review"]),
          ))
          .orderBy(desc(schema.projectTasks.updatedAt))
          .limit(CONTEXT_TASKS),
        db
          .select({
            awaiting: sql<number>`count(*) filter (where ${schema.generations.status} = 'awaiting_approval')`,
            running: sql<number>`count(*) filter (where ${schema.generations.status} in ('queued','running'))`,
            failed: sql<number>`count(*) filter (where ${schema.generations.status} = 'failed')`,
          })
          .from(schema.generations)
          .where(eq(schema.generations.projectId, projectId)),
      ]);

      const shots = shotRows.map((s, index) => ({
        id: s.id,
        /** 使用者口中的「A07」＝第幾鏡。orderIndex 可能有洞，所以用排序後的序位。 */
        ordinal: index + 1,
        title: s.title,
        hasVisual: !!s.assetId,
        status: s.status,
      }));

      return {
        ...base,
        project: {
          id: current.id,
          title: current.title,
          groupId: current.groupId,
          status: current.status,
          updatedAt: current.updatedAt.toISOString(),
        },
        shots,
        /**
         * 「繼續下一幕」指的是哪一鏡：第一個還沒有畫面的。全部都有畫面時是最後一鏡
         * （那時使用者說的多半是「再改一下最後那個」）。
         */
        focusShot: shots.find((s) => !s.hasVisual) ?? shots[shots.length - 1] ?? null,
        characters: characterRows,
        recentAssets: assetRows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
        recentGenerations: generationRows.map((g) => ({
          id: g.id,
          status: g.status,
          kind: g.kind,
          sceneId: g.sceneId,
          modelId: g.modelId,
          // 失敗原因要帶，但不能帶整段 provider stack——那會把提示詞灌爆。
          error: g.error ? g.error.slice(0, 200) : null,
          updatedAt: g.updatedAt.toISOString(),
        })),
        tasks: {
          pending: taskRows,
          running: n(genCounts[0]?.running),
          failed: n(genCounts[0]?.failed),
          awaiting: n(genCounts[0]?.awaiting),
        },
      };
    }),
});

function emptyTotals() {
  return { awaiting: 0, running: 0, failed: 0, fresh: 0 };
}

function sum<T>(list: readonly T[], pick: (item: T) => number): number {
  return list.reduce((total, item) => total + pick(item), 0);
}

/**
 * 指名的專案不在「最近五筆」裡時單獨查一次。
 *
 * 這裡**不能**只用 projectId 查：那會讓帶著別組專案 id 的請求把該專案的
 * 分鏡與素材讀出來。要同時比對 groupId，且該 groupId 已在上面過了 requireGroup。
 */
async function loadProjectChecked(projectId: string, groupId: string) {
  const [project] = await db
    .select({
      id: schema.projects.id,
      title: schema.projects.title,
      groupId: schema.projects.groupId,
      status: schema.projects.status,
      updatedAt: schema.projects.updatedAt,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.groupId, groupId)));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  return project;
}

/** 供測試與其他讀模型引用，避免各處各寫一組狀態字面值。 */
export const COMPANION_RUNNING_STATUSES = RUNNING_STATUSES;
