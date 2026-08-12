/**
 * Authoritative project inventory shared by the website list API and Agent context.
 *
 * Never read through Redis/cache: a cache miss must not become "0 projects".
 *
 * The historical #661/#662 failure was Agent counting a truncated or
 * differently-filtered set than `projects.list`. Both surfaces must use the
 * same archived filter and disclose any remaining truncation.
 */
import { and, asc, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db";

export const AGENT_PROJECT_CONTEXT_LIMIT = 100;
export const AGENT_HIDDEN_PROJECT_LIST_LIMIT = 20;

export interface GroupProjectInventory {
  activeCount: number;
  archivedCount: number;
  listedCount: number;
  truncated: boolean;
  hiddenCount: number;
  listed: Array<typeof schema.projects.$inferSelect>;
  hidden: Array<{
    id: string;
    title: string;
    kind: string;
    status: string;
    updatedAt: Date;
  }>;
  oldestCreated: { id: string; title: string; createdAt: Date } | null;
  leastRecentlyUpdated: { id: string; title: string; updatedAt: Date } | null;
}

export function visibleProjectsWhere(
  groupIds: readonly string[],
  options: { includeArchived?: boolean } = {},
): SQL | undefined {
  if (groupIds.length === 0) return sql`false`;
  return options.includeArchived
    ? inArray(schema.projects.groupId, [...groupIds])
    : and(inArray(schema.projects.groupId, [...groupIds]), ne(schema.projects.status, "archived"));
}

export async function loadGroupProjectInventory(groupId: string): Promise<GroupProjectInventory> {
  const [listed, activeRows, archivedRows, oldestRows, staleRows] = await Promise.all([
    db
      .select()
      .from(schema.projects)
      .where(and(eq(schema.projects.groupId, groupId), ne(schema.projects.status, "archived")))
      .orderBy(sql`case when ${schema.projects.status} = 'active' then 0 else 1 end`, desc(schema.projects.updatedAt))
      .limit(AGENT_PROJECT_CONTEXT_LIMIT),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.projects)
      .where(and(eq(schema.projects.groupId, groupId), ne(schema.projects.status, "archived"))),
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.projects)
      .where(and(eq(schema.projects.groupId, groupId), eq(schema.projects.status, "archived"))),
    db
      .select({ id: schema.projects.id, title: schema.projects.title, createdAt: schema.projects.createdAt })
      .from(schema.projects)
      .where(and(eq(schema.projects.groupId, groupId), ne(schema.projects.status, "archived")))
      .orderBy(asc(schema.projects.createdAt), asc(schema.projects.id))
      .limit(1),
    db
      .select({ id: schema.projects.id, title: schema.projects.title, updatedAt: schema.projects.updatedAt })
      .from(schema.projects)
      .where(and(eq(schema.projects.groupId, groupId), ne(schema.projects.status, "archived")))
      .orderBy(asc(schema.projects.updatedAt), asc(schema.projects.id))
      .limit(1),
  ]);
  const activeCount = Number(activeRows[0]?.n ?? 0);
  const archivedCount = Number(archivedRows[0]?.n ?? 0);
  const truncated = activeCount > listed.length;
  const hidden = truncated
    ? await db
        .select({
          id: schema.projects.id,
          title: schema.projects.title,
          kind: schema.projects.kind,
          status: schema.projects.status,
          updatedAt: schema.projects.updatedAt,
        })
        .from(schema.projects)
        .where(and(eq(schema.projects.groupId, groupId), ne(schema.projects.status, "archived")))
        .orderBy(sql`case when ${schema.projects.status} = 'active' then 0 else 1 end`, desc(schema.projects.updatedAt))
        .offset(AGENT_PROJECT_CONTEXT_LIMIT)
        .limit(AGENT_HIDDEN_PROJECT_LIST_LIMIT)
    : [];
  return {
    activeCount,
    archivedCount,
    listedCount: listed.length,
    truncated,
    hiddenCount: Math.max(0, activeCount - listed.length),
    listed,
    hidden,
    oldestCreated: oldestRows[0] ?? null,
    leastRecentlyUpdated: staleRows[0] ?? null,
  };
}

export function formatProjectInventoryTotals(inventory: GroupProjectInventory): string {
  const archive = inventory.archivedCount > 0
    ? `；另有 ${inventory.archivedCount} 個已封存（網站預設清單不含封存，不能算進「全部專案」）`
    : "";
  const trunc = inventory.truncated
    ? `；清單只展開 ${inventory.listedCount} 個進行中專案，不得宣稱已列出全部`
    : "";
  return `組總計：進行中專案 ${inventory.activeCount} 個${archive}${trunc}`;
}

export function formatProjectAgeHints(inventory: GroupProjectInventory): string[] {
  const lines: string[] = [];
  if (inventory.oldestCreated) {
    lines.push(`最早建立（createdAt）：「${inventory.oldestCreated.title}」——問「最舊／最早建立」以這筆為準，不是清單最後一列`);
  }
  if (inventory.leastRecentlyUpdated) {
    lines.push(`最久沒更新（updatedAt）：「${inventory.leastRecentlyUpdated.title}」——問「最久沒更新」以這筆為準`);
  }
  return lines;
}
