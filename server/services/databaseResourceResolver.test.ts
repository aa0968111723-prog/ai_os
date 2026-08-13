import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "./auth";
import type { McpDatabaseListItem } from "./databaseMcp";

const listMcpDatabases = vi.fn();
vi.mock("./databaseMcp", () => ({
  listMcpDatabases: (...args: unknown[]) => listMcpDatabases(...args),
}));

import {
  canonicalRowValuesEqual,
  isSelectedTablePhrase,
  mapLabeledDatabaseRowValues,
  normalizeDatabaseName,
  prioritizeAssistantDatabases,
  resolveAuthorizedDatabase,
  resolveDatabaseFieldValues,
  resolveRecentDatabaseRow,
  selectedDatabaseIds,
} from "./databaseResourceResolver";

const fields = [
  { key: "title", label: "標題", type: "text" as const },
  { key: "kind", label: "分類", type: "select" as const, options: ["書法", "繪畫"] },
  { key: "done", label: "完成", type: "checkbox" as const },
];

describe("database resource resolver helpers", () => {
  it("normalizes names and detects selected-table deixis", () => {
    expect(normalizeDatabaseName("「素材清單」")).toBe("素材清單");
    expect(isSelectedTablePhrase("這張表")).toBe(true);
    expect(isSelectedTablePhrase("這裡呢")).toBe(true);
    expect(isSelectedTablePhrase("素材清單")).toBe(false);
  });

  it("prefers the page-selected table without inventing access", () => {
    const tables = [
      { id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "其他" },
      { id: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2", name: "素材清單" },
    ];
    const ordered = prioritizeAssistantDatabases(tables, {
      pageType: "database",
      entityType: "database",
      entityId: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    });
    expect(ordered[0]?.name).toBe("素材清單");
    expect(selectedDatabaseIds({
      pageType: "database",
      entityType: "database",
      entityId: "not-a-uuid",
    })).toEqual([]);
  });

  it("maps proposal labels but refuses silent discard on the execute path", () => {
    const proposed = mapLabeledDatabaseRowValues(fields, { 標題: "王羲之", 不存在: "x" });
    expect(proposed).toEqual({ title: "王羲之" });

    const strict = resolveDatabaseFieldValues(fields, { 標題: "王羲之", 不存在: "x" });
    expect(strict.status).toBe("unknown_fields");
    if (strict.status === "unknown_fields") expect(strict.unknown).toEqual(["不存在"]);

    const typed = resolveDatabaseFieldValues(fields, { 分類: "書法", 完成: "是" });
    expect(typed).toEqual({ status: "resolved", data: { kind: "書法", done: true } });
  });

  it("resolves recent row coreference without copying row content", () => {
    const recent = [{
      tableId: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      tableName: "素材清單",
      rowIds: ["r1", "r2", "r3"],
      timestamp: "2026-08-13T00:00:00.000Z",
    }];
    expect(resolveRecentDatabaseRow(recent, "把剛剛新增那筆改成完成")).toMatchObject({
      status: "resolved",
      rowId: "r1",
    });
    expect(resolveRecentDatabaseRow(recent, "把剛才找到的第三筆改掉")).toMatchObject({
      status: "resolved",
      rowId: "r3",
    });
    expect(resolveRecentDatabaseRow(recent, "把那些資料改掉").status).toBe("ambiguous");
    expect(resolveRecentDatabaseRow([], "剛剛那筆").status).toBe("not_found");
  });

  it("compares canonical read-back values", () => {
    expect(canonicalRowValuesEqual({ title: "王羲之", kind: "書法" }, { title: "王羲之", kind: "書法" })).toBe(true);
    expect(canonicalRowValuesEqual({ title: "王羲之" }, { title: "歐陽詢" })).toBe(false);
    expect(canonicalRowValuesEqual(null, { title: "x" })).toBe(false);
  });
});

function table(partial: Partial<McpDatabaseListItem> & Pick<McpDatabaseListItem, "tableId" | "name">): McpDatabaseListItem {
  return {
    scope: "group",
    description: null,
    fields: fields,
    rowCount: 1,
    canWriteRows: true,
    agentAccess: "write",
    hasProjectLink: false,
    ...partial,
  };
}

const auth = { user: { id: "user-1" }, groups: [{ groupId: "g1" }] } as unknown as AuthState;
const material = table({ tableId: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2", name: "素材清單" });
const other = table({ tableId: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1", name: "拍攝聯絡" });
const bound = table({
  tableId: "ccccccc3-cccc-4ccc-8ccc-ccccccccccc3",
  name: "專案卡",
  boundToProject: true,
});

describe("resolveAuthorizedDatabase", () => {
  beforeEach(() => {
    listMcpDatabases.mockReset().mockResolvedValue([other, material, bound]);
  });

  it("resolves exact and fuzzy names only among authorized tables", async () => {
    await expect(resolveAuthorizedDatabase(auth, { table: "素材清單" })).resolves.toMatchObject({
      status: "resolved",
      reason: "exact_name",
      table: { name: "素材清單" },
    });
    await expect(resolveAuthorizedDatabase(auth, { table: "素材" })).resolves.toMatchObject({
      status: "resolved",
      table: { name: "素材清單" },
    });
  });

  it("lets the selected table win for 這張表 / 這裡", async () => {
    await expect(resolveAuthorizedDatabase(auth, {
      table: "這張表",
      pageContext: { pageType: "database", entityType: "database", entityId: material.tableId },
    })).resolves.toMatchObject({ status: "resolved", reason: "selected_table", table: { name: "素材清單" } });
  });

  it("prefers a single project-bound table for 這個專案的資料", async () => {
    listMcpDatabases.mockResolvedValue([bound]);
    await expect(resolveAuthorizedDatabase(auth, {
      table: "這個專案的資料",
      projectId: "ppppppp1-pppp-4ppp-8ppp-ppppppppppp1",
      preferProjectBound: true,
    })).resolves.toMatchObject({ status: "resolved", reason: "project_bound", table: { name: "專案卡" } });
  });

  it("returns structured picker instead of guessing the first table", async () => {
    listMcpDatabases.mockResolvedValue([
      table({ tableId: "ddddddd4-dddd-4ddd-8ddd-ddddddddddd4", name: "素材庫" }),
      table({ tableId: "eeeeeee5-eeee-4eee-8eee-eeeeeeeeeee5", name: "素材清單" }),
    ]);
    await expect(resolveAuthorizedDatabase(auth, { table: "素材" })).resolves.toMatchObject({
      status: "ambiguous",
    });
  });

  it("resolves 第三個資料庫 and recent table refs", async () => {
    await expect(resolveAuthorizedDatabase(auth, { table: "第三個資料庫" })).resolves.toMatchObject({
      status: "resolved",
      reason: "ordinal",
      table: { name: "專案卡" },
    });
    await expect(resolveAuthorizedDatabase(auth, {
      table: "剛剛那個資料庫",
      recent: [{ tableId: material.tableId, tableName: "素材清單", rowIds: ["r1"], timestamp: "t" }],
    })).resolves.toMatchObject({ status: "resolved", reason: "recent_table", table: { name: "素材清單" } });
  });

  it("collapses inaccessible ids to not_found", async () => {
    await expect(resolveAuthorizedDatabase(auth, {
      tableId: "fffffff0-ffff-4fff-8fff-ffffffffffff",
    })).resolves.toMatchObject({ status: "not_found" });
  });
});
