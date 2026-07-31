import { beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import type { AuthState } from "./auth";

const assertPolicy = vi.hoisted(() => vi.fn());
const policyContextFromAuth = vi.hoisted(() =>
  vi.fn((auth: AuthState, opts: {
    groupId?: string;
    projectId?: string;
    source: string;
    projectRole?: string | null;
  }) => ({
    actorId: auth.user.id,
    groupId: opts.groupId,
    projectId: opts.projectId,
    source: opts.source,
    projectRole: opts.projectRole ?? "editor",
    groupRole: auth.groups.find((g) => g.groupId === opts.groupId)?.role ?? null,
  })),
);
const assertProjectAllows = vi.hoisted(() => vi.fn());
const getProjectRole = vi.hoisted(() => vi.fn(async (): Promise<"editor" | "viewer"> => "editor"));
const resolveTableAccess = vi.hoisted(() =>
  vi.fn(() => ({ canRead: true, canWriteRows: true, canManage: true })),
);
const addDataRowValidated = vi.hoisted(() =>
  vi.fn(async () => ({ id: "row-1", tableId: "table-1", data: { name: "x" } })),
);
const updateDataRowValidated = vi.hoisted(() =>
  vi.fn(async () => ({ id: "row-1", tableId: "table-1", data: { name: "y" } })),
);

const groupTable = vi.hoisted(() => ({
  id: "table-1",
  scope: "group" as const,
  groupId: "group-1",
  teamId: null as string | null,
  ownerId: null as string | null,
  fields: [{ key: "name", label: "名稱", type: "text" }],
  memberWritable: true,
  createdBy: "user-1",
  deletedAt: null,
}));

const personalTable = vi.hoisted(() => ({
  id: "table-personal",
  scope: "personal" as const,
  groupId: null as string | null,
  teamId: null as string | null,
  ownerId: "user-1",
  fields: [{ key: "name", label: "名稱", type: "text" }],
  memberWritable: true,
  createdBy: "user-1",
  deletedAt: null,
}));

const projectRow = vi.hoisted(() => ({
  id: "proj-1",
  groupId: "group-1",
  status: "active",
  title: "專案",
}));

const existingDataRow = vi.hoisted(() => ({
  id: "row-1",
  tableId: "table-1",
  data: { name: "old" },
  createdBy: "user-1",
}));

/** 依 schema 表別回傳 mock 查詢結果 */
const selectResults = vi.hoisted(() => ({
  dataTables: [groupTable] as unknown[],
  projects: [projectRow] as unknown[],
  dataRows: [existingDataRow] as unknown[],
}));

vi.mock("./policyEngine", () => ({
  assertPolicy,
  policyContextFromAuth,
}));

vi.mock("./projectState", () => ({
  assertProjectAllows,
}));

vi.mock("./projectAcl", () => ({
  getProjectRole,
}));

vi.mock("./databaseAcl", () => ({
  resolveTableAccess,
}));

vi.mock("./databaseCore", () => ({
  addDataRowValidated,
  updateDataRowValidated,
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: (table: { __name?: string } | unknown) => {
        const name =
          table && typeof table === "object" && "__name" in table
            ? String((table as { __name: string }).__name)
            : "";
        return {
          where: async () => {
            if (name === "projects") return selectResults.projects;
            if (name === "dataRows") return selectResults.dataRows;
            return selectResults.dataTables;
          },
        };
      },
    }),
  },
  schema: {
    dataTables: { id: "id", deletedAt: "deletedAt", __name: "dataTables" },
    projects: { id: "id", groupId: "groupId", __name: "projects" },
    dataRows: { id: "id", tableId: "tableId", __name: "dataRows" },
  },
}));

import { executeDatabaseWriteCommand } from "./databaseCommand";

function auth(role: "admin" | "leader" | "member" = "member"): AuthState {
  return {
    user: {
      id: "user-1",
      name: "測試",
      email: "t@example.com",
      isSuperAdmin: false,
      mustChangePassword: false, uiDensity: null,
    },
    groups: [
      { groupId: "group-1", groupName: "組", teamId: "team-1", teamName: "隊", role },
    ],
    adminTeamIds: [],
  };
}

