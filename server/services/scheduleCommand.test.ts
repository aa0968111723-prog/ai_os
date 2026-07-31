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
const addScheduleItemCore = vi.hoisted(() => vi.fn(async () => ({ id: "sched-1", title: "會議" })));
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

vi.mock("./scheduleCore", () => ({
  addScheduleItemCore,
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

import { executeScheduleCommand } from "./scheduleCommand";

function auth(role: "admin" | "leader" | "member" = "member"): AuthState {
  return {
    user: {
      id: "user-1",
      name: "測試",
      email: "t@example.com",
      isSuperAdmin: false,
      mustChangePassword: false,
    uiDensity: null,
    },
    groups: [
      { groupId: "group-1", groupName: "組", teamId: "team-1", teamName: "隊", role },
    ],
    adminTeamIds: [],
  };
}

const baseInput = {
  groupId: "group-1",
  title: "週會",
  startsAt: "2026-08-01T10:00:00.000Z",
};

describe("executeScheduleCommand", () => {
  beforeEach(() => {
    assertPolicy.mockReset().mockReturnValue({ allowed: true, requiresApproval: false });
    assertProjectAllows.mockReset();
    getProjectRole.mockReset().mockResolvedValue("editor");
    addScheduleItemCore.mockReset().mockResolvedValue({ id: "sched-1", title: "會議" });
    projectRow.status = "active";
    projectRow.groupId = "group-1";
  });

  it("policy deny 時不呼叫 core，並保留錯誤訊息", async () => {
    assertPolicy.mockImplementation(() => {
      throw new TRPCError({ code: "FORBIDDEN", message: "沒有執行此操作的權限" });
    });

    await expect(
      executeScheduleCommand({ auth: auth(), source: "web", ...baseInput }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "沒有執行此操作的權限",
    });
    expect(addScheduleItemCore).not.toHaveBeenCalled();
    expect(assertPolicy).toHaveBeenCalledWith(
      "schedule.create",
      expect.objectContaining({ groupId: "group-1", source: "web" }),
    );
  });

  it("project-bound viewer deny：assertPolicy 拒絕且不寫入", async () => {
    getProjectRole.mockResolvedValue("viewer");
    assertPolicy.mockImplementation(() => {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "你在此專案是「檢視者」（唯讀）——要編輯請組長到專案權限卡調整",
      });
    });

    await expect(
      executeScheduleCommand({
        auth: auth(),
        source: "web",
        ...baseInput,
        projectId: "proj-1",
      }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: /檢視者/,
    });
    expect(assertProjectAllows).toHaveBeenCalledWith(projectRow, "write");
    expect(addScheduleItemCore).not.toHaveBeenCalled();
  });

  it("archived 專案：assertProjectAllows 擋下，不呼叫 core", async () => {
    assertProjectAllows.mockImplementation(() => {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "此專案已封存——請先在網頁端還原專案，或改用其他專案",
      });
    });

    await expect(
      executeScheduleCommand({
        auth: auth(),
        source: "web",
        ...baseInput,
        projectId: "proj-1",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: /已封存/,
    });
    expect(assertPolicy).not.toHaveBeenCalled();
    expect(addScheduleItemCore).not.toHaveBeenCalled();
  });

  it("允許時委託 addScheduleItemCore", async () => {
    const row = await executeScheduleCommand({
      auth: auth("leader"),
      source: "web",
      ...baseInput,
      projectId: "proj-1",
      note: "備註",
    });
    expect(row).toEqual({ id: "sched-1", title: "會議" });
    expect(assertProjectAllows).toHaveBeenCalledWith(projectRow, "write");
    expect(assertPolicy).toHaveBeenCalledWith("schedule.create", expect.any(Object));
    expect(addScheduleItemCore).toHaveBeenCalledWith(
      expect.objectContaining({
        groupId: "group-1",
        projectId: "proj-1",
        title: "週會",
        note: "備註",
      }),
    );
  });
});
