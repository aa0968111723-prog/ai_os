import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthState } from "./auth";
import type { ToolContext } from "./practicalAutonomy";

const listMcpDatabases = vi.fn();
const getAgentReadableTable = vi.fn();
const queryMcpDatabase = vi.fn();
const executeDatabaseWriteCommand = vi.fn();
const retrieveAssistantDatabaseEvidence = vi.fn();
const selectRows: Array<Record<string, unknown>> = [];

vi.mock("./databaseMcp", () => ({
  listMcpDatabases: (...args: unknown[]) => listMcpDatabases(...args),
  getAgentReadableTable: (...args: unknown[]) => getAgentReadableTable(...args),
  queryMcpDatabase: (...args: unknown[]) => queryMcpDatabase(...args),
  mergeProjectIntoRowData: (_fields: unknown, data: unknown) => data,
}));
vi.mock("./databaseCommand", () => ({
  executeDatabaseWriteCommand: (...args: unknown[]) => executeDatabaseWriteCommand(...args),
}));
vi.mock("./assistantDatabaseEvidence", () => ({
  retrieveAssistantDatabaseEvidence: (...args: unknown[]) => retrieveAssistantDatabaseEvidence(...args),
}));
vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => selectRows,
      }),
    }),
  },
  schema: { dataRows: { id: "id", tableId: "tableId", data: "data" } },
}));

import {
  agentDatabaseToolDefinitions,
  executeDatabaseListTool,
  executeDatabaseQueryTool,
  executeDatabaseRowAddTool,
  executeDatabaseRowGetTool,
  executeDatabaseRowUpdateTool,
  executeDatabaseSchemaTool,
} from "./agentDatabaseTools";
import { InMemoryRunLedger, PracticalAutonomyRuntime, ToolRegistry } from "./practicalAutonomy";

const auth = {
  user: { id: "user-1" },
  groups: [{ groupId: "group-1", role: "leader" }],
} as unknown as AuthState;

const context = {
  runId: "run-1",
  stepId: "step-1",
  userId: "user-1",
  groupId: "group-1",
  projectId: "ppppppp1-pppp-4ppp-8ppp-ppppppppppp1",
  idempotencyKey: "key",
  effectFingerprint: "fp",
  toolCallId: "call",
  attemptId: "attempt",
  inputTrust: "USER_EXPLICIT",
  signal: new AbortController().signal,
} as ToolContext;

const fields = [
  { key: "title", label: "標題", type: "text" as const, required: true },
  { key: "kind", label: "分類", type: "text" as const },
];
const table = {
  id: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
  name: "素材清單",
  fields,
  agentAccess: "write",
  groupId: "group-1",
};
const listed = [{
  tableId: table.id,
  name: table.name,
  scope: "group",
  description: null,
  fields,
  rowCount: 1,
  canWriteRows: true,
  agentAccess: "write" as const,
  hasProjectLink: false,
}];

