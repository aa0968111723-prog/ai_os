/**
 * 專案 × 資源綁定（P4）：把「整份資源」提供給某個專案。
 *
 * 在此之前，一張資料表要跟專案扯上關係只有一條路：表裡某一列的「專案連結」欄位
 * 指向該專案（services/databaseProjectLinks）。那條路表達的是「這一列跟這個專案有關」，
 * 表達不了「整張表都給這個專案用」——而且這條規則不容易被發現。
 *
 * ★ 加法不是取代：既有 project link field 完全不動。所有讀取端一律 **dual read**
 *   （綁定 ∪ project-link 命中列），見 listProjectBoundTableIds 的呼叫端。
 *
 * ★ 綁定不放寬任何權限。這裡只回答「這份資源算不算這個專案的」；
 *   「這個人看不看得到」永遠仍由 databaseAcl 逐表重新解析。
 *   最關鍵的一條守門在 bindableDenyReason()：**personal 範圍的表永遠不可綁**——
 *   否則個人私有清單會經專案助手外洩給整組人（docs/data-hub-current-state-2026-08.md §14 / §43）。
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { resolveTableAccess, type DataTableRow } from "./databaseAcl";

/** 目前只綁資料表：knowledge／asset 本來就有 project_id，document 的權限跟隨所屬表 */
export const BINDABLE_RESOURCE_KINDS = ["table"] as const;
export type BindableResourceKind = (typeof BINDABLE_RESOURCE_KINDS)[number];

export interface ProjectRef {
  id: string;
  groupId: string;
}

/**
 * 能不能把這張表綁到這個專案？回 null＝可以，回字串＝不可以的理由（直接給使用者看）。
 *
 * 規則（由嚴到寬）：
 * 1. **personal 永遠不可綁**。個人庫是私人空間，連開發者都看不到；綁進專案等於
 *    把它交給整組人與專案 AI，這是最嚴重的一種外洩，不留任何開關。
 * 2. group 範圍：必須就是這個專案所屬的組。別組的表不可綁進來（跨組隔離）。
 * 3. team／global：範圍本來就涵蓋這個專案的成員，可綁。
 * 4. 另需操作者本人對該表有讀取權——不能綁一張自己都看不到的表。
 *
 * 注意這裡**不**檢查專案的編輯權：那是呼叫端（router）用 assertProjectEditable 做的，
 * 兩層各司其職，不互相取代。
 */
export function bindableDenyReason(
  auth: AuthState,
  table: Pick<DataTableRow, "scope" | "ownerId" | "groupId" | "teamId" | "memberWritable" | "createdBy">,
  project: ProjectRef,
): string | null {
  if (!resolveTableAccess(auth, table).canRead) return "找不到這張資料表";
  switch (table.scope) {
    case "personal":
      // 措辭刻意講清楚「為什麼」與「怎麼辦」，不是只說不行
      return "個人資料表不能提供給專案——它只有你看得到。要讓專案和 AI 使用，請改成組共用的資料表。";
    case "group":
      return table.groupId === project.groupId
        ? null
        : "這張表屬於別的組，不能提供給這個專案";
    case "team":
    case "global":
      return null;
    default:
      return "這張資料表無法提供給專案";
  }
}

/** 這個專案已綁定的資源（依種類分組） */
export async function listProjectBindings(projectId: string): Promise<Array<{
  id: string;
  resourceKind: string;
  resourceId: string;
  createdBy: string;
  createdAt: Date;
}>> {
  return db
    .select({
      id: schema.projectDataBindings.id,
      resourceKind: schema.projectDataBindings.resourceKind,
      resourceId: schema.projectDataBindings.resourceId,
      createdBy: schema.projectDataBindings.createdBy,
      createdAt: schema.projectDataBindings.createdAt,
    })
    .from(schema.projectDataBindings)
    .where(eq(schema.projectDataBindings.projectId, projectId));
}

