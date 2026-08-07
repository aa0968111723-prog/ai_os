import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "./auth";

/**
 * 資料中心 facade 的權限與外形測試。
 *
 * 這裡最重要的斷言不是「回了幾筆」，而是**每個 domain 的 where 條件真的帶了守門參數**：
 * 知識與素材一定被限制在「我所屬的組」，且一定排除回收桶。
 * 聚合搜尋若因為「只回標題」就漏掉這層條件，就是跨組 metadata 外洩（docs §14 / §42）。
 */

/* ── 假 schema：欄位是可辨識的標記物，方便從 drizzle 的 SQL chunk 反查條件 ── */
const schemaMock = vi.hoisted(() => {
  const c = (name: string) => ({ __col: name });
  return {
    dataTables: { __name: "dataTables", id: c("data_tables.id"), scope: c("data_tables.scope") },
    dataFiles: {
      __name: "dataFiles",
      id: c("data_files.id"),
      tableId: c("data_files.table_id"),
      name: c("data_files.name"),
      mime: c("data_files.mime"),
      sizeBytes: c("data_files.size_bytes"),
      sourceUrl: c("data_files.source_url"),
      aiDescription: c("data_files.ai_description"),
      textContent: c("data_files.text_content"),
      createdAt: c("data_files.created_at"),
    },
    knowledge: {
      __name: "knowledge",
      id: c("knowledge.id"),
      projectId: c("knowledge.project_id"),
      groupId: c("knowledge.group_id"),
      title: c("knowledge.title"),
      content: c("knowledge.content"),
      summary: c("knowledge.summary"),
      sourceAssetId: c("knowledge.source_asset_id"),
      deletedAt: c("knowledge.deleted_at"),
      createdAt: c("knowledge.created_at"),
    },
    assets: {
      __name: "assets",
      id: c("assets.id"),
      projectId: c("assets.project_id"),
      groupId: c("assets.group_id"),
      title: c("assets.title"),
      sizeBytes: c("assets.size_bytes"),
      isAiGenerated: c("assets.is_ai_generated"),
      landState: c("assets.land_state"),
      deletedAt: c("assets.deleted_at"),
      createdAt: c("assets.created_at"),
    },
    projects: { __name: "projects", id: c("projects.id"), title: c("projects.title"), groupId: c("projects.group_id") },
  };
});

/** 每張表要回什麼列（測試逐案覆寫） */
const rowsByTable = vi.hoisted(() => ({} as Record<string, unknown[]>));
/** 每張表最後一次查詢用的 where 條件（供反查守門參數） */
const whereByTable = vi.hoisted(() => ({} as Record<string, unknown>));

vi.mock("../db", () => {
  const chain = (name: string) => {
    const self: Record<string, unknown> = {
      where: (cond: unknown) => {
        whereByTable[name] = cond;
        return self;
      },
      orderBy: () => self,
      limit: () => self,
      groupBy: () => self,
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rowsByTable[name] ?? []).then(resolve, reject),
    };
    return self;
  };
  return {
    db: {
      select: () => ({
        from: (table: { __name?: string }) => chain(table?.__name ?? "unknown"),
      }),
    },
    schema: schemaMock,
  };
});

const listVisibleTables = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("./databaseAcl", async (importOriginal) => {
  // resolveTableAccess 用**真的**——AI 權限映射必須反映真實 ACL，不可用替身放寬
  const actual = await importOriginal<typeof import("./databaseAcl")>();
  return { ...actual, listVisibleTables };
});

const findProjectLinkedRows = vi.hoisted(() => vi.fn(async () => [] as Array<{ tableId: string }>));
vi.mock("./databaseProjectLinks", () => ({ findProjectLinkedRows }));

const listIntegrations = vi.hoisted(() => vi.fn());
vi.mock("./integrations", () => ({ listIntegrations }));

import { listDataHubResources, listDataHubSources } from "./dataHub";