describe("agent database tools", () => {
  beforeEach(() => {
    listMcpDatabases.mockReset().mockResolvedValue(listed);
    getAgentReadableTable.mockReset().mockResolvedValue({
      table,
      access: { canRead: true, canWriteRows: true, canManage: false },
    });
    queryMcpDatabase.mockReset().mockResolvedValue({
      table: table.name,
      tableId: table.id,
      keyword: "書法",
      limit: 50,
      offset: 0,
      returned: 1,
      hasMore: false,
      rows: [{ id: "row-old", data: { title: "書法" }, updatedAt: new Date("2020-01-01") }],
    });
    executeDatabaseWriteCommand.mockReset().mockResolvedValue({
      id: "row-new",
      tableId: table.id,
      data: { title: "王羲之", kind: "書法" },
    });
    retrieveAssistantDatabaseEvidence.mockReset().mockResolvedValue([]);
    selectRows.splice(0, selectRows.length);
  });

  it("lists authorized databases without defaulting to linked-only", async () => {
    const result = await executeDatabaseListTool(auth, context, {});
    expect(listMcpDatabases).toHaveBeenCalledWith(auth, {
      projectId: context.projectId,
      linkedOnly: false,
    });
    expect(result.verified).toBe(true);
    expect((result.value as { count: number }).count).toBe(1);
  });

  it("resolves schema by natural-language table name", async () => {
    const result = await executeDatabaseSchemaTool(auth, context, { table: "素材清單" });
    expect(result.verified).toBe(true);
    expect(result.value).toMatchObject({ status: "resolved", name: "素材清單" });
  });

  it("queries a resolved table and keeps source metadata", async () => {
    const result = await executeDatabaseQueryTool(auth, context, { table: "素材清單", keyword: "書法" });
    expect(queryMcpDatabase).toHaveBeenCalled();
    expect(result.value).toMatchObject({
      status: "resolved",
      mode: "table",
      tableId: table.id,
      returned: 1,
    });
    expect(result.evidence.some((item) => item.ref === "database-row:row-old")).toBe(true);
  });

  it("does a cross-database search when no table is specified", async () => {
    retrieveAssistantDatabaseEvidence.mockResolvedValue([{
      tableId: table.id,
      tableRef: "db1",
      tableName: "素材清單",
      rowId: "row-old",
      text: "標題: 書法",
      score: 0.9,
    }]);
    const result = await executeDatabaseQueryTool(auth, context, { keyword: "書法" });
    expect(result.value).toMatchObject({
      status: "resolved",
      mode: "cross_database",
      returned: 1,
      rows: [expect.objectContaining({ databaseId: table.id, rowId: "row-old", score: 0.9 })],
    });
  });

  it("fails closed on read-only agentAccess and does not write", async () => {
    getAgentReadableTable.mockResolvedValue({
      table,
      access: { canRead: true, canWriteRows: false, canManage: false },
    });
    await expect(executeDatabaseRowAddTool(auth, context, {
      table: "素材清單",
      data: { 標題: "王羲之", 分類: "書法" },
    })).rejects.toThrow("FORBIDDEN");
    expect(executeDatabaseWriteCommand).not.toHaveBeenCalled();
  });

  it("refuses unknown fields instead of silently discarding them", async () => {
    const result = await executeDatabaseRowAddTool(auth, context, {
      table: "素材清單",
      data: { 標題: "王羲之", 幻覺欄: "x" },
    });
    expect(result.value).toMatchObject({ status: "unknown_fields", unknown: ["幻覺欄"] });
    expect(executeDatabaseWriteCommand).not.toHaveBeenCalled();
    expect(result.verified).toBe(false);
  });

  it("adds a row through the write command and only verifies after read-back", async () => {
    selectRows.push({ id: "row-new", tableId: table.id, data: { title: "王羲之", kind: "書法" } });
    const result = await executeDatabaseRowAddTool(auth, context, {
      table: "素材清單",
      data: { 標題: "王羲之", 分類: "書法" },
    });
    expect(executeDatabaseWriteCommand).toHaveBeenCalledWith(expect.objectContaining({
      source: "agent",
      action: "addRow",
      tableId: table.id,
    }));
    expect(result.verified).toBe(true);
    expect(result.value).toMatchObject({ status: "verified", rowId: "row-new" });
  });

  it("does not mark an add complete when read-back mismatches", async () => {
    selectRows.push({ id: "row-new", tableId: table.id, data: { title: "wrong" } });
    const result = await executeDatabaseRowAddTool(auth, context, {
      table: "素材清單",
      data: { 標題: "王羲之" },
    });
    expect(result.verified).toBe(false);
    expect(result.value).toMatchObject({ status: "unverified" });
  });

  it("updates a recent row by merging fields and verifying new values", async () => {
    selectRows.push({ id: "row-old", tableId: table.id, data: { title: "王羲之", kind: "書法" } });
    executeDatabaseWriteCommand.mockImplementation(async (input: { data: Record<string, unknown> }) => {
      const next = { id: "row-old", tableId: table.id, data: input.data };
      selectRows.splice(0, selectRows.length, next);
      return next;
    });
    const first = await executeDatabaseRowUpdateTool(auth, context, {
      table: "素材清單",
      rowId: "row-old",
      data: { 分類: "完成" },
    });
    expect(first.verified).toBe(true);
    expect(executeDatabaseWriteCommand).toHaveBeenCalledWith(expect.objectContaining({
      action: "updateRow",
      rowId: "row-old",
      data: { title: "王羲之", kind: "完成" },
    }));
  });

  it("retries the same write through the runtime without a second command", async () => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = previousUrl || "postgres://localhost/test";
    selectRows.push({ id: "row-new", tableId: table.id, data: { title: "王羲之", kind: "書法" } });
    const registry = new ToolRegistry();
    for (const tool of agentDatabaseToolDefinitions(async () => auth)) registry.register(tool);
    const ledger = new InMemoryRunLedger();
    const runtime = new PracticalAutonomyRuntime(registry, ledger);
    await ledger.save({
      id: "run-1",
      goalId: "goal-1",
      planRevision: 1,
      status: "running",
      budgetPoints: 100,
      reservedPoints: 0,
      actualPoints: 0,
      updatedAt: new Date().toISOString(),
      userId: context.userId,
      groupId: context.groupId,
      projectId: context.projectId,
      steps: [{
        id: "step-1",
        toolId: "database.row.add",
        input: { table: "素材清單", data: { 標題: "王羲之", 分類: "書法" } },
        dependsOn: [],
        status: "pending",
        idempotencyKey: "pending",
        attemptCount: 0,
        reservedPoints: 0,
        actualPoints: 0,
      }],
    });
    try {
      const first = await runtime.executeStep("run-1", "step-1", {
        userId: context.userId,
        groupId: context.groupId,
        projectId: context.projectId,
        confirmed: true,
      });
      const second = await runtime.executeStep("run-1", "step-1", {
        userId: context.userId,
        groupId: context.groupId,
        projectId: context.projectId,
        confirmed: true,
      });
      expect(executeDatabaseWriteCommand).toHaveBeenCalledOnce();
      expect(first.verified).toBe(true);
      expect(second.verified).toBe(true);
      expect(first.receipt?.effectFingerprint).toBe(second.receipt?.effectFingerprint);
    } finally {
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    }
  });

  it("gets a row by table name without requiring a table UUID", async () => {
    selectRows.push({ id: "row-old", tableId: table.id, data: { title: "王羲之" } });
    const result = await executeDatabaseRowGetTool(auth, context, {
      table: "素材清單",
      rowId: "row-old",
    });
    expect(result.verified).toBe(true);
    expect(result.value).toMatchObject({ status: "resolved", rowId: "row-old", tableId: table.id });
  });

  it("gets a recent row without leaking a missing table", async () => {
    getAgentReadableTable.mockResolvedValue(null);
    const result = await executeDatabaseRowGetTool(auth, context, {
      tableId: "fffffff0-ffff-4fff-8fff-ffffffffffff",
      rowId: "row-old",
    });
    expect(result.verified).toBe(false);
    expect(result.value).toMatchObject({ status: "not_found" });
  });
});
