import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedProcedure, requireGroup, router } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";
import {
  confirmContextBinding,
  contextBindableDenyReason,
  listVisibleContextBindings,
  removeContextBinding,
  resolveContextScope,
  setPrimaryContextBinding,
  upsertContextBinding,
} from "../services/contextBindings";
import {
  countPendingContextSuggestions,
  resolveContext,
  suggestProjectContext,
} from "../services/contextResolver";
import {
  CONTEXT_INTENTS,
  CONTEXT_PRIORITIES,
  CONTEXT_ROLES,
  CONTEXT_SCOPE_TYPES,
  resolveContextInheritance,
} from "../../shared/projectContext";
import { DATA_HUB_KINDS } from "../../shared/dataHub";

/**
 * 專案資料 / 專案脈絡 router。
 *
 * 使用者的心智模型只有一句話：「這個專案要用哪些資料，各自扮演什麼角色。」
 * 所以入口只有一個，不必再到知識庫／素材庫／資料表／資料中心四個地方各找一次。
 *
 * ★ 這裡不重寫任何 ACL：
 *   - 專案側走 `requireGroup` + `assertProjectEditable`
 *   - 資源側走 `contextBindableDenyReason`（內部呼叫 databaseAcl / 組隔離）
 *   - 讀取一律走 `listVisibleContextBindings`（先解可見清單，再與 binding 取交集）
 */

const resourceKindSchema = z.enum(DATA_HUB_KINDS);

async function loadProject(auth: Parameters<typeof requireGroup>[0], projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  return project;
}

async function loadBindingForActor(auth: Parameters<typeof requireGroup>[0], bindingId: string) {
  const [binding] = await db.select().from(schema.contextBindings)
    .where(eq(schema.contextBindings.id, bindingId));
  if (!binding) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆專案資料" });
  const project = await loadProject(auth, binding.projectId);
  await assertProjectEditable(auth, project);
  return { binding, project };
}

