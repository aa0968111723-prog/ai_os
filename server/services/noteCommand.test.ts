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
const addNoteCore = vi.hoisted(() => vi.fn(async () => ({ id: "note-1", title: "筆記" })));
const appendNoteCore = vi.hoisted(() =>
  vi.fn(async () => ({ id: "note-1", title: "筆記", content: "a\nb" })),
);
const getNoteChecked = vi.hoisted(() => vi.fn());
const projectRow = vi.hoisted(() => ({
  id: "proj-1",
  groupId: "group-1",
  status: "active",
  title: "專案",
}));
const existingNote = vi.hoisted(() => ({
  id: "note-1",
  groupId: "group-1",
  projectId: "proj-1",
  title: "筆記",
  content: "a",
  createdBy: "user-1",
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

vi.mock("./notesCore", () => ({
  addNoteCore,
  appendNoteCore,
  getNoteChecked,
}));

vi.mock("../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => [projectRow],
      }),
    }),
  },
  schema: {
    projects: { id: "id", groupId: "groupId" },
  },
}));

import { executeNoteCommand } from "./noteCommand";

function auth(role: "admin" | "leader" | "member" = "member"): AuthState {
  return {
    user: {
      id: "user-1",
      name: "測試",
      email: "t@example.com",
      isSuperAdmin: false,
      mustChangePassword: false,
    },
    groups: [
      { groupId: "group-1", groupName: "組", teamId: "team-1", teamName: "隊", role },
    ],
    adminTeamIds: [],
  };
}

describe("executeNoteCommand", () => {
  beforeEach(() => {
    assertPolicy.mockReset().mockReturnValue({ allowed: true, requiresApproval: false });
    assertProjectAllows.mockReset();
    getProjectRole.mockReset().mockResolvedValue("editor");
    addNoteCore.mockReset().mockResolvedValue({ id: "note-1", title: "筆記" });
    appendNoteCore.mockReset().mockResolvedValue({ id: "note-1", title: "筆記", content: "a\nb" });
    getNoteChecked.mockReset().mockResolvedValue({ ...existingNote });
    projectRow.status = "active";
  });

  it("create：policy deny 時不呼叫 addNoteCore", async () => {
    assertPolicy.mockImplementation(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "沒有執行此操作的權限" });
    });

    await expect(
      executeNoteCommand({
        auth: auth(),
        source: "web",
        action: "create",
        groupId: "group-1",
        title: "標題",
        content: "內容",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "沒有執行此操作的權限",
    });
    expect(assertPolicy).toHaveBeenCalledWith(
      "note.create",
      expect.objectContaining({ groupId: "group-1" }),
    );
    expect(addNoteCore).not.toHaveBeenCalled();
  });

  it("create project-bound：封存擋 write，不呼叫 core", async () => {
    assertProjectAllows.mockImplementation(() => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "此專案已封存——請先在網頁端還原專案，或改用其他專案",
      });
    });

    await expect(
      executeNoteCommand({
        auth: auth(),
        source: "web",
        action: "create",
        groupId: "group-1",
        projectId: "proj-1",
        title: "標題",
        content: "內容",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /已封存/ });
    expect(assertPolicy).not.toHaveBeenCalled();
    expect(addNoteCore).not.toHaveBeenCalled();
  });

  it("append：policy note.append deny 時不呼叫 appendNoteCore", async () => {
    assertPolicy.mockImplementation(() => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "你在此專案是「檢視者」（唯讀）——要編輯請組長到專案權限卡調整",
      });
    });
    getProjectRole.mockResolvedValue("viewer");

    await expect(
      executeNoteCommand({
        auth: auth(),
        source: "agent",
        action: "append",
        id: "note-1",
        content: "追加",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: /檢視者/ });

    expect(assertProjectAllows).toHaveBeenCalledWith(projectRow, "write");
    expect(assertPolicy).toHaveBeenCalledWith(
      "note.append",
      expect.objectContaining({ projectId: "proj-1", source: "agent" }),
    );
    expect(appendNoteCore).not.toHaveBeenCalled();
  });

  it("create 允許時委託 addNoteCore", async () => {
    await executeNoteCommand({
      auth: auth(),
      source: "web",
      action: "create",
      groupId: "group-1",
      projectId: "proj-1",
      title: "標題",
      content: "內容",
    });
    expect(assertPolicy).toHaveBeenCalledWith("note.create", expect.any(Object));
    expect(addNoteCore).toHaveBeenCalledWith(
      expect.objectContaining({ title: "標題", content: "內容", projectId: "proj-1" }),
    );
  });
});
