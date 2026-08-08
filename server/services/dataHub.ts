/**
 * 資料中心（Unified Data Hub）Facade。
 *
 * ★ 這是 **facade，不是新的資料真相表**（見 docs/data-hub-current-state-2026-08.md §14）。
 *   - 沒有新表、沒有 migration：全部 SELECT 既有的 data_tables / data_files / knowledge / assets。
 *   - 沒有第二套 ACL：資料表一律走 services/databaseAcl，知識與素材一律走「組隔離」
 *     （auth.groups 的 groupId 集合，與 trpc.requireGroup 同一組真相）。
 *   - 沒有第二套匯入邏輯：這裡完全不寫入，只讀。
 *
 * ★ 效能契約（§27）：每個 domain 一次查詢，專案標題與素材描述各一次批次查詢。
 *   絕不可以在迴圈裡逐 resource 查 project / 查權限 / 查來源。
 *
 * ★ 安全契約（§25、§42）：聚合搜尋**不得**因為「只回標題」就放寬 ACL——
 *   標題本身就是敏感 metadata。每個 domain 的 where 條件就是它的權限守門，
 *   不存在「先全查再前端過濾」的路徑。
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { listVisibleTables, resolveTableAccess } from "./databaseAcl";
import {
  dataHubResolveSource,
  dataHubResourceId,
  dataHubSourceHasUpdate,
  dataHubStatusOf,
  formatDataHubSyncedAt,
  formatDataHubBytes,
  formatDataHubChars,
  formatDataHubRows,
  resolveAssetAiAccess,
  resolveDocumentAiAccess,
  resolveKnowledgeAiAccess,
  resolveTableAiAccess,
  summarizeDataHub,
  type DataHubKind,
  type DataHubResource,
  type DataHubScope,
  type DataHubSummaryCounts,
} from "../../shared/dataHub";

/** 單一 domain 的預設抓取上限——資料中心是「總覽 + 搜尋」，不是全量匯出 */
const PER_KIND_LIMIT_DEFAULT = 60;
const PER_KIND_LIMIT_MAX = 200;

export interface DataHubQuery {
  /** 關鍵字（標題／描述）；空字串視為未指定 */
  q?: string;
  /** 只要這幾種；未指定＝四種都要 */
  kinds?: readonly DataHubKind[];
  /** 只要屬於這個專案的資料（呼叫端必須已驗過成員身分） */
  projectId?: string;
  /** 只要這幾個範圍 */
  scopes?: readonly DataHubScope[];
  perKindLimit?: number;
}

/** ILIKE 用的字面值轉義（% _ \ 都是 LIKE 的元字元） */
function likeLiteral(raw: string): string {
  return raw.replace(/[%_\\]/g, "\\$&");
}

function wantsKind(kinds: DataHubQuery["kinds"], kind: DataHubKind): boolean {
  return !kinds || kinds.length === 0 || kinds.includes(kind);
}

function wantsScope(scopes: DataHubQuery["scopes"], scope: DataHubScope): boolean {
  return !scopes || scopes.length === 0 || scopes.includes(scope);
}

function clampLimit(n: number | undefined): number {
  if (!n || !Number.isFinite(n)) return PER_KIND_LIMIT_DEFAULT;
  return Math.min(PER_KIND_LIMIT_MAX, Math.max(1, Math.floor(n)));
}

/** 這個人所屬的組 id（知識／素材的組隔離守門；開發者在 loadAuthState 已展開全部） */
function myGroupIds(auth: AuthState): string[] {
  return [...new Set(auth.groups.map((g) => g.groupId))];
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/* ────────────────────────── 各 domain → DataHubResource ────────────────────────── */

type ProjectTitleMap = Map<string, { title: string; groupId: string }>;

async function loadProjectTitles(projectIds: readonly string[]): Promise<ProjectTitleMap> {
  const ids = [...new Set(projectIds)].filter(Boolean);
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.projects.id, title: schema.projects.title, groupId: schema.projects.groupId })
    .from(schema.projects)
    .where(inArray(schema.projects.id, ids));
  return new Map(rows.map((r) => [r.id, { title: r.title, groupId: r.groupId }]));
}

