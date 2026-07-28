import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import type { AuthState } from "./auth";
import {
  assertPolicy,
  authMeCapabilities,
  capabilitiesByGroupFromAuth,
  capabilitiesForGroupRole,
  evaluatePolicy,
  globalCapabilitiesFromAuth,
  type PolicyAction,
  type PolicyContext,
} from "./policyEngine";
import { assertProjectAllows, projectStateAllows, normalizeProjectState } from "./projectState";
import { readProcessRole, shouldRunHttp, shouldRunWorkers } from "./processRole";

function ctx(partial: Partial<PolicyContext> & Pick<PolicyContext, "groupRole">): PolicyContext {
  return {
    actorId: "user-1",
    source: "web",
    projectRole: "editor",
    ...partial,
  };
}

describe("Policy Engine — capability mapping", () => {
  it("member editor can submit generation but not approve", () => {
    const caps = capabilitiesForGroupRole("member", { projectRole: "editor" });
    expect(caps.has("generation.submit")).toBe(true);
    expect(caps.has("generation.approve")).toBe(false);
    expect(caps.has("project.edit")).toBe(true);
  });

  it("member viewer cannot write", () => {
    const caps = capabilitiesForGroupRole("member", { projectRole: "viewer" });
    expect(caps.has("generation.submit")).toBe(false);
    expect(caps.has("project.view")).toBe(true);
    expect(caps.has("database.read")).toBe(true);
  });

  it("leader can approve and manage members", () => {
    const caps = capabilitiesForGroupRole("leader");
    expect(caps.has("generation.approve")).toBe(true);
    expect(caps.has("group.manage_members")).toBe(true);
    expect(caps.has("team.manage")).toBe(false);
  });

  it("superAdmin gets full caps without group role", () => {
    const caps = capabilitiesForGroupRole(null, { isSuperAdmin: true });
    expect(caps.has("team.manage")).toBe(true);
    expect(caps.has("generation.submit")).toBe(true);
  });
});

describe("Policy Engine — auth.me capability payload (TD-05a)", () => {
  const baseUser = {
    id: "u1",
    name: "測試",
    email: "t@example.com",
    isSuperAdmin: false,
    mustChangePassword: false,
  };

  function auth(over: Partial<AuthState> = {}): AuthState {
    return {
      user: baseUser,
      groups: [
        { groupId: "g-member", groupName: "組員組", teamId: "t1", teamName: "隊", role: "member" },
        { groupId: "g-leader", groupName: "組長組", teamId: "t1", teamName: "隊", role: "leader" },
        { groupId: "g-admin", groupName: "管理組", teamId: "t1", teamName: "隊", role: "admin" },
      ],
      adminTeamIds: [],
      ...over,
    };
  }

  it("maps each group to sorted unique capability arrays (stable keys)", () => {
    const byGroup = capabilitiesByGroupFromAuth(auth());
    expect(Object.keys(byGroup).sort()).toEqual(["g-admin", "g-leader", "g-member"]);

    expect(byGroup["g-member"]).toEqual([...byGroup["g-member"]].sort());
    expect(byGroup["g-member"]).toContain("generation.submit");
    expect(byGroup["g-member"]).not.toContain("generation.approve");
    expect(byGroup["g-member"]).not.toContain("group.manage_members");

    expect(byGroup["g-leader"]).toContain("generation.approve");
    expect(byGroup["g-leader"]).toContain("group.manage_members");
    expect(byGroup["g-leader"]).not.toContain("team.manage");

    expect(byGroup["g-admin"]).toContain("team.manage");
    expect(byGroup["g-admin"]).toContain("audit.view");
  });

  it("team admin on membership team gets full caps for that group", () => {
    const byGroup = capabilitiesByGroupFromAuth(
      auth({ adminTeamIds: ["t1"] }),
    );
    expect(byGroup["g-member"]).toContain("team.manage");
    expect(byGroup["g-member"]).toContain("generation.approve");
  });

  it("global capabilities: superAdmin full set; team admin team.manage; plain empty", () => {
    expect(globalCapabilitiesFromAuth(auth())).toEqual([]);
    expect(globalCapabilitiesFromAuth(auth({ adminTeamIds: ["t1"] }))).toEqual(
      ["team.manage", "team.view"].sort(),
    );
    const superCaps = globalCapabilitiesFromAuth(
      auth({ user: { ...baseUser, isSuperAdmin: true }, groups: [], adminTeamIds: [] }),
    );
    expect(superCaps).toContain("team.manage");
    expect(superCaps).toContain("generation.submit");
    expect(superCaps).toEqual([...superCaps].sort());
  });

  it("authMeCapabilities shape is stable for me response", () => {
    const payload = authMeCapabilities(auth());
    expect(payload).toEqual({
      capabilitiesByGroupId: capabilitiesByGroupFromAuth(auth()),
      capabilities: globalCapabilitiesFromAuth(auth()),
    });
  });
});

