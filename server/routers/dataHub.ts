import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { listDataHubResources, listDataHubSources } from "../services/dataHub";
import { listVisibleTables } from "../services/databaseAcl";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";
import {
  BINDABLE_RESOURCE_KINDS,
  bindableDenyReason,
  createBinding,
  listProjectBoundTableIds,
  removeBinding,
} from "../services/projectDataBindings";
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
  await loadProjectVisible(auth, projectId);
}

/** 同上，但把專案列回傳給需要它的呼叫端（綁定要用 groupId 與封存狀態） */
async function loadProjectVisible(auth: Parameters<typeof requireGroup>[0], projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  return project;
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

  /* ── 專案 × 資源綁定（P4）──────────────────────────────────────
   * Golden Path 3：資料已經在站內了，要給另一個專案用不該叫使用者「再從 Google 匯入一次」。
   * 這三支就是「加入既有資料」的後端。綁定不放寬任何權限，見 services/projectDataBindings。 */

  /**
   * 可以提供給這個專案的既有資料表（含已提供的，附 alreadyBound 旗標）。
   * 不可提供的（個人庫、別組的表）**不列出來**——不做一個按了會被擋的選項。
   */
  bindableResources: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const project = await loadProjectVisible(ctx.auth, input.projectId);
      const [tables, bound] = await Promise.all([
        listVisibleTables(ctx.auth),
        listProjectBoundTableIds(input.projectId),
      ]);
      return tables
        .filter((t) => bindableDenyReason(ctx.auth, t, project) === null)
        .map((t) => ({
          resourceKind: "table" as const,
          resourceId: t.id,
          title: t.name,
          description: t.description,
          scope: t.scope,
          rowCount: t.rowCount,
          agentAccess: (t.agentAccess as "none" | "read" | "write") ?? "write",
          alreadyBound: bound.has(t.id),
        }));
    }),

  /** 把整份資源提供給這個專案（冪等：重複按不會長出第二筆） */
  bindResource: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      resourceKind: z.enum(BINDABLE_RESOURCE_KINDS),
      resourceId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProjectVisible(ctx.auth, input.projectId);
      assertProjectNotArchived(project);
      // 專案側：檢視者不能改專案要用哪些資料
      await assertProjectEditable(ctx.auth, project);
      // 資源側：本人要看得到、且該範圍可以提供給這個專案（個人庫永遠不行）
      const [table] = await db
        .select()
        .from(schema.dataTables)
        .where(and(eq(schema.dataTables.id, input.resourceId), isNull(schema.dataTables.deletedAt)));
      // 無讀取權與不存在回同一句——不洩漏「存在但你看不到」
      if (!table) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這張資料表" });
      const denied = bindableDenyReason(ctx.auth, table, project);
      if (denied) {
        throw new TRPCError({
          code: denied.startsWith("找不到") ? "NOT_FOUND" : "FORBIDDEN",
          message: denied,
        });
      }
      const result = await createBinding({
        project,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        actorId: ctx.auth.user.id,
      });
      return { ok: true, created: result.created, title: table.name };
    }),

  /**
   * 不再提供給這個專案。
   * ★ 只移除「提供」這件事，資料本身完全不動——與「中斷來源不刪已匯入內容」同一條原則。
   * ★ 刻意**不**檢查專案是否已封存（bindResource 有檢查）：撤回存取權不該因為專案封存
   *   就被擋住——那會讓「封存的專案還在讀某張表」變成無法收回的狀態。
   */
  unbindResource: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      resourceKind: z.enum(BINDABLE_RESOURCE_KINDS),
      resourceId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProjectVisible(ctx.auth, input.projectId);
      await assertProjectEditable(ctx.auth, project);
      const result = await removeBinding({
        projectId: input.projectId,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
      });
      return { ok: true, removed: result.removed };
    }),
});
