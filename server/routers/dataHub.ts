import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { listDataHubResources, listDataHubSources } from "../services/dataHub";
import { DATA_HUB_KINDS, DATA_HUB_SCOPES } from "../../shared/dataHub";

/**
 * 資料中心（Unified Data Hub）——**facade router**。
 *
 * 存在理由：使用者只需要理解「把資料放進來 → 給哪個專案用 → AI 可不可以用」。
 * 底層的知識庫／資料表／文件／素材四個 domain 繼續各自存在，這裡只把它們
 * 翻成同一份清單。
 *
 * ★ 這不是 God Router：
 *   - 只有查詢，沒有任何 mutation——加入資料一律走既有的
 *     knowledge.add / knowledge.importDriveFile / databases.import* / /api/upload。
 *   - 不複製 databaseCore／knowledge injection／asset ACL／integration token 邏輯，
 *     全部呼叫既有 service。
 *   - 既有 procedure 一個都沒改名（見 docs/data-hub-current-state-2026-08.md §16）。
 */

const kindsInput = z.array(z.enum(DATA_HUB_KINDS)).max(DATA_HUB_KINDS.length).optional();
const scopesInput = z.array(z.enum(DATA_HUB_SCOPES)).max(DATA_HUB_SCOPES.length).optional();

/**
 * 帶 projectId 時的守門：先確認這個人是該專案所屬組的成員。
 * service 層還會再套一次組隔離，但**入口就要擋**——不靠下游兜底。
 */
async function assertProjectVisible(auth: Parameters<typeof requireGroup>[0], projectId: string): Promise<void> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
}

export const dataHubRouter = router({
  /**
   * 首頁摘要：份數、AI 可使用份數、各類型分佈、已連接來源。
   * 只回「人話需要的數字」——不回 UUID、不回 raw schema 細節。
   */
  summary: authedProcedure
    .input(z.object({ projectId: z.string().uuid().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (input?.projectId) await assertProjectVisible(ctx.auth, input.projectId);
      const [list, sources] = await Promise.all([
        listDataHubResources(ctx.auth, { projectId: input?.projectId }),
        listDataHubSources(ctx.auth.user.id),
      ]);
      return {
        counts: list.counts,
        truncated: list.truncated,
        sources,
        /** 最近使用（依更新時間；資料中心首頁的「最近」區塊） */
        recent: list.resources.slice(0, 8),
      };
    }),

  /**
   * 統一清單／搜尋（同一支：`q` 有值就是搜尋）。
   *
   * ★ ACL：每個 domain 的 where 條件就是它的權限守門（見 services/dataHub 檔頭）。
   *   絕不存在「一次 select 全部再前端過濾」——標題本身就是敏感 metadata。
   */
  list: authedProcedure
    .input(
      z.object({
        q: z.string().trim().max(120).optional(),
        kinds: kindsInput,
        scopes: scopesInput,
        projectId: z.string().uuid().optional(),
        perKindLimit: z.number().int().min(1).max(200).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      if (input?.projectId) await assertProjectVisible(ctx.auth, input.projectId);
      return listDataHubResources(ctx.auth, input ?? {});
    }),

  /** 統一搜尋（語意同 list，但關鍵字必填——給搜尋框用，避免誤打成全量清單） */
  search: authedProcedure
    .input(
      z.object({
        q: z.string().trim().min(1).max(120),
        kinds: kindsInput,
        scopes: scopesInput,
        projectId: z.string().uuid().optional(),
        perKindLimit: z.number().int().min(1).max(200).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (input.projectId) await assertProjectVisible(ctx.auth, input.projectId);
      return listDataHubResources(ctx.auth, input);
    }),

  /**
   * 專案的資料（專案頁「專案依據」用）。
   * 與 list 的差別只在「一定帶專案上下文」——實作共用，不另寫一套聚合。
   */
  projectResources: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), q: z.string().trim().max(120).optional() }))
    .query(async ({ ctx, input }) => {
      await assertProjectVisible(ctx.auth, input.projectId);
      return listDataHubResources(ctx.auth, { projectId: input.projectId, q: input.q });
    }),

  /**
   * 已連接的來源。
   * ★ 不變量 I1：connected 只代表「你可以去自己的 Google／Notion 挑東西」，
   *   **不代表** AI 可以讀整顆雲端。UI 文案不得混淆這兩件事。
   */
  sources: authedProcedure.query(({ ctx }) => listDataHubSources(ctx.auth.user.id)),
});