export const projectContextRouter = router({
  /**
   * 專案／場景／分鏡目前用了哪些資料（含繼承後的實際生效清單）。
   * 三個 scope 一支 procedure——不做三套幾乎一樣的 API。
   */
  list: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      sceneId: z.string().uuid().optional(),
      shotId: z.string().uuid().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await loadProject(ctx.auth, input.projectId);
      const bindings = await listVisibleContextBindings({
        auth: ctx.auth,
        projectId: input.projectId,
        sceneId: input.sceneId ?? null,
        shotId: input.shotId ?? null,
      });
      const resolved = resolveContextInheritance(bindings);
      return {
        bindings,
        /** 繼承後實際生效的（Shot > Scene > Project）；`fromScope` 讓 UI 能顯示「繼承自場景」 */
        effective: resolved.map((entry) => ({
          bindingId: entry.binding.id,
          role: entry.binding.role,
          priority: entry.binding.priority,
          effectiveSource: entry.effectiveSource,
          fromScope: entry.fromScope,
          resource: entry.binding.resource,
          confirmedByUser: entry.binding.confirmedByUser,
        })),
        suggestionCount: await countPendingContextSuggestions(input.projectId),
      };
    }),

  /** 加入資料到專案／場景／分鏡的脈絡。**不複製原始檔案**——只建立引用。 */
  add: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      scopeType: z.enum(CONTEXT_SCOPE_TYPES).default("project"),
      scopeId: z.string().uuid().optional(),
      resourceKind: resourceKindSchema,
      resourceId: z.string().uuid(),
      role: z.enum(CONTEXT_ROLES),
      priority: z.enum(CONTEXT_PRIORITIES).default("SECONDARY"),
      note: z.string().trim().max(400).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx.auth, input.projectId);
      assertProjectNotArchived(project);
      await assertProjectEditable(ctx.auth, project);
      const denied = await contextBindableDenyReason(ctx.auth, {
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        project,
      });
      if (denied) {
        throw new TRPCError({ code: denied.startsWith("找不到") ? "NOT_FOUND" : "FORBIDDEN", message: denied });
      }
      const scope = await resolveContextScope({ project, scopeType: input.scopeType, scopeId: input.scopeId });
      const binding = await upsertContextBinding({
        auth: ctx.auth,
        scope,
        resourceKind: input.resourceKind,
        resourceId: input.resourceId,
        role: input.role,
        priority: input.priority,
        note: input.note ?? null,
        // 使用者親自加入的一律是 USER_CONFIRMED
        confirmedByUser: true,
      });
      // 同一份 Library 資料被多個專案使用：加的是引用，不是複製
      if (binding.libraryResourceId) {
        const { recordLibraryUsage } = await import("../services/libraryResources");
        await recordLibraryUsage({
          libraryResourceId: binding.libraryResourceId,
          projectId: project.id,
          groupId: project.groupId,
          actorId: ctx.auth.user.id,
        });
      }
      return { ok: true, bindingId: binding.id };
    }),

  /** 移除本鏡／本場／本專案的 override。只移除引用，資料本身完全不動。 */
  remove: authedProcedure
    .input(z.object({ bindingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { binding } = await loadBindingForActor(ctx.auth, input.bindingId);
      const removed = await removeContextBinding(binding.id);
      return { ok: true, removed };
    }),

  /** 更換主要參考：同 scope 同角色只有一份 PRIMARY。 */
  setPrimary: authedProcedure
    .input(z.object({ bindingId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { binding } = await loadBindingForActor(ctx.auth, input.bindingId);
      await setPrimaryContextBinding(binding);
      return { ok: true };
    }),

  /**
   * 確認一筆 AI 建議。
   * ★ 這是 AI_SUGGESTED → USER_CONFIRMED 的**唯一**一條路（§36）。
   */
  confirmSuggestion: authedProcedure
    .input(z.object({ bindingId: z.string().uuid(), priority: z.enum(CONTEXT_PRIORITIES).optional() }))
    .mutation(async ({ ctx, input }) => {
      const { binding } = await loadBindingForActor(ctx.auth, input.bindingId);
      const row = await confirmContextBinding({ bindingId: binding.id, priority: input.priority });
      return { ok: true, binding: row };
    }),

  /**
   * AI 找可能相關的 Library 資料（不落庫，只回建議）。
   * 使用者按「全部加入」或逐項確認時才會寫進 context_bindings。
   */
  suggestions: authedProcedure
    .input(z.object({ projectId: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }))
    .query(async ({ ctx, input }) => {
      await loadProject(ctx.auth, input.projectId);
      return suggestProjectContext({ auth: ctx.auth, projectId: input.projectId, limit: input.limit });
    }),

  /**
   * 一次接受多筆 AI 建議。
   * 使用者按下「全部加入」＝這是他的決定，所以寫入時就是 USER_CONFIRMED；
   * 沒按的永遠不會自己升級。
   */
  acceptSuggestions: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      scopeType: z.enum(CONTEXT_SCOPE_TYPES).default("project"),
      scopeId: z.string().uuid().optional(),
      items: z.array(z.object({
        resourceKind: resourceKindSchema,
        resourceId: z.string().uuid(),
        role: z.enum(CONTEXT_ROLES),
        priority: z.enum(CONTEXT_PRIORITIES).default("SECONDARY"),
      })).min(1).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadProject(ctx.auth, input.projectId);
      assertProjectNotArchived(project);
      await assertProjectEditable(ctx.auth, project);
      const scope = await resolveContextScope({ project, scopeType: input.scopeType, scopeId: input.scopeId });
      let added = 0;
      const skipped: Array<{ resourceId: string; reason: string }> = [];
      for (const item of input.items) {
        const denied = await contextBindableDenyReason(ctx.auth, {
          resourceKind: item.resourceKind,
          resourceId: item.resourceId,
          project,
        });
        if (denied) { skipped.push({ resourceId: item.resourceId, reason: denied }); continue; }
        await upsertContextBinding({
          auth: ctx.auth,
          scope,
          resourceKind: item.resourceKind,
          resourceId: item.resourceId,
          role: item.role,
          priority: item.priority,
          confirmedByUser: true,
        });
        added += 1;
      }
      return { ok: true, added, skipped };
    }),

  /**
   * Context Resolver 的對外檢視（除錯、Source Trace UI、以及「這張圖為什麼長這樣」）。
   * 這支**不呼叫任何模型**，只回「如果現在生成，會用到哪些資料」。
   */
  resolve: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      sceneId: z.string().uuid().optional(),
      shotId: z.string().uuid().optional(),
      intent: z.enum(CONTEXT_INTENTS).default("assistant"),
      query: z.string().trim().max(1_000).optional(),
      budgetChars: z.number().int().min(1_000).max(40_000).optional(),
      onlyBindingIds: z.array(z.string().uuid()).max(100).optional(),
    }))
    .query(async ({ ctx, input }) => {
      await loadProject(ctx.auth, input.projectId);
      return resolveContext({
        auth: ctx.auth,
        projectId: input.projectId,
        sceneId: input.sceneId ?? null,
        shotId: input.shotId ?? null,
        intent: input.intent,
        query: input.query ?? null,
        budgetChars: input.budgetChars,
        onlyBindingIds: input.onlyBindingIds,
      });
    }),
});