/* ── 從 drizzle 的 SQL 物件反查「實際帶進 where 的值與欄位」 ── */
function sqlValues(node: unknown, out: unknown[] = []): unknown[] {
  if (node === null || node === undefined) return out;
  // inArray 的值集合是一個 chunk：整包收下（攤平會讓「帶了哪些組」的斷言失去意義）
  if (Array.isArray(node)) {
    out.push(node);
    return out;
  }
  if (typeof node !== "object") {
    out.push(node);
    return out;
  }
  const ctor = (node as { constructor?: { name?: string } }).constructor?.name;
  if (ctor === "StringChunk") return out;
  const rec = node as Record<string, unknown>;
  if (Array.isArray(rec.queryChunks)) {
    for (const chunk of rec.queryChunks) sqlValues(chunk, out);
    return out;
  }
  if (typeof rec.__col === "string") {
    out.push(rec.__col);
    return out;
  }
  if ("value" in rec) return sqlValues(rec.value, out);
  return out;
}

const U = {
  me: "11111111-1111-4111-8111-111111111111",
  other: "22222222-2222-4222-8222-222222222222",
  groupA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  groupB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  team1: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  project1: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
};

function auth(over: Partial<AuthState> = {}): AuthState {
  return {
    user: { id: U.me, name: "我", email: "me@x", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId: U.groupA, groupName: "A", teamId: U.team1, teamName: "T1", role: "member" }],
    adminTeamIds: [],
    ...over,
  };
}

function visibleTable(over: Record<string, unknown> = {}) {
  return {
    id: "table-1",
    scope: "group",
    ownerId: null,
    groupId: U.groupA,
    teamId: null,
    name: "拍攝器材借用表",
    description: "誰借了什麼",
    fields: [],
    memberWritable: true,
    agentAccess: "write",
    createdBy: U.other,
    deletedAt: null,
    rowCount: 12,
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    ...over,
  };
}

beforeEach(() => {
  for (const key of Object.keys(rowsByTable)) delete rowsByTable[key];
  for (const key of Object.keys(whereByTable)) delete whereByTable[key];
  listVisibleTables.mockReset();
  listVisibleTables.mockResolvedValue([]);
  findProjectLinkedRows.mockReset();
  findProjectLinkedRows.mockResolvedValue([]);
  listIntegrations.mockReset();
});

describe("組隔離守門（跨組 metadata 不得外洩）", () => {
  it("知識查詢一定以「我所屬的組」為條件，且排除回收桶", async () => {
    await listDataHubResources(auth(), { kinds: ["knowledge"] });
    const values = sqlValues(whereByTable.knowledge);
    expect(values).toContainEqual([U.groupA]);
    expect(values).toContain("knowledge.group_id");
    expect(values).toContain("knowledge.deleted_at");
  });

  it("素材查詢同樣以組為條件並排除回收桶", async () => {
    await listDataHubResources(auth(), { kinds: ["asset"] });
    const values = sqlValues(whereByTable.assets);
    expect(values).toContainEqual([U.groupA]);
    expect(values).toContain("assets.deleted_at");
  });

  it("多組成員：條件帶上全部所屬組，且只有所屬組", async () => {
    const multi = auth({
      groups: [
        { groupId: U.groupA, groupName: "A", teamId: U.team1, teamName: "T1", role: "member" },
        { groupId: U.groupB, groupName: "B", teamId: U.team1, teamName: "T1", role: "leader" },
      ],
    });
    await listDataHubResources(multi, { kinds: ["knowledge"] });
    const groupParam = sqlValues(whereByTable.knowledge).find((v) => Array.isArray(v)) as string[];
    expect([...groupParam].sort()).toEqual([U.groupA, U.groupB].sort());
  });

  it("★ 不屬於任何組的人：知識與素材完全不查（不是查了再過濾）", async () => {
    rowsByTable.knowledge = [{ id: "k1" }];
    rowsByTable.assets = [{ id: "a1" }];
    const result = await listDataHubResources(auth({ groups: [] }), { kinds: ["knowledge", "asset"] });
    expect(result.resources).toEqual([]);
    expect(whereByTable.knowledge).toBeUndefined();
    expect(whereByTable.assets).toBeUndefined();
  });

  it("文件只查「已通過 databaseAcl 的表」底下的檔案", async () => {
    listVisibleTables.mockResolvedValue([visibleTable()]);
    await listDataHubResources(auth(), { kinds: ["document"] });
    expect(sqlValues(whereByTable.dataFiles)).toContainEqual(["table-1"]);
  });

  it("一張可見的表都沒有時，文件查詢完全不發（inArray 空集合不查）", async () => {
    listVisibleTables.mockResolvedValue([]);
    rowsByTable.dataFiles = [{ id: "f1" }];
    const result = await listDataHubResources(auth(), { kinds: ["document"] });
    expect(result.resources).toEqual([]);
    expect(whereByTable.dataFiles).toBeUndefined();
  });
});

