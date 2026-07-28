import { describe, expect, it } from "vitest";
import type { MeWithCapabilities } from "../../capabilities";
import {
  accountMenuItems,
  filterNavItems,
  type NavFilterContext,
  type NavigationItem,
} from "./navigationItems";

const manageItems = accountMenuItems.filter((i) => i.section === "manage");

function keysOf(items: NavigationItem[]): string[] {
  return items.map((i) => i.key);
}

/** Policy-shaped me: mirrors capabilitiesForGroupRole for common roles */
function meForRoles(opts: {
  global?: string[];
  groups?: Record<string, string[]>;
}): NonNullable<MeWithCapabilities> {
  return {
    capabilities: opts.global ?? [],
    capabilitiesByGroupId: opts.groups ?? {},
  };
}

const LEADER_CAPS = [
  "audit.view",
  "database.read",
  "database.write",
  "generation.approve",
  "generation.submit",
  "group.manage_members",
  "note.write",
  "project.edit",
  "project.view",
  "agent.dispatch",
  "schedule.create",
  "task.create",
  "team.view",
];

const MEMBER_CAPS = [
  "database.read",
  "database.write",
  "generation.submit",
  "note.write",
  "project.edit",
  "project.view",
  "agent.dispatch",
  "schedule.create",
  "task.create",
  "team.view",
];

const FULL_CAPS = [
  "agent.dispatch",
  "audit.view",
  "database.read",
  "database.write",
  "generation.approve",
  "generation.submit",
  "group.manage_members",
  "note.write",
  "project.edit",
  "project.view",
  "schedule.create",
  "task.create",
  "team.manage",
  "team.view",
];

describe("filterNavItems (TD-05b)", () => {
  it("without capability data falls back to require flags", () => {
    const leaderOnly: NavFilterContext = {
      isAdmin: false,
      activeIsLeader: true,
      canSeeOrg: true,
      // me omitted → no capabilities
    };
    expect(keysOf(filterNavItems(manageItems, leaderOnly))).toEqual([
      "options",
      "members",
      "logs",
    ]);

    const admin: NavFilterContext = {
      isAdmin: true,
      activeIsLeader: true,
      canSeeOrg: true,
    };
    expect(keysOf(filterNavItems(manageItems, admin))).toEqual([
      "options",
      "members",
      "logs",
      "admin",
    ]);

    const member: NavFilterContext = {
      isAdmin: false,
      activeIsLeader: false,
      canSeeOrg: false,
    };
    expect(keysOf(filterNavItems(manageItems, member))).toEqual([]);
  });

  it("superAdmin (global full set) sees all manage items", () => {
    const ctx: NavFilterContext = {
      isAdmin: true,
      activeIsLeader: true,
      canSeeOrg: true,
      activeGroupId: "g1",
      me: meForRoles({ global: FULL_CAPS, groups: { g1: FULL_CAPS } }),
    };
    expect(keysOf(filterNavItems(manageItems, ctx))).toEqual([
      "options",
      "members",
      "logs",
      "admin",
    ]);
  });

  it("leader on active group sees options + org items, not admin", () => {
    const ctx: NavFilterContext = {
      isAdmin: false,
      activeIsLeader: true,
      canSeeOrg: true,
      activeGroupId: "g-lead",
      me: meForRoles({
        global: [],
        groups: {
          "g-lead": LEADER_CAPS,
          "g-member": MEMBER_CAPS,
        },
      }),
    };
    expect(keysOf(filterNavItems(manageItems, ctx))).toEqual([
      "options",
      "members",
      "logs",
    ]);
  });

  it("leader switched to member-only active group hides options but keeps org items", () => {
    // Regression: options is group-scoped; members/logs are any-group (canSeeOrg)
    const ctx: NavFilterContext = {
      isAdmin: false,
      activeIsLeader: false,
      canSeeOrg: true,
      activeGroupId: "g-member",
      me: meForRoles({
        global: [],
        groups: {
          "g-lead": LEADER_CAPS,
          "g-member": MEMBER_CAPS,
        },
      }),
    };
    expect(keysOf(filterNavItems(manageItems, ctx))).toEqual(["members", "logs"]);
  });

  it("plain member sees no manage items", () => {
    const ctx: NavFilterContext = {
      isAdmin: false,
      activeIsLeader: false,
      canSeeOrg: false,
      activeGroupId: "g1",
      me: meForRoles({ global: [], groups: { g1: MEMBER_CAPS } }),
    };
    expect(keysOf(filterNavItems(manageItems, ctx))).toEqual([]);
  });

  it("team admin global team.manage shows admin entry", () => {
    const ctx: NavFilterContext = {
      isAdmin: true,
      activeIsLeader: true,
      canSeeOrg: true,
      activeGroupId: "g1",
      me: meForRoles({
        global: ["team.view", "team.manage"],
        groups: { g1: FULL_CAPS },
      }),
    };
    expect(keysOf(filterNavItems(manageItems, ctx))).toContain("admin");
    expect(keysOf(filterNavItems(manageItems, ctx))).toContain("options");
  });

  it("UI-only directory.view falls back to canSeeOrg require flag", () => {
    // members capability is directory.view (not in Policy) → require org
    const noOrg: NavFilterContext = {
      isAdmin: false,
      activeIsLeader: false,
      canSeeOrg: false,
      activeGroupId: "g1",
      // even with full policy caps, directory.view is unknown → require
      me: meForRoles({ global: [], groups: { g1: MEMBER_CAPS } }),
    };
    expect(keysOf(filterNavItems(manageItems, noOrg))).not.toContain("members");

    const org: NavFilterContext = {
      isAdmin: false,
      activeIsLeader: false,
      canSeeOrg: true,
      activeGroupId: "g1",
      // no audit.view / group.manage_members in me — still shows members via require
      me: meForRoles({ global: [], groups: { g1: MEMBER_CAPS } }),
    };
    expect(keysOf(filterNavItems(manageItems, org))).toContain("members");
  });

  it("ungated items always pass", () => {
    const help = accountMenuItems.filter((i) => i.section === "help");
    const ctx: NavFilterContext = {
      isAdmin: false,
      activeIsLeader: false,
      canSeeOrg: false,
      me: meForRoles({ global: [], groups: {} }),
    };
    expect(keysOf(filterNavItems(help, ctx))).toEqual(["help", "models"]);
  });
});
