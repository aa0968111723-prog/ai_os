/**
 * Project / Scene / Shot Context Binding — 讀寫與守門。
 *
 * 一張 `context_bindings` 表服務三個 scope（project / scene / shot），
 * 所以這裡只有一套 service，不是三套幾乎相同的 service。
 *
 * ★ 五條不變量在這裡的落點（docs/data-hub-current-state-2026-08.md §14 / §18.2）：
 *   - Imported ≠ Project Bound：建立 binding 需要 `assertProjectEditable`。
 *   - Project Bound ≠ Visible：讀取端一律 **先** 解出「這個人看得到什麼」，再與 binding 取交集。
 *   - personal scope 的資料表**永遠不可**綁進任何 context——與 projectDataBindings 同一條規則，
 *     否則個人私有清單會經專案 AI 外洩給整組人。
 *   - AI_SUGGESTED 不會自動變成 USER_CONFIRMED：升級只走 `confirmContextBinding()`。
 */
import { and, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { resolveTableAccess } from "./databaseAcl";
import { listDataHubResources } from "./dataHub";
import type { DataHubResource } from "../../shared/dataHub";
import {
  isContextRole,
  type ContextBindingLike,
  type ContextPriority,
  type ContextRole,
  type ContextScopeType,
  type ContextSource,
} from "../../shared/projectContext";

export type ContextBindingRow = typeof schema.contextBindings.$inferSelect;
export type ContextResourceKind = "asset" | "knowledge" | "document" | "table";

export interface ContextScopeRef {
  projectId: string;
  groupId: string;
  scopeType: ContextScopeType;
  scopeId: string;
}

/**
 * 解析並驗證 scope：scene 必須是這個專案的 story_scene，shot 必須是這個專案的 scene 列。
 * 別的專案的 scene id 直接擋掉——否則可以用 A 專案的權限去寫 B 專案的 context。
 */
export async function resolveContextScope(input: {
  project: { id: string; groupId: string };
  scopeType: ContextScopeType;
  scopeId?: string | null;
}): Promise<ContextScopeRef> {
  const { project, scopeType } = input;
  if (scopeType === "project") {
    if (input.scopeId && input.scopeId !== project.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "專案脈絡的範圍必須是這個專案" });
    }
    return { projectId: project.id, groupId: project.groupId, scopeType, scopeId: project.id };
  }
  if (!input.scopeId) throw new TRPCError({ code: "BAD_REQUEST", message: "缺少場景或分鏡" });
  if (scopeType === "scene") {
    const [scene] = await db.select({ id: schema.storyScenes.id, projectId: schema.storyScenes.projectId })
      .from(schema.storyScenes).where(eq(schema.storyScenes.id, input.scopeId));
    if (!scene || scene.projectId !== project.id) {
      throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個場景" });
    }
    return { projectId: project.id, groupId: project.groupId, scopeType, scopeId: scene.id };
  }
  const [shot] = await db.select({ id: schema.scenes.id, projectId: schema.scenes.projectId })
    .from(schema.scenes).where(eq(schema.scenes.id, input.scopeId));
  if (!shot || shot.projectId !== project.id) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個分鏡" });
  }
  return { projectId: project.id, groupId: project.groupId, scopeType, scopeId: shot.id };
}

/**
 * 這份資料可以被綁進這個專案的 context 嗎？
 * 回 null＝可以；回字串＝理由（直接給使用者看）。
 *
 * 這支刻意**不**用 `listDataHubResources` 的分頁清單當判準——那有 perKindLimit，
 * 「不在前 200 筆」不等於「沒有權限」。權限要逐筆真的查。
 */
