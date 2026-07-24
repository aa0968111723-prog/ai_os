import { z } from "zod";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { listVisibleTables } from "../services/databaseAcl";

/**
 * 知識族譜（知識地圖・心智圖）的聚合端點：把「專案、筆記、行程、專案知識庫、
 * 自訂資料庫、AI 代理執行」一次撈齊成一張圖的原料——前端不必開六條查詢各自輪詢。
 * - 組隔離：requireGroup 守門；每類資料都以 groupId 過濾。
 * - 資料庫沿用 databaseAcl.listVisibleTables（與資料庫頁／MCP 同一套 ACL），
 *   再收斂到「與這個組相關」的範圍：本組（group）、本組所屬團隊（team）、全站（global）、
 *   以及本人（personal）——別組的組庫不會漏進來。
 * - 只回摘要不回全文（知識用 SQL length 算字數），省流量也不外洩長文內容。
 */

/** 每類節點的筆數上限：地圖是「鳥瞰」不是清單，超過的由前端顯示 +N，避免超大組把 payload 撐爆 */
const LIMIT_NOTES = 200;
const LIMIT_SCHEDULE = 300;
const LIMIT_KNOWLEDGE = 300;
const LIMIT_AGENTS = 50;
export const LIMIT_DATABASES = 30;

/**
 * 從「此人可見」的資料庫中挑出「與這個組相關」的（純函式，供單元測試）：
 * 本組的組庫、本組所屬團隊的團隊庫、全站庫、本人的個人庫——別組／別團隊的不上這張圖。
 * 前置條件：輸入已經過 listVisibleTables 的 ACL（personal 只會是本人的），這裡只做組相關性收斂。
 */
export function pickMapDatabases<T extends { scope: string; groupId: string | null; teamId: string | null }>(
  tables: T[],
  groupId: string,
  teamId: string | null,
  limit: number = LIMIT_DATABASES,
): T[] {
  return tables
    .filter(
      (t) =>
        t.scope === "global" ||
        t.scope === "personal" ||
        (t.scope === "group" && t.groupId === groupId) ||
        (t.scope === "team" && teamId !== null && t.teamId === teamId),
    )
    .slice(0, limit);
}

export const knowledgeMapRouter = router({
  graph: authedProcedure.input(z.object({ groupId: z.string().uuid() })).query(async ({ ctx, input }) => {
    requireGroup(ctx.auth, input.groupId);
    const { groupId } = input;

    // 六路互不相依，並行撈（資料庫那路要先知道組所屬團隊，於路內先查 group 列）
    const [projects, notes, scheduleRows, knowledgeRows, agentRows, databases] = await Promise.all([
      db
        .select({
          id: schema.projects.id,
          title: schema.projects.title,
          status: schema.projects.status,
          updatedAt: schema.projects.updatedAt,
        })
        .from(schema.projects)
        .where(eq(schema.projects.groupId, groupId))
        .orderBy(desc(schema.projects.updatedAt)),
      db
        .select({
          id: schema.notes.id,
          projectId: schema.notes.projectId,
          title: schema.notes.title,
          createdBy: schema.notes.createdBy,
          mentions: schema.notes.mentions,
          updatedAt: schema.notes.updatedAt,
        })
        .from(schema.notes)
        .where(eq(schema.notes.groupId, groupId))
        .orderBy(desc(schema.notes.updatedAt))
        .limit(LIMIT_NOTES),
      db
        .select({
          id: schema.scheduleItems.id,
          projectId: schema.scheduleItems.projectId,
          title: schema.scheduleItems.title,
          startsAt: schema.scheduleItems.startsAt,
          createdBy: schema.scheduleItems.createdBy,
          mentions: schema.scheduleItems.mentions,
        })
        .from(schema.scheduleItems)
        .where(eq(schema.scheduleItems.groupId, groupId))
        .orderBy(desc(schema.scheduleItems.startsAt))
        .limit(LIMIT_SCHEDULE),
      db
        .select({
          id: schema.knowledge.id,
          projectId: schema.knowledge.projectId,
          kind: schema.knowledge.kind,
          title: schema.knowledge.title,
          chars: sql<number>`length(${schema.knowledge.content})`,
          createdBy: schema.knowledge.createdBy,
          createdAt: schema.knowledge.createdAt,
        })
        .from(schema.knowledge)
        // 回收桶裡的知識不上地圖（與清單／注入同一濾條）
        .where(and(eq(schema.knowledge.groupId, groupId), isNull(schema.knowledge.deletedAt)))
        .orderBy(desc(schema.knowledge.createdAt))
        .limit(LIMIT_KNOWLEDGE),
      db
        .select({
          id: schema.agentRuns.id,
          projectId: schema.agentRuns.projectId,
          goal: schema.agentRuns.goal,
          status: schema.agentRuns.status,
          estPoints: schema.agentRuns.estPoints,
          userId: schema.agentRuns.userId,
          updatedAt: schema.agentRuns.updatedAt,
        })
        .from(schema.agentRuns)
        // 已放棄（discarded）的計畫不上地圖——那是從未開始的草稿
        .where(and(eq(schema.agentRuns.groupId, groupId), ne(schema.agentRuns.status, "discarded")))
        .orderBy(desc(schema.agentRuns.updatedAt))
        .limit(LIMIT_AGENTS),
      (async () => {
        const [group] = await db.select({ teamId: schema.groups.teamId }).from(schema.groups).where(eq(schema.groups.id, groupId));
        const visible = await listVisibleTables(ctx.auth);
        return pickMapDatabases(visible, groupId, group?.teamId ?? null)
          .map((t) => ({
            id: t.id,
            scope: t.scope,
            name: t.name,
            rowCount: t.rowCount,
            agentAccess: t.agentAccess,
            createdBy: t.createdBy,
            updatedAt: t.updatedAt,
          }));
      })(),
    ]);

    return {
      projects,
      notes,
      schedule: scheduleRows,
      knowledge: knowledgeRows.map((k) => ({ ...k, chars: Number(k.chars) })),
      agents: agentRows,
      databases,
    };
  }),
});
