/**
 * 自訂資料庫的權限解析（權限系統接點）：完全建立在既有組織模型（AuthState）上，
 * 不另設角色——「個人→組→團隊→全站」四層範圍對應現有的 user / group / team / 開發者。
 *
 * 權限矩陣（單一真相來源，tRPC 與 MCP 都走這裡）：
 *   personal：僅擁有者本人（讀/寫/管理）。開發者也看不到——個人庫是私人空間。
 *   group   ：組成員可讀；寫列＝memberWritable 或 組長以上；管理＝組長以上或建立者。
 *   team    ：團隊成員（該團隊任一組的成員＋團隊管理員）可讀；寫列＝memberWritable 或 團隊管理員；
 *             管理＝團隊管理員（含開發者）或建立者。
 *   global  ：全站登入者可讀；寫列＝memberWritable 或 開發者；管理＝開發者（建立也限開發者）。
 */
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";

export type DataTableRow = typeof schema.dataTables.$inferSelect;

export interface DbAccess {
  canRead: boolean;
  /** 可新增/編輯列資料（刪列另需「列建立者或管理者」） */
  canWriteRows: boolean;
  /** 可改欄位結構、改名、刪庫 */
  canManage: boolean;
}

const NONE: DbAccess = { canRead: false, canWriteRows: false, canManage: false };

/** 使用者所屬團隊 id 集合（成員身分＋管理身分；開發者在 loadAuthState 已展開全部） */
function memberTeamIds(auth: AuthState): Set<string> {
  const ids = new Set<string>(auth.adminTeamIds);
  for (const g of auth.groups) ids.add(g.teamId);
  return ids;
}

export function resolveTableAccess(auth: AuthState, table: Pick<DataTableRow, "scope" | "ownerId" | "groupId" | "teamId" | "memberWritable" | "createdBy">): DbAccess {
  const isCreator = table.createdBy === auth.user.id;
  switch (table.scope) {
    case "personal": {
      const own = table.ownerId === auth.user.id;
      return own ? { canRead: true, canWriteRows: true, canManage: true } : NONE;
    }
    case "group": {
      const membership = auth.groups.find((g) => g.groupId === table.groupId);
      if (!membership) return NONE;
      const isManagerRole = membership.role !== "member";
      return {
        canRead: true,
        canWriteRows: table.memberWritable || isManagerRole || isCreator,
        canManage: isManagerRole || isCreator,
      };
    }
    case "team": {
      if (!table.teamId || !memberTeamIds(auth).has(table.teamId)) return NONE;
      const isTeamAdmin = auth.user.isSuperAdmin || auth.adminTeamIds.includes(table.teamId);
      return {
        canRead: true,
        canWriteRows: table.memberWritable || isTeamAdmin || isCreator,
        canManage: isTeamAdmin || isCreator,
      };
    }
    case "global": {
      return {
        canRead: true,
        canWriteRows: table.memberWritable || auth.user.isSuperAdmin,
        canManage: auth.user.isSuperAdmin,
      };
    }
    default:
      return NONE;
  }
}

/**
 * AI／MCP 介面的有效權限（MCP 工具與團隊助手注入都走這裡）：
 * 在「使用者本人權限」上疊加資料庫的 agentAccess 等級——只會更嚴、不會放寬。
 *   none ＝AI 完全看不到這個庫（列表也不出現）；
 *   read ＝AI 可查、不可寫（即使本人在網頁上可寫）；
 *   write＝跟本人權限一致。
 * canManage 一律 false：結構調整只留給網頁端的人。
 */
export function resolveAgentAccess(
  auth: AuthState,
  table: Pick<DataTableRow, "scope" | "ownerId" | "groupId" | "teamId" | "memberWritable" | "createdBy" | "agentAccess">,
): DbAccess {
  const human = resolveTableAccess(auth, table);
  const level = table.agentAccess ?? "write";
  if (level === "none" || !human.canRead) return NONE;
  return {
    canRead: true,
    canWriteRows: level === "write" && human.canWriteRows,
    canManage: false,
  };
}

/** 建立守衛：這個人能不能在該範圍建庫（global 限開發者，其餘＝該範圍成員） */
export function canCreateIn(auth: AuthState, scope: DataTableRow["scope"], groupId?: string | null, teamId?: string | null): string | null {
  if (scope === "personal") return null;
  if (scope === "group") {
    if (!groupId) return "組範圍要指定組別";
    return auth.groups.some((g) => g.groupId === groupId) ? null : "你不屬於這個組";
  }
  if (scope === "team") {
    if (!teamId) return "團隊範圍要指定團隊";
    return memberTeamIds(auth).has(teamId) ? null : "你不屬於這個團隊";
  }
  // global
  return auth.user.isSuperAdmin ? null : "全站資料庫只有超級管理員能建立";
}

/**
 * 列出此人可見的資料庫（tRPC 清單與 MCP list_databases 共用）：
 * 一條 or 條件查齊四層範圍，附每庫列數（彙總子查詢，無 N+1）。
 */
export async function listVisibleTables(auth: AuthState): Promise<Array<DataTableRow & { rowCount: number }>> {
  const groupIds = auth.groups.map((g) => g.groupId);
  const teamIds = [...memberTeamIds(auth)];
  const conds: SQL[] = [
    and(eq(schema.dataTables.scope, "personal"), eq(schema.dataTables.ownerId, auth.user.id))!,
    eq(schema.dataTables.scope, "global"),
  ];
  if (groupIds.length) conds.push(and(eq(schema.dataTables.scope, "group"), inArray(schema.dataTables.groupId, groupIds))!);
  if (teamIds.length) conds.push(and(eq(schema.dataTables.scope, "team"), inArray(schema.dataTables.teamId, teamIds))!);

  const tables = await db
    .select()
    .from(schema.dataTables)
    .where(and(isNull(schema.dataTables.deletedAt), or(...conds)))
    .orderBy(desc(schema.dataTables.updatedAt))
    .limit(200);

  if (tables.length === 0) return [];
  const counts = await db
    .select({ tableId: schema.dataRows.tableId, n: sql<number>`count(*)` })
    .from(schema.dataRows)
    .where(inArray(schema.dataRows.tableId, tables.map((t) => t.id)))
    .groupBy(schema.dataRows.tableId);
  const countBy = new Map(counts.map((c) => [c.tableId, Number(c.n)]));
  return tables.map((t) => ({ ...t, rowCount: countBy.get(t.id) ?? 0 }));
}
