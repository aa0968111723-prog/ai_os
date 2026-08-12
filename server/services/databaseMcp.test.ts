import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  canLinkProjectToTable,
  clampMcpLimit,
  clampMcpOffset,
  compactRowDataForMcp,
  hasProjectLinkField,
  mergeProjectIntoRowData,
  MCP_DB_CELL_MAX,
  MCP_DB_QUERY_LIMIT_DEFAULT,
  MCP_DB_QUERY_LIMIT_MAX,
} from "./databaseMcp";
import type { DataField } from "../../shared/databaseFields";

const fields: DataField[] = [
  { key: "title", label: "標題", type: "text", required: true },
  { key: "proj", label: "關聯專案", type: "project", required: true },
  { key: "note", label: "備註", type: "text" },
];

const PID = "11111111-1111-4111-8111-111111111111";
const GID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("canLinkProjectToTable", () => {
  it("rejects a project from another group even when the actor is in that other group", () => {
    expect(canLinkProjectToTable(GID, OTHER, [GID, OTHER])).toBe(false);
  });

  it("rejects a same-group project the actor cannot see", () => {
    expect(canLinkProjectToTable(GID, GID, [OTHER])).toBe(false);
  });

  it("allows a same-group project the actor belongs to", () => {
    expect(canLinkProjectToTable(GID, GID, [GID])).toBe(true);
  });
});

describe("mergeProjectIntoRowData", () => {
  it("fills empty project fields when projectId given", () => {
    const out = mergeProjectIntoRowData(fields, { title: "週更文案" }, PID) as Record<string, unknown>;
    expect(out.proj).toBe(PID);
    expect(out.title).toBe("週更文案");
  });

  it("does not overwrite an explicit project value", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    const out = mergeProjectIntoRowData(fields, { title: "x", proj: other }, PID) as Record<string, unknown>;
    expect(out.proj).toBe(other);
  });

  it("no-ops without projectId or invalid uuid", () => {
    expect(mergeProjectIntoRowData(fields, { title: "a" }, undefined)).toEqual({ title: "a" });
    expect(mergeProjectIntoRowData(fields, { title: "a" }, "not-uuid")).toEqual({ title: "a" });
  });

  it("handles non-object data by wrapping", () => {
    const out = mergeProjectIntoRowData(fields, null, PID) as Record<string, unknown>;
    expect(out.proj).toBe(PID);
  });
});

describe("compactRowDataForMcp", () => {
  it("truncates long strings with ellipsis", () => {
    const long = "字".repeat(MCP_DB_CELL_MAX + 40);
    const out = compactRowDataForMcp({ title: long, n: 3, ok: true, empty: null });
    expect(String(out.title).endsWith("…")).toBe(true);
    expect(String(out.title).length).toBe(MCP_DB_CELL_MAX + 1);
    expect(out.n).toBe(3);
    expect(out.ok).toBe(true);
    expect(out.empty).toBeNull();
  });

  it("returns empty object for invalid data", () => {
    expect(compactRowDataForMcp(null)).toEqual({});
    expect(compactRowDataForMcp([])).toEqual({});
  });
});

describe("clamp helpers", () => {
  it("clamps limit to 1..max", () => {
    expect(clampMcpLimit(undefined)).toBe(MCP_DB_QUERY_LIMIT_DEFAULT);
    expect(clampMcpLimit(0)).toBe(1);
    expect(clampMcpLimit(9999)).toBe(MCP_DB_QUERY_LIMIT_MAX);
    expect(clampMcpLimit(12.7)).toBe(12);
  });

  it("clamps offset", () => {
    expect(clampMcpOffset(-3)).toBe(0);
    expect(clampMcpOffset(10)).toBe(10);
    expect(clampMcpOffset(1e9)).toBe(20_000);
  });
});

describe("hasProjectLinkField", () => {
  it("detects project fields", () => {
    expect(hasProjectLinkField(fields)).toBe(true);
    expect(hasProjectLinkField([{ key: "a", label: "A", type: "text" }])).toBe(false);
    expect(hasProjectLinkField(null)).toBe(false);
  });
});

describe("mcp.ts wires databaseMcp (no full-text select on list files)", () => {
  it("uses databaseMcp helpers and no longer select() all columns for files", () => {
    const mcpSource = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");
    expect(mcpSource).toContain("listMcpDatabases");
    expect(mcpSource).toContain("visibleProjectsWhere");
    expect(mcpSource).toContain("素材共 ${total} 筆");
    expect(mcpSource).toContain("awaitingApproval: genTally.awaiting_approval ?? 0");
    expect(mcpSource).toContain("生成紀錄共 ${total} 筆");
    expect(mcpSource).toContain("知識共 ${total} 筆");
    expect(mcpSource).toContain("筆記共 ${total} 筆");
    expect(mcpSource).toContain("任務共 ${total} 筆");
    expect(mcpSource).toContain('if (name === "list_projects")');
    expect(mcpSource).toContain("visibleTotal: list.total");
    expect(mcpSource).toContain("truncated: list.truncated");
    expect(mcpSource).toContain("snapshotLimit: list.cap");
    expect(mcpSource).toContain("queryMcpDatabase");
    expect(mcpSource).toContain("listMcpDatabaseFiles");
    expect(mcpSource).toContain("mergeProjectIntoRowData");
    expect(mcpSource).toContain("resolveAuthorizedMcpProjectId");
    expect(mcpSource).toContain("update_database_row");
    // 舊路徑：.select().from(schema.dataFiles) 無投影——必須消失
    expect(mcpSource).not.toMatch(/\.select\(\)\s*\n\s*\.from\(schema\.dataFiles\)/);
  });

  it("catalog registers update_database_row as write", () => {
    const catalog = readFileSync(new URL("../../shared/mcpCatalog.ts", import.meta.url), "utf8");
    expect(catalog).toContain("update_database_row");
  });
});
