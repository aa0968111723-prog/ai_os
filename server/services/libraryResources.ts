/**
 * Canonical Library Resource layer.
 *
 * 問題（§12）：`assets.project_id` 是 NOT NULL，所以「資料中心」新增一個二進位素材時，
 * 實務上仍然必須先選一個專案。要讓「同一份資料被多個專案使用」而不複製 bytes，
 * 有兩條路：
 *   (a) 把 assets.project_id 改成 nullable —— 會動到全站對 assets 的既有語意，**不做**；
 *   (b) 在既有 carrier 之上加一層 canonical 指標 —— 這個檔案。
 *
 * 所以 library resource 的語意是：
 *   「這份原始資料在 Library 裡只有一份；bytes 實體掛在 `home_project_id` 的 carrier 列上，
 *     其它專案透過 `library_resource_usages` 引用它。」
 *
 * ★ 引用不放寬權限。`library_resource_usages` 只回答「哪些專案在用」，
 *   「這個人看不看得到」永遠仍由 dataHub / databaseAcl / 組隔離重新解析。
 *   讀取端一律先取可見清單，再與這裡的結果取交集——絕不可反過來。
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";

export type LibraryCarrierKind = "asset" | "knowledge" | "document" | "table";

export interface RegisterLibraryResourceInput {
  groupId: string;
  resourceKind: LibraryCarrierKind;
  resourceId: string;
  displayName: string;
  homeProjectId?: string | null;
  intelligenceId?: string | null;
  mime?: string | null;
  sizeBytes?: number | null;
  checksum?: string | null;
  /** 原始資料夾結構（Source Metadata）——與 AI 分類是兩回事，兩者同時存在 */
  sourceRootName?: string | null;
  relativePath?: string | null;
  parentPath?: string | null;
  sourceLastModifiedAt?: Date | null;
  originType?: string;
  folderImportSessionId?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

export type LibraryResourceRow = typeof schema.libraryResources.$inferSelect;

/**
 * 登記（或更新）一份 canonical library resource。冪等：同一個 carrier 只會有一列。
 *
 * 刻意**不**在這裡建立 project usage：把 bytes 放哪裡（home）與哪些專案在用（usage）
 * 是兩件事，混在一起就會回到「一個專案一份」的老路。
 */
export async function registerLibraryResource(
  input: RegisterLibraryResourceInput,
): Promise<LibraryResourceRow> {
  const now = new Date();
  const [row] = await db.insert(schema.libraryResources).values({
    groupId: input.groupId,
    resourceKind: input.resourceKind,
    resourceId: input.resourceId,
    intelligenceId: input.intelligenceId ?? null,
    homeProjectId: input.homeProjectId ?? null,
    displayName: input.displayName.slice(0, 400),
    mime: input.mime ?? null,
    sizeBytes: input.sizeBytes ?? null,
    checksum: input.checksum ?? null,
    sourceRootName: input.sourceRootName ?? null,
    relativePath: input.relativePath ?? null,
    parentPath: input.parentPath ?? null,
    sourceLastModifiedAt: input.sourceLastModifiedAt ?? null,
    originType: input.originType ?? "upload",
    folderImportSessionId: input.folderImportSessionId ?? null,
    metadata: input.metadata ?? {},
    createdBy: input.createdBy ?? null,
  }).onConflictDoUpdate({
    target: [schema.libraryResources.resourceKind, schema.libraryResources.resourceId],
    set: {
      groupId: input.groupId,
      displayName: input.displayName.slice(0, 400),
      // null 不覆蓋既有值：重新登記（例如補跑 intelligence）不該把已知的來源資訊抹掉
      ...(input.intelligenceId ? { intelligenceId: input.intelligenceId } : {}),
      ...(input.homeProjectId ? { homeProjectId: input.homeProjectId } : {}),
      ...(input.mime ? { mime: input.mime } : {}),
      ...(input.sizeBytes != null ? { sizeBytes: input.sizeBytes } : {}),
      ...(input.checksum ? { checksum: input.checksum } : {}),
      ...(input.relativePath ? {
        relativePath: input.relativePath,
        parentPath: input.parentPath ?? "",
        sourceRootName: input.sourceRootName ?? null,
      } : {}),
      ...(input.folderImportSessionId ? { folderImportSessionId: input.folderImportSessionId } : {}),
      updatedAt: now,
    },
  }).returning();
  return row!;
}