describe("executeDatabaseWriteCommand", () => {
  beforeEach(() => {
    assertPolicy.mockReset().mockReturnValue({ allowed: true, requiresApproval: false });
    assertProjectAllows.mockReset();
    getProjectRole.mockReset().mockResolvedValue("editor");
    resolveTableAccess.mockReset().mockReturnValue({
      canRead: true,
      canWriteRows: true,
      canManage: true,
    });
    addDataRowValidated.mockReset().mockResolvedValue({
      id: "row-1",
      tableId: "table-1",
      data: { name: "x" },
    });
    updateDataRowValidated.mockReset().mockResolvedValue({
      id: "row-1",
      tableId: "table-1",
      data: { name: "y" },
    });
    selectResults.dataTables = [groupTable];
    selectResults.projects = [projectRow];
    selectResults.dataRows = [existingDataRow];
    projectRow.status = "active";
    projectRow.groupId = "group-1";
  });

  it("addRow：policy deny 時不呼叫 addDataRowValidated", async () => {
    assertPolicy.mockImplementation(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "沒有執行此操作的權限" });
    });

    await expect(
      executeDatabaseWriteCommand({
        auth: auth(),
        source: "web",
        action: "addRow",
        tableId: "table-1",
        data: { name: "x" },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "沒有執行此操作的權限",
    });
    expect(assertPolicy).toHaveBeenCalledWith(
      "database.write",
      expect.objectContaining({ groupId: "group-1", source: "web" }),
    );
    expect(addDataRowValidated).not.toHaveBeenCalled();
  });

  it("addRow project-bound：封存擋 write，不呼叫 core", async () => {
    assertProjectAllows.mockImplementation(() => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "此專案已封存——請先在網頁端還原專案，或改用其他專案",
      });
    });

    await expect(
      executeDatabaseWriteCommand({
        auth: auth(),
        source: "web",
        action: "addRow",
        tableId: "table-1",
        data: { name: "x" },
        projectId: "proj-1",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /已封存/ });
    expect(assertProjectAllows).toHaveBeenCalledWith(projectRow, "write");
    expect(assertPolicy).not.toHaveBeenCalled();
    expect(addDataRowValidated).not.toHaveBeenCalled();
  });

  it("addRow project-bound：viewer deny database.write，不呼叫 core", async () => {
    assertPolicy.mockImplementation(() => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "你在此專案是「檢視者」（唯讀）——要編輯請組長到專案權限卡調整",
      });
    });
    getProjectRole.mockResolvedValue("viewer");

    await expect(
      executeDatabaseWriteCommand({
        auth: auth(),
        source: "agent",
        action: "addRow",
        tableId: "table-1",
        data: { name: "x" },
        projectId: "proj-1",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: /檢視者/ });

    expect(assertProjectAllows).toHaveBeenCalledWith(projectRow, "write");
    expect(assertPolicy).toHaveBeenCalledWith(
      "database.write",
      expect.objectContaining({ projectId: "proj-1", source: "agent" }),
    );
    expect(addDataRowValidated).not.toHaveBeenCalled();
  });

  it("addRow 允許時委託 addDataRowValidated", async () => {
    const row = await executeDatabaseWriteCommand({
      auth: auth(),
      source: "web",
      action: "addRow",
      tableId: "table-1",
      data: { name: "x" },
      projectId: "proj-1",
    });
    expect(row).toEqual({ id: "row-1", tableId: "table-1", data: { name: "x" } });
    expect(assertPolicy).toHaveBeenCalledWith("database.write", expect.any(Object));
    expect(addDataRowValidated).toHaveBeenCalledWith(
      groupTable,
      "user-1",
      { name: "x" },
      undefined,
    );
  });

  it("addRow 個人庫（無組）：不呼叫 assertPolicy，只走 table ACL + core", async () => {
    selectResults.dataTables = [personalTable];

    await executeDatabaseWriteCommand({
      auth: auth(),
      source: "web",
      action: "addRow",
      tableId: "table-personal",
      data: { name: "私人" },
    });

    expect(assertPolicy).not.toHaveBeenCalled();
    expect(assertProjectAllows).not.toHaveBeenCalled();
    expect(addDataRowValidated).toHaveBeenCalledWith(
      personalTable,
      "user-1",
      { name: "私人" },
      undefined,
    );
  });

  it("addRow canWriteRows=false 時不呼叫 core", async () => {
    resolveTableAccess.mockReturnValue({
      canRead: true,
      canWriteRows: false,
      canManage: false,
    });

    await expect(
      executeDatabaseWriteCommand({
        auth: auth(),
        source: "web",
        action: "addRow",
        tableId: "table-1",
        data: { name: "x" },
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: /只開放管理者寫入/,
    });
    expect(assertPolicy).not.toHaveBeenCalled();
    expect(addDataRowValidated).not.toHaveBeenCalled();
  });

  it("updateRow：policy deny 時不呼叫 updateDataRowValidated", async () => {
    assertPolicy.mockImplementation(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "沒有執行此操作的權限" });
    });

    await expect(
      executeDatabaseWriteCommand({
        auth: auth(),
        source: "web",
        action: "updateRow",
        rowId: "row-1",
        data: { name: "y" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(assertPolicy).toHaveBeenCalledWith(
      "database.write",
      expect.objectContaining({ groupId: "group-1" }),
    );
    expect(updateDataRowValidated).not.toHaveBeenCalled();
  });

  it("updateRow 允許時委託 updateDataRowValidated", async () => {
    const row = await executeDatabaseWriteCommand({
      auth: auth(),
      source: "web",
      action: "updateRow",
      rowId: "row-1",
      data: { name: "y" },
    });
    expect(row).toEqual({ id: "row-1", tableId: "table-1", data: { name: "y" } });
    expect(updateDataRowValidated).toHaveBeenCalledWith(
      groupTable,
      "row-1",
      "user-1",
      { name: "y" },
    );
  });
});