export async function contextBindableDenyReason(
  auth: AuthState,
  input: { resourceKind: ContextResourceKind; resourceId: string; project: { id: string; groupId: string } },
): Promise<string | null> {
  const groupIds = new Set(auth.groups.map((group) => group.groupId));
  if (input.resourceKind === "asset") {
    const [asset] = await db.select({
      groupId: schema.assets.groupId,
      projectId: schema.assets.projectId,
      deletedAt: schema.assets.deletedAt,
    })
      .from(schema.assets).where(eq(schema.assets.id, input.resourceId));
    if (!asset || asset.deletedAt) return "找不到這份素材";
    if (!groupIds.has(asset.groupId)) return "找不到這份素材";
    if (asset.groupId !== input.project.groupId) return "這份素材屬於別的組，不能加入這個專案的脈絡";
    if (asset.projectId !== input.project.id) return "這份素材不屬於本專案（同組其他專案的圖不能當定裝）";
    return null;
  }
  if (input.resourceKind === "knowledge") {
    const [row] = await db.select({
      groupId: schema.knowledge.groupId,
      projectId: schema.knowledge.projectId,
      deletedAt: schema.knowledge.deletedAt,
    })
      .from(schema.knowledge).where(eq(schema.knowledge.id, input.resourceId));
    if (!row || row.deletedAt) return "找不到這份資料";
    if (!groupIds.has(row.groupId)) return "找不到這份資料";
    if (row.groupId !== input.project.groupId) return "這份資料屬於別的組，不能加入這個專案的脈絡";
    if (row.projectId !== input.project.id) return "這份資料不屬於本專案";
    return null;
  }
  // document / table：權限一律由 databaseAcl 解析；personal 永遠不可綁
  const tableId = input.resourceKind === "table"
    ? input.resourceId
    : (await db.select({ tableId: schema.dataFiles.tableId }).from(schema.dataFiles)
      .where(eq(schema.dataFiles.id, input.resourceId)))[0]?.tableId;
  if (!tableId) return "找不到這份文件";
  const [table] = await db.select().from(schema.dataTables).where(eq(schema.dataTables.id, tableId));
  if (!table || table.deletedAt) return "找不到這份資料";
  return contextTableDenyReason(auth, table, input.project);
}

/**
 * 結構化資料表（以及掛在它底下的文件）能不能進 context——**純函式**，測試釘死。
 *
 * ★ 與 `projectDataBindings.bindableDenyReason` 同一條規則，刻意重寫一份而不是共用，
 *   是因為理由文案不同（一個講「提供給專案」、一個講「加入專案脈絡」）；
 *   但**判準必須一致**，兩邊的測試都把 personal 那一條釘死。
 *   個人庫進了 context 就等於進了專案 AI，是最嚴重的一種外洩。
 */
export function contextTableDenyReason(
  auth: AuthState,
  table: Parameters<typeof resolveTableAccess>[1],
  project: { id: string; groupId: string },
): string | null {
  if (!resolveTableAccess(auth, table).canRead) return "找不到這份資料";
  switch (table.scope) {
    case "personal":
      return "個人資料表不能加入專案脈絡——它只有你看得到。要讓專案和 AI 使用，請改成組共用的資料表。";
    case "group":
      return table.groupId === project.groupId ? null : "這份資料屬於別的組，不能加入這個專案的脈絡";
    case "team":
    case "global":
      return null;
    default:
      return "這份資料無法加入專案脈絡";
  }
}

export interface UpsertContextBindingInput {
  auth: AuthState;
  scope: ContextScopeRef;
  resourceKind: ContextResourceKind;
  resourceId: string;
  role: ContextRole;
  priority?: ContextPriority;
  source?: ContextSource;
  confidence?: number | null;
  note?: string | null;
  /** true＝這是使用者按下去的（USER_CONFIRMED）；AI 建議一律 false */
  confirmedByUser: boolean;
}

/**
 * 建立／更新一筆 context binding（冪等：同一個 scope × 資源 × 角色只有一列）。
 *
 * 呼叫端必須**先**驗過專案成員與編輯權，並呼叫 `contextBindableDenyReason()`。
 */