/**
 * 這個專案「整份綁定」的資料表 id。
 * 呼叫端要把它與既有 project-link 命中的表**聯集**（dual read），不是取代。
 */
export async function listProjectBoundTableIds(projectId: string): Promise<Set<string>> {
  const rows = await db
    .select({ resourceId: schema.projectDataBindings.resourceId })
    .from(schema.projectDataBindings)
    .where(and(
      eq(schema.projectDataBindings.projectId, projectId),
      eq(schema.projectDataBindings.resourceKind, "table"),
    ));
  return new Set(rows.map((r) => r.resourceId));
}

/**
 * 多個專案一次查（避免逐專案查造成 N+1）。回 projectId → 表 id 集合。
 */
export async function listBoundTableIdsByProject(projectIds: readonly string[]): Promise<Map<string, Set<string>>> {
  const ids = [...new Set(projectIds)].filter(Boolean);
  const out = new Map<string, Set<string>>();
  if (ids.length === 0) return out;
  const rows = await db
    .select({
      projectId: schema.projectDataBindings.projectId,
      resourceId: schema.projectDataBindings.resourceId,
    })
    .from(schema.projectDataBindings)
    .where(and(
      inArray(schema.projectDataBindings.projectId, ids),
      eq(schema.projectDataBindings.resourceKind, "table"),
    ));
  for (const row of rows) {
    const bucket = out.get(row.projectId) ?? new Set<string>();
    bucket.add(row.resourceId);
    out.set(row.projectId, bucket);
  }
  return out;
}

/**
 * 建立綁定（冪等：同一份資源重複綁不會長出第二列，回既有那筆）。
 * 呼叫端必須**已經**驗過專案成員身分與編輯權，以及 bindableDenyReason。
 */
export async function createBinding(input: {
  project: ProjectRef;
  resourceKind: BindableResourceKind;
  resourceId: string;
  actorId: string;
}): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: schema.projectDataBindings.id })
    .from(schema.projectDataBindings)
    .where(and(
      eq(schema.projectDataBindings.projectId, input.project.id),
      eq(schema.projectDataBindings.resourceKind, input.resourceKind),
      eq(schema.projectDataBindings.resourceId, input.resourceId),
    ));
  if (existing[0]) return { id: existing[0].id, created: false };

  const [row] = await db
    .insert(schema.projectDataBindings)
    .values({
      projectId: input.project.id,
      groupId: input.project.groupId,
      resourceKind: input.resourceKind,
      resourceId: input.resourceId,
      createdBy: input.actorId,
    })
    .onConflictDoNothing()
    .returning({ id: schema.projectDataBindings.id });
  // onConflictDoNothing：兩個人同時按下時後到的那筆不會爆，改回查既有列
  if (row) return { id: row.id, created: true };
  const [raced] = await db
    .select({ id: schema.projectDataBindings.id })
    .from(schema.projectDataBindings)
    .where(and(
      eq(schema.projectDataBindings.projectId, input.project.id),
      eq(schema.projectDataBindings.resourceKind, input.resourceKind),
      eq(schema.projectDataBindings.resourceId, input.resourceId),
    ));
  return { id: raced?.id ?? "", created: false };
}

/**
 * 解除綁定。
 * ★ 只刪綁定，**絕不刪資料**——與「中斷外部來源不刪已匯入內容」同一條產品原則
 *   （docs/data-hub-current-state-2026-08.md §14 推論）。
 */
export async function removeBinding(input: {
  projectId: string;
  resourceKind: BindableResourceKind;
  resourceId: string;
}): Promise<{ removed: boolean }> {
  const deleted = await db
    .delete(schema.projectDataBindings)
    .where(and(
      eq(schema.projectDataBindings.projectId, input.projectId),
      eq(schema.projectDataBindings.resourceKind, input.resourceKind),
      eq(schema.projectDataBindings.resourceId, input.resourceId),
    ))
    .returning({ id: schema.projectDataBindings.id });
  return { removed: deleted.length > 0 };
}