/**
 * 「AI 已經看過」的素材集合：站內的圖片描述是以 knowledge.sourceAssetId 落地的
 * （見 routers/knowledge.describeImageAsset），沒有獨立欄位。
 * 一次 inArray 批次查完——不可逐素材查。
 */
async function loadDescribedAssetIds(assetIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(assetIds)].filter(Boolean);
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ sourceAssetId: schema.knowledge.sourceAssetId })
    .from(schema.knowledge)
    .where(and(inArray(schema.knowledge.sourceAssetId, ids), isNull(schema.knowledge.deletedAt)));
  return new Set(rows.map((r) => r.sourceAssetId).filter((v): v is string => !!v));
}

interface DomainSlice {
  resources: DataHubResource[];
  /** 這個 domain 是否被 perKindLimit 截斷（§「不要 silent truncate」） */
  truncated: boolean;
}

/** 結構化資料表：權限與清單完全沿用 databaseAcl.listVisibleTables（含四層範圍的 or 條件） */
function tableSlice(auth: AuthState, query: DataHubQuery, tables: Awaited<ReturnType<typeof listVisibleTables>>): DomainSlice {
  const needle = query.q?.trim().toLocaleLowerCase("zh-TW") ?? "";
  const limit = clampLimit(query.perKindLimit);
  // 表沒有 project 欄位（表與專案的關係走 project link field）——指定 projectId 時，
  // 表的納入由 projectLinkedTableIds 決定，這裡先不過濾，由呼叫端傳 allowTableIds。
  const matched = tables.filter((t) => {
    if (!wantsScope(query.scopes, t.scope as DataHubScope)) return false;
    if (!needle) return true;
    return (
      t.name.toLocaleLowerCase("zh-TW").includes(needle)
      || (t.description ?? "").toLocaleLowerCase("zh-TW").includes(needle)
    );
  });
  const resources = matched.slice(0, limit).map<DataHubResource>((t) => {
    const human = resolveTableAccess(auth, t);
    const ai = resolveTableAiAccess({
      agentAccess: (t.agentAccess as "none" | "read" | "write") ?? "write",
      canWriteRows: human.canWriteRows,
    });
    const { status, label } = dataHubStatusOf("ready");
    return {
      id: dataHubResourceId("table", t.id),
      kind: "table",
      rawId: t.id,
      title: t.name,
      scope: t.scope as DataHubScope,
      source: "manual",
      projectId: null,
      projectTitle: null,
      groupId: t.groupId,
      ai,
      status,
      statusLabel: label,
      updatedAt: iso(t.updatedAt),
      href: `/databases?open=${encodeURIComponent(t.id)}`,
      sizeLabel: formatDataHubRows(t.rowCount),
      // 表本身是站內建立的結構，沒有外部來源可談
      syncedLabel: null,
      sourceHasUpdate: false,
    };
  });
  return { resources, truncated: matched.length > resources.length };
}