describe("Policy Engine — multi-entry matrix (TD-00 baseline)", () => {
  const actions: PolicyAction[] = ["generation.submit", "project.edit", "generation.approve"];
  const sources = ["web", "rest", "mcp", "workflow", "agent", "system"] as const;

  it("same actor/action yields identical allow across all sources", () => {
    for (const action of actions) {
      for (const source of sources) {
        const member = evaluatePolicy(action, ctx({ groupRole: "member", source, projectRole: "editor" }));
        const leader = evaluatePolicy(action, ctx({ groupRole: "leader", source, projectRole: "editor" }));
        if (action === "generation.approve") {
          expect(member.allowed).toBe(false);
          expect(leader.allowed).toBe(true);
        } else {
          expect(member.allowed).toBe(true);
          expect(leader.allowed).toBe(true);
        }
      }
    }
  });

  it("viewer is denied write actions on every source", () => {
    for (const source of sources) {
      const d = evaluatePolicy(
        "generation.submit",
        ctx({ groupRole: "member", projectRole: "viewer", source }),
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toMatch(/檢視者/);
    }
  });

  it("member cost threshold sets requiresApproval without denying", () => {
    const d = evaluatePolicy(
      "generation.submit",
      ctx({
        groupRole: "member",
        estimatedPoints: 10,
        approvalThresholdPoints: 5,
      }),
    );
    expect(d.allowed).toBe(true);
    expect(d.requiresApproval).toBe(true);

    const under = evaluatePolicy(
      "generation.submit",
      ctx({ groupRole: "member", estimatedPoints: 3, approvalThresholdPoints: 5 }),
    );
    expect(under.requiresApproval).toBe(false);

    const leader = evaluatePolicy(
      "generation.submit",
      ctx({ groupRole: "leader", estimatedPoints: 100, approvalThresholdPoints: 5 }),
    );
    expect(leader.requiresApproval).toBe(false);
  });

  it("non-member without admin is denied group-bound actions", () => {
    const d = evaluatePolicy("generation.submit", ctx({ groupRole: null }));
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/不屬於這個組/);
  });

  it("assertPolicy throws TRPCError on deny", () => {
    expect(() =>
      assertPolicy("generation.approve", ctx({ groupRole: "member" })),
    ).toThrow(TRPCError);
  });
});

describe("Project State Machine (TD-03)", () => {
  it("normalizes unknown to active", () => {
    expect(normalizeProjectState(undefined)).toBe("active");
    expect(normalizeProjectState("weird")).toBe("active");
    expect(normalizeProjectState("archived")).toBe("archived");
    expect(normalizeProjectState("paused")).toBe("paused");
  });

  it("archived blocks write/generate/approve; allows read/export/restore", () => {
    expect(projectStateAllows("archived", "read")).toBe(true);
    expect(projectStateAllows("archived", "export")).toBe(true);
    expect(projectStateAllows("archived", "restore")).toBe(true);
    expect(projectStateAllows("archived", "write")).toBe(false);
    expect(projectStateAllows("archived", "generate")).toBe(false);
    expect(projectStateAllows("archived", "approve")).toBe(false);
  });

  it("paused blocks generate/write; allows approve and read", () => {
    expect(projectStateAllows("paused", "generate")).toBe(false);
    expect(projectStateAllows("paused", "write")).toBe(false);
    expect(projectStateAllows("paused", "approve")).toBe(true);
    expect(projectStateAllows("paused", "read")).toBe(true);
  });

  it("assertProjectAllows throws human messages", () => {
    expect(() => assertProjectAllows({ status: "archived" }, "generate")).toThrow(/已封存/);
    expect(() => assertProjectAllows({ status: "paused" }, "generate")).toThrow(/已暫停/);
    expect(() => assertProjectAllows({ status: "active" }, "generate")).not.toThrow();
  });
});

describe("PROCESS_ROLE (TD-07)", () => {
  it("defaults to all", () => {
    expect(readProcessRole({})).toBe("all");
    expect(shouldRunHttp("all")).toBe(true);
    expect(shouldRunWorkers("all")).toBe(true);
  });

  it("web skips workers; worker skips nothing in shouldRunWorkers", () => {
    expect(shouldRunWorkers("web")).toBe(false);
    expect(shouldRunHttp("web")).toBe(true);
    expect(shouldRunWorkers("worker")).toBe(true);
    expect(shouldRunHttp("worker")).toBe(false);
  });

  it("unknown falls back to all", () => {
    expect(readProcessRole({ PROCESS_ROLE: "banana" } as NodeJS.ProcessEnv)).toBe("all");
  });
});
