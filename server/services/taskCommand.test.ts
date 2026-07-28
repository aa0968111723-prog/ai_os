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
const addProjectTaskCore = vi.hoisted(() => vi.fn(async () => ({ id: "task-1", title: "任務" })));
const projectRow = vi.hoisted(() => ({
  id: "proj-1",
  groupId: "group-1",
  status: "active",
  title: "專案",
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

vi.mock("./taskCore", () => ({
  addProjectTaskCore,
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

import { executeTaskCommand } from "./taskCommand";

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

describe("executeTaskCommand", () => {
  beforeEach(() => {
    assertPolicy.mockReset().mockReturnValue({ allowed: true, requiresApproval: false });
    assertProjectAllows.mockReset();
    getProjectRole.mockReset().mockResolvedValue("editor");
    addProjectTaskCore.mockReset().mockResolvedValue({ id: "task-1", title: "任務" });
    projectRow.status = "active";
    projectRow.groupId = "group-1";
  });

  it("policy task.create deny 時不呼叫 addProjectTaskCore", async () => {
    assertPolicy.mockImplementation(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "沒有執行此操作的權限" });
    });

    await expect(
      executeTaskCommand({
        auth: auth(),
        source: "agent",
        groupId: "group-1",
        projectId: "proj-1",
        title: "審稿",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "沒有執行此操作的權限",
    });
    expect(assertProjectAllows).toHaveBeenCalledWith(projectRow, "write");
    expect(assertPolicy).toHaveBeenCalledWith(
      "task.create",
      expect.objectContaining({ projectId: "proj-1", source: "agent" }),
    );
    expect(addProjectTaskCore).not.toHaveBeenCalled();
  });

  it("paused 專案 write 擋下，不呼叫 policy 與 core", async () => {
    assertProjectAllows.mockImplementation(() => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "此專案已暫停——目前不能發起新生成或自動派工，請先恢復專案",
      });
    });

    await expect(
      executeTaskCommand({
        auth: auth(),
        source: "web",
        groupId: "group-1",
        projectId: "proj-1",
        title: "審稿",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: /已暫停/ });
    expect(assertPolicy).not.toHaveBeenCalled();
    expect(addProjectTaskCore).not.toHaveBeenCalled();
  });

  it("允許時委託 addProjectTaskCore", async () => {
    const row = await executeTaskCommand({
      auth: auth("leader"),
      source: "agent",
      groupId: "group-1",
      projectId: "proj-1",
      title: "審稿",
      priority: "high",
    });
    expect(row).toEqual({ id: "task-1", title: "任務" });
    expect(assertProjectAllows).toHaveBeenCalledWith(projectRow, "write");
    expect(assertPolicy).toHaveBeenCalledWith("task.create", expect.any(Object));
    expect(addProjectTaskCore).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group-1",
        projectId: "proj-1",
        title: "審稿",
        priority: "high",
      }),
    );
  });
});