export async function upsertContextBinding(input: UpsertContextBindingInput): Promise<ContextBindingRow> {
  if (!isContextRole(input.role)) throw new TRPCError({ code: "BAD_REQUEST", message: "不支援的脈絡角色" });
  const [intelligence] = await db.select({ id: schema.assetIntelligence.id })
    .from(schema.assetIntelligence).where(and(
      eq(schema.assetIntelligence.resourceKind, input.resourceKind),
      eq(schema.assetIntelligence.resourceId, input.resourceId),
    ));
  const [libraryResource] = await db.select({ id: schema.libraryResources.id })
    .from(schema.libraryResources).where(and(
      eq(schema.libraryResources.resourceKind, input.resourceKind),
      eq(schema.libraryResources.resourceId, input.resourceId),
    ));
  const source: ContextSource = input.confirmedByUser ? "USER_CONFIRMED" : input.source ?? "AI_SUGGESTED";
  const now = new Date();
  const [row] = await db.insert(schema.contextBindings).values({
    groupId: input.scope.groupId,
    projectId: input.scope.projectId,
    scopeType: input.scope.scopeType,
    scopeId: input.scope.scopeId,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    intelligenceId: intelligence?.id ?? null,
    libraryResourceId: libraryResource?.id ?? null,
    role: input.role,
    priority: input.priority ?? "SECONDARY",
    source,
    confidence: input.confidence ?? null,
    confirmedByUser: input.confirmedByUser,
    note: input.note?.slice(0, 400) ?? null,
    createdBy: input.auth.user.id,
  }).onConflictDoUpdate({
    target: [
      schema.contextBindings.scopeType,
      schema.contextBindings.scopeId,
      schema.contextBindings.resourceKind,
      schema.contextBindings.resourceId,
      schema.contextBindings.role,
    ],
    set: {
      priority: input.priority ?? "SECONDARY",
      // ★ 降級不會發生：已經是使用者確認的，AI 再次建議不會把它打回 AI_SUGGESTED
      ...(input.confirmedByUser ? { source: "USER_CONFIRMED" as const, confirmedByUser: true } : {}),
      ...(input.confidence != null ? { confidence: input.confidence } : {}),
      intelligenceId: intelligence?.id ?? null,
      libraryResourceId: libraryResource?.id ?? null,
      updatedAt: now,
    },
  }).returning();
  return row!;
}

/** 使用者確認一筆 AI 建議（唯一一條 AI_SUGGESTED → USER_CONFIRMED 的路）。 */
export async function confirmContextBinding(input: {
  bindingId: string;
  priority?: ContextPriority;
}): Promise<ContextBindingRow | null> {
  const [row] = await db.update(schema.contextBindings).set({
    source: "USER_CONFIRMED",
    confirmedByUser: true,
    ...(input.priority ? { priority: input.priority } : {}),
    updatedAt: new Date(),
  }).where(eq(schema.contextBindings.id, input.bindingId)).returning();
  return row ?? null;
}

export async function removeContextBinding(bindingId: string): Promise<boolean> {
  const rows = await db.delete(schema.contextBindings)
    .where(eq(schema.contextBindings.id, bindingId))
    .returning({ id: schema.contextBindings.id });
  return rows.length > 0;
}

/**
 * 把某個角色的某一筆設成 PRIMARY（同 scope 同角色的其他筆降為 SECONDARY）。
 * 「更換主要參考」就是這一支。
 */
export async function setPrimaryContextBinding(binding: ContextBindingRow): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(schema.contextBindings).set({ priority: "SECONDARY", updatedAt: new Date() })
      .where(and(
        eq(schema.contextBindings.scopeType, binding.scopeType),
        eq(schema.contextBindings.scopeId, binding.scopeId),
        eq(schema.contextBindings.role, binding.role),
        eq(schema.contextBindings.priority, "PRIMARY"),
      ));
    await tx.update(schema.contextBindings).set({ priority: "PRIMARY", updatedAt: new Date() })
      .where(eq(schema.contextBindings.id, binding.id));
  });
}

export interface VisibleContextBinding extends ContextBindingLike {
  resource: DataHubResource;
  note: string | null;
  createdAt: Date;
}

/**
 * 讀取某個專案（含指定 scene / shot）的 context bindings，**已套用可見性過濾**。
 *
 * ★ 這是 §41 的落點：即使 binding 存在，看不到的資料一律不回。
 *   實作方式是先取這個人在這個專案下看得到的 Data Hub 清單，再與 binding 取交集——
 *   絕不可以 `SELECT ... WHERE resourceId IN (bound)`，那會同時繞過 ACL 與軟刪除過濾。
 */