describe("AI 權限映射反映真實 backend 權限", () => {
  it("agentAccess=none 的表 → 不提供 AI", async () => {
    listVisibleTables.mockResolvedValue([visibleTable({ agentAccess: "none" })]);
    const result = await listDataHubResources(auth(), { kinds: ["table"] });
    expect(result.resources[0].ai.access).toBe("none");
    expect(result.counts.aiUsable).toBe(0);
  });

  it("★ memberWritable=false 讓本人只讀時，即使 agentAccess=write 也只顯示「只讀」", async () => {
    listVisibleTables.mockResolvedValue([
      visibleTable({ agentAccess: "write", memberWritable: false, createdBy: U.other }),
    ]);
    const result = await listDataHubResources(auth(), { kinds: ["table"] });
    expect(result.resources[0].ai.access).toBe("readable");
  });

  it("組員可寫 + agentAccess=write → 可協作", async () => {
    listVisibleTables.mockResolvedValue([visibleTable()]);
    const result = await listDataHubResources(auth(), { kinds: ["table"] });
    expect(result.resources[0].ai.access).toBe("writable");
    expect(result.counts.aiUsable).toBe(1);
  });

  it("文件的 AI 權限跟隨所屬表：表不提供 AI，文件也不提供", async () => {
    listVisibleTables.mockResolvedValue([visibleTable({ agentAccess: "none" })]);
    rowsByTable.dataFiles = [{
      id: "f1", tableId: "table-1", name: "會議紀錄.pdf", mime: "application/pdf",
      sizeBytes: 1024, sourceUrl: null, aiDescription: null, readableChars: 5000,
      createdAt: new Date("2026-08-02T00:00:00.000Z"),
    }];
    const result = await listDataHubResources(auth(), { kinds: ["document"] });
    expect(result.resources[0].ai.access).toBe("none");
  });
});