/** 資料表文件：只查「已通過 databaseAcl 的表」底下的檔案——表的權限就是文件的權限 */
async function documentSlice(
  query: DataHubQuery,
  visibleTables: Awaited<ReturnType<typeof listVisibleTables>>,
): Promise<DomainSlice> {
  const limit = clampLimit(query.perKindLimit);
  const allowed = visibleTables.filter((t) => wantsScope(query.scopes, t.scope as DataHubScope));
  if (allowed.length === 0) return { resources: [], truncated: false };
  const byTable = new Map(allowed.map((t) => [t.id, t]));

  const conds: SQL[] = [inArray(schema.dataFiles.tableId, [...byTable.keys()])];
  const q = query.q?.trim();
  if (q) conds.push(sql`${schema.dataFiles.name} ILIKE ${`%${likeLiteral(q)}%`} ESCAPE ${"\\"}`);

  const rows = await db
    .select({
      id: schema.dataFiles.id,
      tableId: schema.dataFiles.tableId,
      name: schema.dataFiles.name,
      mime: schema.dataFiles.mime,
      sizeBytes: schema.dataFiles.sizeBytes,
      sourceUrl: schema.dataFiles.sourceUrl,
      sourceProvider: schema.dataFiles.sourceProvider,
      sourceModifiedAt: schema.dataFiles.sourceModifiedAt,
      lastSyncedAt: schema.dataFiles.lastSyncedAt,
      aiDescription: schema.dataFiles.aiDescription,
      readableChars: sql<number>`coalesce(length(${schema.dataFiles.textContent}), 0)`,
      createdAt: schema.dataFiles.createdAt,
    })
    .from(schema.dataFiles)
    .where(and(...conds))
    .orderBy(desc(schema.dataFiles.createdAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const resources = page.map<DataHubResource>((f) => {
    const table = byTable.get(f.tableId)!;
    const readableChars = Number(f.readableChars ?? 0);
    const ai = resolveDocumentAiAccess({
      tableAgentAccess: (table.agentAccess as "none" | "read" | "write") ?? "write",
      readableChars,
      aiDescription: f.aiDescription,
    });
    // AI 讀不到內容不是「錯誤」，是「這種檔案就是只能存檔」——狀態仍是 ready，
    // 由 ai.reason 誠實說明；把它標成 error 會讓整個清單充滿假警報。
    const { status, label } = dataHubStatusOf("ready");
    return {
      id: dataHubResourceId("document", f.id),
      kind: "document",
      rawId: f.id,
      title: f.name,
      scope: table.scope as DataHubScope,
      // 已記錄的供應商優先；沒記錄（舊列）才從網址猜——猜出來的不該蓋掉匯入當下的事實。
      // 兩者都沒有＝這份檔案是直接上傳的（文件一定是「進來過」的，不像知識庫可以站內打字建立）。
      source: dataHubResolveSource({
        sourceProvider: f.sourceProvider,
        sourceUrl: f.sourceUrl,
        fallback: "upload",
      }),
      projectId: null,
      projectTitle: null,
      groupId: table.groupId,
      ai,
      status,
      statusLabel: label,
      updatedAt: iso(f.createdAt),
      href: `/databases?open=${encodeURIComponent(f.tableId)}`,
      sizeLabel: readableChars > 0 ? formatDataHubChars(readableChars) : formatDataHubBytes(f.sizeBytes),
      syncedLabel: f.lastSyncedAt ? formatDataHubSyncedAt(iso(f.lastSyncedAt)) : null,
      sourceHasUpdate: dataHubSourceHasUpdate({
        sourceModifiedAt: f.sourceModifiedAt ? iso(f.sourceModifiedAt) : null,
        lastSyncedAt: f.lastSyncedAt ? iso(f.lastSyncedAt) : null,
      }),
    };
  });
  return { resources, truncated: rows.length > page.length };
}

/** 專案知識庫：組隔離（groupId ∈ 我的組）＋不含回收桶 */
async function knowledgeSlice(auth: AuthState, query: DataHubQuery): Promise<DomainSlice> {
  const limit = clampLimit(query.perKindLimit);
  const groupIds = myGroupIds(auth);
  if (groupIds.length === 0) return { resources: [], truncated: false };

  const conds: SQL[] = [
    inArray(schema.knowledge.groupId, groupIds),
    isNull(schema.knowledge.deletedAt),
  ];
  if (query.projectId) conds.push(eq(schema.knowledge.projectId, query.projectId));
  const q = query.q?.trim();
  if (q) {
    const pat = `%${likeLiteral(q)}%`;
    conds.push(
      sql`(${schema.knowledge.title} ILIKE ${pat} ESCAPE ${"\\"} OR COALESCE(${schema.knowledge.summary}, '') ILIKE ${pat} ESCAPE ${"\\"})`,
    );
  }

  const rows = await db
    .select({
      id: schema.knowledge.id,
      projectId: schema.knowledge.projectId,
      groupId: schema.knowledge.groupId,
      title: schema.knowledge.title,
      sourceAssetId: schema.knowledge.sourceAssetId,
      sourceProvider: schema.knowledge.sourceProvider,
      sourceUrl: schema.knowledge.sourceUrl,
      sourceModifiedAt: schema.knowledge.sourceModifiedAt,
      lastSyncedAt: schema.knowledge.lastSyncedAt,
      chars: sql<number>`length(${schema.knowledge.content})`,
      createdAt: schema.knowledge.createdAt,
    })
    .from(schema.knowledge)
    .where(and(...conds))
    .orderBy(desc(schema.knowledge.createdAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const resources = page.map<DataHubResource>((k) => {
    const { status, label } = dataHubStatusOf("ready");
    return {
      id: dataHubResourceId("knowledge", k.id),
      kind: "knowledge",
      rawId: k.id,
      title: k.title,
      scope: "project",
      // 有記錄就用記錄（P6 之後匯入的都有）；沒有記錄的舊列，由站內素材轉來的算 upload，
      // 其餘一律誠實標「站內建立」——不從標題猜來源（假 lineage 比沒有 lineage 更糟）。
      source: dataHubResolveSource({
        sourceProvider: k.sourceProvider,
        sourceUrl: k.sourceUrl,
        fallback: k.sourceAssetId ? "upload" : "manual",
      }),
      projectId: k.projectId,
      projectTitle: null,
      groupId: k.groupId,
      ai: resolveKnowledgeAiAccess(),
      status,
      statusLabel: label,
      updatedAt: iso(k.createdAt),
      href: `/p/${encodeURIComponent(k.projectId)}#sec-knowledge`,
      sizeLabel: formatDataHubChars(Number(k.chars ?? 0)),
      syncedLabel: k.lastSyncedAt ? formatDataHubSyncedAt(iso(k.lastSyncedAt)) : null,
      sourceHasUpdate: dataHubSourceHasUpdate({
        sourceModifiedAt: k.sourceModifiedAt ? iso(k.sourceModifiedAt) : null,
        lastSyncedAt: k.lastSyncedAt ? iso(k.lastSyncedAt) : null,
      }),
    };
  });
  return { resources, truncated: rows.length > page.length };
}

/** 專案素材庫：組隔離＋不含回收桶 */
async function assetSlice(auth: AuthState, query: DataHubQuery): Promise<DomainSlice> {
  const limit = clampLimit(query.perKindLimit);
  const groupIds = myGroupIds(auth);
  if (groupIds.length === 0) return { resources: [], truncated: false };

  const conds: SQL[] = [inArray(schema.assets.groupId, groupIds), isNull(schema.assets.deletedAt)];
  if (query.projectId) conds.push(eq(schema.assets.projectId, query.projectId));
  const q = query.q?.trim();
  if (q) conds.push(sql`${schema.assets.title} ILIKE ${`%${likeLiteral(q)}%`} ESCAPE ${"\\"}`);

  const rows = await db
    .select({
      id: schema.assets.id,
      projectId: schema.assets.projectId,
      groupId: schema.assets.groupId,
      title: schema.assets.title,
      sizeBytes: schema.assets.sizeBytes,
      isAiGenerated: schema.assets.isAiGenerated,
      landState: schema.assets.landState,
      createdAt: schema.assets.createdAt,
    })
    .from(schema.assets)
    .where(and(...conds))
    .orderBy(desc(schema.assets.createdAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const described = await loadDescribedAssetIds(page.map((a) => a.id));
  const resources = page.map<DataHubResource>((a) => {
    const internal = a.landState === "pending"
      ? "processing"
      : a.landState === "failed" || a.landState === "structural_fail"
        ? "failed"
        : "ready";
    const { status, label } = dataHubStatusOf(internal);
    return {
      id: dataHubResourceId("asset", a.id),
      kind: "asset",
      rawId: a.id,
      title: a.title,
      scope: "project",
      source: a.isAiGenerated ? "generated" : "upload",
      projectId: a.projectId,
      projectTitle: null,
      groupId: a.groupId,
      ai: resolveAssetAiAccess({ hasAiDescription: described.has(a.id) }),
      status,
      statusLabel: label,
      updatedAt: iso(a.createdAt),
      href: `/p/${encodeURIComponent(a.projectId)}#sec-assets`,
      sizeLabel: a.sizeBytes ? formatDataHubBytes(a.sizeBytes) : null,
      // 素材是站內上傳或生成的，沒有外部來源可同步
      syncedLabel: null,
      sourceHasUpdate: false,
    };
  });
  return { resources, truncated: rows.length > page.length };
}

/* ────────────────────────── 對外 API ────────────────────────── */

export interface DataHubListResult {
  resources: DataHubResource[];
  counts: DataHubSummaryCounts;
  /** 有任一 domain 被上限截斷——UI 要誠實說「還有更多，請縮小搜尋範圍」 */
  truncated: boolean;
}

/**
 * 資料中心清單／搜尋（同一支；`q` 有值就是搜尋）。
 *
 * 呼叫端責任：若帶 `projectId`，必須**先**驗過該專案的成員身分（routers/dataHub 會做）。
 * 這裡仍會再套一次組隔離，所以就算漏驗也不會跨組外洩——但別依賴它當唯一守門。
 */
export async function listDataHubResources(auth: AuthState, query: DataHubQuery = {}): Promise<DataHubListResult> {
  const visibleTables = wantsKind(query.kinds, "table") || wantsKind(query.kinds, "document")
    ? await listVisibleTables(auth)
    : [];

  // 指定專案時，結構化表的納入依「有列指向此專案」（既有 project link field 語意，
  // 與 databases.linkedToProject 同一條規則）——不新增第二套綁定語意。
  let projectTableIds: Set<string> | null = null;
  if (query.projectId && visibleTables.length > 0) {
    projectTableIds = await projectLinkedTableIds(query.projectId, visibleTables);
  }

  const scopedTables = projectTableIds
    ? visibleTables.filter((t) => projectTableIds!.has(t.id))
    : visibleTables;

  const [docSlice, kSlice, aSlice] = await Promise.all([
    wantsKind(query.kinds, "document") ? documentSlice(query, scopedTables) : Promise.resolve<DomainSlice>({ resources: [], truncated: false }),
    wantsKind(query.kinds, "knowledge") ? knowledgeSlice(auth, query) : Promise.resolve<DomainSlice>({ resources: [], truncated: false }),
    wantsKind(query.kinds, "asset") ? assetSlice(auth, query) : Promise.resolve<DomainSlice>({ resources: [], truncated: false }),
  ]);
  const tSlice = wantsKind(query.kinds, "table")
    ? tableSlice(auth, query, scopedTables)
    : { resources: [], truncated: false };

  const resources = [...tSlice.resources, ...docSlice.resources, ...kSlice.resources, ...aSlice.resources];

  // 專案標題一次批次補齊（§27：絕不逐 resource 查專案）
  const titles = await loadProjectTitles(resources.map((r) => r.projectId ?? "").filter(Boolean));
  for (const r of resources) {
    if (r.projectId) r.projectTitle = titles.get(r.projectId)?.title ?? null;
  }

  resources.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));

  return {
    resources,
    counts: summarizeDataHub(resources),
    truncated: tSlice.truncated || docSlice.truncated || kSlice.truncated || aSlice.truncated,
  };
}

/**
 * 哪些可見的表算是「這個專案的」。
 *
 * ★ DUAL READ（P4）：兩條路都算，兩條都保留——
 *   (a) legacy：表裡某一列的 project 欄指向本專案（既有 project link field，完全不動）
 *   (b) 新增：整張表被綁定給本專案（services/projectDataBindings）
 * 兩邊都只在「已通過 databaseAcl 的可見表」裡挑，綁定不會讓看不到的表變看得到。
 */
async function projectLinkedTableIds(
  projectId: string,
  visibleTables: Awaited<ReturnType<typeof listVisibleTables>>,
): Promise<Set<string>> {
  const [{ findProjectLinkedRows }, { listProjectBoundTableIds }] = await Promise.all([
    import("./databaseProjectLinks"),
    import("./projectDataBindings"),
  ]);
  const targets = visibleTables
    .map((t) => ({
      tableId: t.id,
      fieldKeys: (t.fields as Array<{ key: string; type: string }>).filter((f) => f.type === "project").map((f) => f.key),
    }))
    .filter((t) => t.fieldKeys.length > 0);
  const [linkedRows, bound] = await Promise.all([
    targets.length > 0 ? findProjectLinkedRows(projectId, targets) : Promise.resolve([]),
    listProjectBoundTableIds(projectId),
  ]);
  const out = new Set(linkedRows.map((r) => r.tableId));
  // 綁定的表也要在可見範圍內才列入——綁定只決定「算不算這個專案的」，不放寬可見性
  const visibleIds = new Set(visibleTables.map((t) => t.id));
  for (const id of bound) {
    if (visibleIds.has(id)) out.add(id);
  }
  return out;
}

export interface DataHubSourceState {
  id: "google-drive" | "notion" | "api";
  label: string;
  configured: boolean;
  connected: boolean;
  status: "active" | "error" | null;
  /** 顯示用辨識資訊（email／workspace／連線數）——永不含憑證 */
  detail: string | null;
  /** 這個來源目前登記了幾條連線（api 可多條） */
  count: number;
}

/**
 * 已連接的來源摘要。
 * ★ 不變量 I1：這裡回的是「你能不能去挑東西」，**不是** AI 讀得到什麼。
 *   任何呼叫端都不可以把 connected 當成 AI 可讀。
 */
export async function listDataHubSources(userId: string): Promise<DataHubSourceState[]> {
  const { listIntegrations } = await import("./integrations");
  const d = await listIntegrations(userId);
  return [
    {
      id: "google-drive",
      label: "Google 雲端",
      configured: d.googleDrive.configured,
      connected: d.googleDrive.connected,
      status: d.googleDrive.connected ? normalizeStatus(d.googleDrive.status) : null,
      detail: d.googleDrive.email ?? null,
      count: d.googleDrive.connected ? 1 : 0,
    },
    {
      id: "notion",
      label: "Notion",
      configured: true,
      connected: d.notion.connected,
      status: d.notion.connected ? normalizeStatus(d.notion.status) : null,
      detail: d.notion.workspace ?? null,
      count: d.notion.connected ? 1 : 0,
    },
    {
      id: "api",
      label: "外部 API",
      configured: true,
      connected: d.apis.length > 0,
      // 任一條連線失效就要讓使用者看得到「需要重新連接」——不可因為還有別條可用就報平安
      status: d.apis.length > 0 ? (d.apis.some((a) => a.status === "error") ? "error" : "active") : null,
      detail: d.apis.length > 0 ? `${d.apis.length} 個連線` : null,
      count: d.apis.length,
    },
  ];
}

/** DB 的 status 是自由字串——只認 error，其餘一律視為可用（不猜第三種狀態） */
function normalizeStatus(status: string | null | undefined): "active" | "error" {
  return status === "error" ? "error" : "active";
}

/** 純函式接縫（單元測試用；不對外承諾） */
export const __dataHubInternals = { likeLiteral, clampLimit, iso, wantsKind, wantsScope };