/** Intelligence sidecar 跑起來之後補綁；找不到 library resource 時安靜跳過。 */
export async function attachIntelligenceToLibraryResource(input: {
  resourceKind: LibraryCarrierKind;
  resourceId: string;
  intelligenceId: string;
}): Promise<void> {
  await db.update(schema.libraryResources)
    .set({ intelligenceId: input.intelligenceId, updatedAt: new Date() })
    .where(and(
      eq(schema.libraryResources.resourceKind, input.resourceKind),
      eq(schema.libraryResources.resourceId, input.resourceId),
    ));
}

/**
 * 記錄「這個專案在用這份 Library 資料」。
 * ★ 不複製 bytes、不複製 intelligence、不建立第二份 asset 列。
 */
export async function recordLibraryUsage(input: {
  libraryResourceId: string;
  projectId: string;
  groupId: string;
  usage?: "reference" | "production" | "delivery";
  actorId?: string | null;
}): Promise<{ created: boolean }> {
  const rows = await db.insert(schema.libraryResourceUsages).values({
    libraryResourceId: input.libraryResourceId,
    projectId: input.projectId,
    groupId: input.groupId,
    usage: input.usage ?? "reference",
    createdBy: input.actorId ?? null,
  }).onConflictDoNothing().returning({ id: schema.libraryResourceUsages.id });
  return { created: rows.length > 0 };
}

export async function removeLibraryUsage(input: {
  libraryResourceId: string;
  projectId: string;
  usage?: "reference" | "production" | "delivery";
}): Promise<{ removed: boolean }> {
  const rows = await db.delete(schema.libraryResourceUsages).where(and(
    eq(schema.libraryResourceUsages.libraryResourceId, input.libraryResourceId),
    eq(schema.libraryResourceUsages.projectId, input.projectId),
    ...(input.usage ? [eq(schema.libraryResourceUsages.usage, input.usage)] : []),
  )).returning({ id: schema.libraryResourceUsages.id });
  return { removed: rows.length > 0 };
}

/** carrier（kind:id）→ library resource；批次查，絕不在迴圈裡逐筆查。 */
export async function loadLibraryResourcesByCarrier(
  carriers: readonly { kind: string; id: string }[],
): Promise<Map<string, LibraryResourceRow>> {
  const ids = [...new Set(carriers.map((carrier) => carrier.id))].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await db.select().from(schema.libraryResources)
    .where(inArray(schema.libraryResources.resourceId, ids));
  const wanted = new Set(carriers.map((carrier) => `${carrier.kind}:${carrier.id}`));
  return new Map(rows
    .filter((row) => wanted.has(`${row.resourceKind}:${row.resourceId}`))
    .map((row) => [`${row.resourceKind}:${row.resourceId}`, row]));
}

export interface LibraryUsageSummary {
  projectId: string;
  usage: string;
}

/**
 * 這幾份 Library 資料被哪些專案用到（Asset Inspector 的「Used By Projects」）。
 *
 * ★ 呼叫端必須自己把結果限縮在「這個人看得到的專案」——這裡不做 ACL，
 *   因為它不知道呼叫者是誰；把授權責任留在有 auth 的那一層，不要在這裡做半套。
 */
export async function loadLibraryUsages(
  libraryResourceIds: readonly string[],
): Promise<Map<string, LibraryUsageSummary[]>> {
  const ids = [...new Set(libraryResourceIds)].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await db.select({
    libraryResourceId: schema.libraryResourceUsages.libraryResourceId,
    projectId: schema.libraryResourceUsages.projectId,
    usage: schema.libraryResourceUsages.usage,
  }).from(schema.libraryResourceUsages)
    .where(inArray(schema.libraryResourceUsages.libraryResourceId, ids));
  const out = new Map<string, LibraryUsageSummary[]>();
  for (const row of rows) {
    out.set(row.libraryResourceId, [
      ...(out.get(row.libraryResourceId) ?? []),
      { projectId: row.projectId, usage: row.usage },
    ]);
  }
  return out;
}

/** 同一組裡是否已有相同 checksum 的 canonical 資料（重新匯入時避免再存一份 bytes）。 */
export async function findLibraryResourceByChecksum(input: {
  groupId: string;
  checksum: string;
}): Promise<LibraryResourceRow | null> {
  const [row] = await db.select().from(schema.libraryResources).where(and(
    eq(schema.libraryResources.groupId, input.groupId),
    eq(schema.libraryResources.checksum, input.checksum),
  )).limit(1);
  return row ?? null;
}