describe("resource 外形", () => {
  it("id 跨 domain 唯一（kind 前綴），href 指回既有編輯器", async () => {
    listVisibleTables.mockResolvedValue([visibleTable()]);
    const result = await listDataHubResources(auth(), { kinds: ["table"] });
    expect(result.resources[0].id).toBe("table:table-1");
    expect(result.resources[0].rawId).toBe("table-1");
    expect(result.resources[0].href).toBe("/databases?open=table-1");
    expect(result.resources[0].sizeLabel).toBe("12 列");
  });

  it("知識的來源不亂猜：沒有 sourceAssetId 就標「站內建立」", async () => {
    rowsByTable.knowledge = [{
      id: "k1", projectId: U.project1, groupId: U.groupA, title: "腳本",
      sourceAssetId: null, chars: 1200, createdAt: new Date("2026-08-03T00:00:00.000Z"),
    }];
    rowsByTable.projects = [{ id: U.project1, title: "AI OS", groupId: U.groupA }];
    const result = await listDataHubResources(auth(), { kinds: ["knowledge"] });
    expect(result.resources[0].source).toBe("manual");
    expect(result.resources[0].projectTitle).toBe("AI OS");
    expect(result.resources[0].ai.access).toBe("readable");
  });

  it("文件的來源由 sourceUrl 推斷（Google／Notion／網址）", async () => {
    listVisibleTables.mockResolvedValue([visibleTable()]);
    rowsByTable.dataFiles = [
      { id: "f1", tableId: "table-1", name: "腳本", mime: "text/plain", sizeBytes: 10, sourceUrl: "https://docs.google.com/document/d/x/edit", aiDescription: null, readableChars: 100, createdAt: new Date("2026-08-04T00:00:00.000Z") },
      { id: "f2", tableId: "table-1", name: "頁面", mime: "text/plain", sizeBytes: 10, sourceUrl: "https://www.notion.so/abc", aiDescription: null, readableChars: 100, createdAt: new Date("2026-08-03T00:00:00.000Z") },
      { id: "f3", tableId: "table-1", name: "上傳檔", mime: "text/plain", sizeBytes: 10, sourceUrl: null, aiDescription: null, readableChars: 100, createdAt: new Date("2026-08-02T00:00:00.000Z") },
    ];
    const result = await listDataHubResources(auth(), { kinds: ["document"] });
    expect(result.resources.map((r) => r.source)).toEqual(["google-drive", "notion", "upload"]);
  });

  it("素材：landState=pending → 正在準備；failed → 錯誤", async () => {
    rowsByTable.assets = [
      { id: "a1", projectId: U.project1, groupId: U.groupA, title: "封面", sizeBytes: 2048, isAiGenerated: false, landState: "pending", createdAt: new Date("2026-08-05T00:00:00.000Z") },
      { id: "a2", projectId: U.project1, groupId: U.groupA, title: "片頭", sizeBytes: 2048, isAiGenerated: true, landState: "failed", createdAt: new Date("2026-08-04T00:00:00.000Z") },
    ];
    rowsByTable.projects = [{ id: U.project1, title: "AI OS", groupId: U.groupA }];
    const result = await listDataHubResources(auth(), { kinds: ["asset"] });
    expect(result.resources.map((r) => r.status)).toEqual(["processing", "error"]);
    expect(result.resources[1].source).toBe("generated");
  });

  it("多 domain 混合時依更新時間新→舊排序", async () => {
    listVisibleTables.mockResolvedValue([visibleTable({ updatedAt: new Date("2026-08-01T00:00:00.000Z") })]);
    rowsByTable.knowledge = [{
      id: "k1", projectId: U.project1, groupId: U.groupA, title: "新腳本",
      sourceAssetId: null, chars: 10, createdAt: new Date("2026-08-09T00:00:00.000Z"),
    }];
    rowsByTable.projects = [{ id: U.project1, title: "AI OS", groupId: U.groupA }];
    const result = await listDataHubResources(auth(), { kinds: ["table", "knowledge"] });
    expect(result.resources.map((r) => r.kind)).toEqual(["knowledge", "table"]);
  });
});

describe("搜尋", () => {
  it("關鍵字對表名做客端比對（表清單已由 ACL 限縮，資料量小）", async () => {
    listVisibleTables.mockResolvedValue([
      visibleTable({ id: "t1", name: "拍攝器材借用表" }),
      visibleTable({ id: "t2", name: "發布排程" }),
    ]);
    const result = await listDataHubResources(auth(), { kinds: ["table"], q: "器材" });
    expect(result.resources.map((r) => r.rawId)).toEqual(["t1"]);
  });

  it("★ 關鍵字裡的 LIKE 元字元被轉義，不會變成萬用字元", async () => {
    await listDataHubResources(auth(), { kinds: ["knowledge"], q: "100%_進度" });
    const values = sqlValues(whereByTable.knowledge);
    expect(values.some((v) => typeof v === "string" && v.includes("100\\%\\_進度"))).toBe(true);
  });
});

describe("專案上下文", () => {
  it("帶 projectId 時，知識與素材條件帶上該專案", async () => {
    await listDataHubResources(auth(), { kinds: ["knowledge", "asset"], projectId: U.project1 });
    expect(sqlValues(whereByTable.knowledge)).toContain(U.project1);
    expect(sqlValues(whereByTable.assets)).toContain(U.project1);
  });

  it("★ 表沿用既有 project link field 語意：沒有列指向此專案的表不列入", async () => {
    listVisibleTables.mockResolvedValue([
      visibleTable({ id: "t1", fields: [{ key: "proj", label: "專案", type: "project" }] }),
      visibleTable({ id: "t2", fields: [{ key: "proj", label: "專案", type: "project" }] }),
    ]);
    findProjectLinkedRows.mockResolvedValue([{ tableId: "t1" }]);
    const result = await listDataHubResources(auth(), { kinds: ["table"], projectId: U.project1 });
    expect(result.resources.map((r) => r.rawId)).toEqual(["t1"]);
  });

  it("完全沒有 project 欄位的表，在專案上下文一律不列入（不猜關聯）", async () => {
    listVisibleTables.mockResolvedValue([visibleTable({ id: "t1", fields: [] })]);
    const result = await listDataHubResources(auth(), { kinds: ["table"], projectId: U.project1 });
    expect(result.resources).toEqual([]);
    expect(findProjectLinkedRows).not.toHaveBeenCalled();
  });
});