export async function listVisibleContextBindings(input: {
  auth: AuthState;
  projectId: string;
  sceneId?: string | null;
  shotId?: string | null;
  /** 只要這幾個 scope；預設三層都要（Context Resolver 要做繼承） */
  scopeTypes?: readonly ContextScopeType[];
  /** true＝只回使用者已確認的（第一層檢索） */
  confirmedOnly?: boolean;
}): Promise<VisibleContextBinding[]> {
  const scopeFilters: Array<{ scopeType: ContextScopeType; scopeId: string }> = [];
  const wanted = new Set(input.scopeTypes ?? ["project", "scene", "shot"]);
  if (wanted.has("project")) scopeFilters.push({ scopeType: "project", scopeId: input.projectId });
  if (wanted.has("scene") && input.sceneId) scopeFilters.push({ scopeType: "scene", scopeId: input.sceneId });
  if (wanted.has("shot") && input.shotId) scopeFilters.push({ scopeType: "shot", scopeId: input.shotId });
  if (!scopeFilters.length) return [];

  const rows = await db.select().from(schema.contextBindings).where(and(
    eq(schema.contextBindings.projectId, input.projectId),
    inArray(schema.contextBindings.scopeId, scopeFilters.map((filter) => filter.scopeId)),
    inArray(schema.contextBindings.scopeType, scopeFilters.map((filter) => filter.scopeType)),
    ...(input.confirmedOnly ? [eq(schema.contextBindings.confirmedByUser, true)] : []),
  ));
  if (!rows.length) return [];

  // 可見性：專案內 + 專案外（Library 共用資料）兩份清單的聯集，再與 binding 取交集。
  const [scoped, global] = await Promise.all([
    listDataHubResources(input.auth, { projectId: input.projectId, perKindLimit: 200 }),
    listDataHubResources(input.auth, { perKindLimit: 200 }),
  ]);
  const visible = new Map<string, DataHubResource>();
  for (const resource of [...scoped.resources, ...global.resources]) {
    visible.set(`${resource.kind}:${resource.rawId}`, resource);
  }

  const allowedScope = new Set(scopeFilters.map((filter) => `${filter.scopeType}:${filter.scopeId}`));
  return rows.flatMap((row) => {
    if (!allowedScope.has(`${row.scopeType}:${row.scopeId}`)) return [];
    const resource = visible.get(`${row.resourceKind}:${row.resourceId}`);
    if (!resource) return [];
    return [{
      id: row.id,
      scopeType: row.scopeType as ContextScopeType,
      scopeId: row.scopeId,
      role: row.role as ContextRole,
      priority: row.priority as ContextPriority,
      source: row.source as ContextSource,
      confidence: row.confidence,
      confirmedByUser: row.confirmedByUser,
      intelligenceId: row.intelligenceId,
      resourceKind: row.resourceKind,
      resourceId: row.resourceId,
      resource,
      note: row.note,
      createdAt: row.createdAt,
    }];
  });
}

/** 這幾份資料被哪些 scope 用到（Asset Inspector 的「Used By」）。 */
export async function loadContextUsage(input: {
  resources: readonly { kind: string; id: string }[];
  visibleProjectIds: ReadonlySet<string>;
}): Promise<Map<string, ContextBindingRow[]>> {
  const ids = [...new Set(input.resources.map((resource) => resource.id))];
  if (!ids.length) return new Map();
  const rows = await db.select().from(schema.contextBindings)
    .where(inArray(schema.contextBindings.resourceId, ids));
  const wanted = new Set(input.resources.map((resource) => `${resource.kind}:${resource.id}`));
  const out = new Map<string, ContextBindingRow[]>();
  for (const row of rows) {
    const key = `${row.resourceKind}:${row.resourceId}`;
    // 看不到的專案不回——「這份資料被 X 專案用到」本身就是敏感 metadata
    if (!wanted.has(key) || !input.visibleProjectIds.has(row.projectId)) continue;
    out.set(key, [...(out.get(key) ?? []), row]);
  }
  return out;
}