describe("截斷回報（不 silent truncate）", () => {
  it("超過每類上限時回報 truncated", async () => {
    listVisibleTables.mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => visibleTable({ id: `t${i}`, name: `表 ${i}` })),
    );
    const result = await listDataHubResources(auth(), { kinds: ["table"], perKindLimit: 2 });
    expect(result.resources).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("沒被截斷時 truncated=false", async () => {
    listVisibleTables.mockResolvedValue([visibleTable()]);
    const result = await listDataHubResources(auth(), { kinds: ["table"], perKindLimit: 10 });
    expect(result.truncated).toBe(false);
  });
});

describe("來源摘要（不變量 I1）", () => {
  it("已連接只代表「可以去挑」，且任一 API 連線失效就標成需要重新連接", async () => {
    listIntegrations.mockResolvedValue({
      googleDrive: { configured: true, connected: true, email: "me@gmail.com", status: "active", lastError: null },
      notion: { connected: true, workspace: "團隊", last4: null, status: "error", lastError: "x", siteTokenAvailable: false },
      apis: [{ id: "1", status: "active" }, { id: "2", status: "error" }],
    });
    const sources = await listDataHubSources(U.me);
    expect(sources.find((s) => s.id === "google-drive")).toMatchObject({ connected: true, status: "active", detail: "me@gmail.com" });
    expect(sources.find((s) => s.id === "notion")).toMatchObject({ connected: true, status: "error" });
    expect(sources.find((s) => s.id === "api")).toMatchObject({ connected: true, status: "error", count: 2 });
  });

  it("未連接時 status 為 null（不是 active）", async () => {
    listIntegrations.mockResolvedValue({
      googleDrive: { configured: false, connected: false, email: null, status: null, lastError: null },
      notion: { connected: false, workspace: null, last4: null, status: null, lastError: null, siteTokenAvailable: false },
      apis: [],
    });
    const sources = await listDataHubSources(U.me);
    expect(sources.every((s) => s.status === null)).toBe(true);
    expect(sources.find((s) => s.id === "google-drive")?.configured).toBe(false);
  });
});

describe("批次查詢（不得 N+1）", () => {
  it("多筆不同專案的知識，只查一次 projects", async () => {
    const p2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    rowsByTable.knowledge = [
      { id: "k1", projectId: U.project1, groupId: U.groupA, title: "A", sourceAssetId: null, chars: 1, createdAt: new Date("2026-08-05T00:00:00.000Z") },
      { id: "k2", projectId: p2, groupId: U.groupA, title: "B", sourceAssetId: null, chars: 1, createdAt: new Date("2026-08-04T00:00:00.000Z") },
      { id: "k3", projectId: U.project1, groupId: U.groupA, title: "C", sourceAssetId: null, chars: 1, createdAt: new Date("2026-08-03T00:00:00.000Z") },
    ];
    rowsByTable.projects = [
      { id: U.project1, title: "AI OS", groupId: U.groupA },
      { id: p2, title: "城市微光", groupId: U.groupA },
    ];
    const result = await listDataHubResources(auth(), { kinds: ["knowledge"] });
    // 一次 inArray 帶齊所有 projectId（去重後兩個），不是逐筆查
    expect(sqlValues(whereByTable.projects)).toContainEqual([U.project1, p2]);
    expect(result.resources.map((r) => r.projectTitle)).toEqual(["AI OS", "城市微光", "AI OS"]);
  });
});
