import { describe, expect, it } from "vitest";
import { canCreateIn, resolveAgentAccess, resolveTableAccess } from "./databaseAcl";
import type { AuthState } from "./auth";

const U = {
  me: "11111111-1111-1111-1111-111111111111",
  other: "22222222-2222-2222-2222-222222222222",
  groupA: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  groupB: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  team1: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  team2: "dddddddd-dddd-dddd-dddd-dddddddddddd",
};

function auth(over: Partial<AuthState> = {}): AuthState {
  return {
    user: { id: U.me, name: "我", email: "me@x", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId: U.groupA, groupName: "A", teamId: U.team1, teamName: "T1", role: "member" }],
    adminTeamIds: [],
    ...over,
  };
}

function table(over: Partial<Parameters<typeof resolveTableAccess>[1]> = {}) {
  return { scope: "personal" as const, ownerId: U.me, groupId: null, teamId: null, memberWritable: true, createdBy: U.me, ...over };
}

describe("resolveTableAccess", () => {
  it("personal：只有本人；超管也不行", () => {
    expect(resolveTableAccess(auth(), table())).toEqual({ canRead: true, canWriteRows: true, canManage: true });
    const stranger = auth({ user: { ...auth().user, id: U.other, isSuperAdmin: true } });
    expect(resolveTableAccess(stranger, table()).canRead).toBe(false);
  });

  it("group：組員可讀可寫、不可管理；組長全開；非本組全擋", () => {
    const t = table({ scope: "group", ownerId: null, groupId: U.groupA, createdBy: U.other });
    expect(resolveTableAccess(auth(), t)).toEqual({ canRead: true, canWriteRows: true, canManage: false });
    const leader = auth({ groups: [{ ...auth().groups[0], role: "leader" }] });
    expect(resolveTableAccess(leader, t).canManage).toBe(true);
    const outsider = auth({ groups: [{ ...auth().groups[0], groupId: U.groupB }] });
    expect(resolveTableAccess(outsider, t).canRead).toBe(false);
  });

  it("group：memberWritable=false 時組員唯讀，但建立者仍可寫可管理", () => {
    const locked = table({ scope: "group", ownerId: null, groupId: U.groupA, memberWritable: false, createdBy: U.other });
    expect(resolveTableAccess(auth(), locked)).toEqual({ canRead: true, canWriteRows: false, canManage: false });
    const asCreator = table({ scope: "group", ownerId: null, groupId: U.groupA, memberWritable: false, createdBy: U.me });
    expect(resolveTableAccess(auth(), asCreator)).toEqual({ canRead: true, canWriteRows: true, canManage: true });
  });

  it("team：同團隊任一組成員可讀；管理限團隊管理員；他團隊全擋", () => {
    const t = table({ scope: "team", ownerId: null, teamId: U.team1, createdBy: U.other });
    expect(resolveTableAccess(auth(), t)).toEqual({ canRead: true, canWriteRows: true, canManage: false });
    const admin = auth({ adminTeamIds: [U.team1] });
    expect(resolveTableAccess(admin, t).canManage).toBe(true);
    const otherTeam = auth({ groups: [{ ...auth().groups[0], teamId: U.team2 }] });
    expect(resolveTableAccess(otherTeam, t).canRead).toBe(false);
  });

  it("global：人人可讀；鎖寫時只有超管能寫；管理限超管", () => {
    const t = table({ scope: "global", ownerId: null, memberWritable: false, createdBy: U.other });
    expect(resolveTableAccess(auth(), t)).toEqual({ canRead: true, canWriteRows: false, canManage: false });
    const superAdmin = auth({ user: { ...auth().user, isSuperAdmin: true } });
    expect(resolveTableAccess(superAdmin, t)).toEqual({ canRead: true, canWriteRows: true, canManage: true });
  });
});

describe("resolveAgentAccess（AI/MCP 介面權限＝本人權限 ∩ agentAccess）", () => {
  const groupTable = (agentAccess: "none" | "read" | "write") =>
    ({ ...table({ scope: "group", ownerId: null, groupId: U.groupA, createdBy: U.other }), agentAccess });

  it("write：跟本人一致，但永不可管理", () => {
    expect(resolveAgentAccess(auth(), groupTable("write"))).toEqual({ canRead: true, canWriteRows: true, canManage: false });
    const leader = auth({ groups: [{ ...auth().groups[0], role: "leader" }] });
    expect(resolveAgentAccess(leader, groupTable("write")).canManage).toBe(false);
  });

  it("read：本人可寫也擋 AI 寫", () => {
    expect(resolveAgentAccess(auth(), groupTable("read"))).toEqual({ canRead: true, canWriteRows: false, canManage: false });
  });

  it("none：AI 完全看不到；本人無權時 agentAccess 也放不寬", () => {
    expect(resolveAgentAccess(auth(), groupTable("none")).canRead).toBe(false);
    const outsider = auth({ groups: [{ ...auth().groups[0], groupId: U.groupB }] });
    expect(resolveAgentAccess(outsider, groupTable("write")).canRead).toBe(false);
  });
});

describe("canCreateIn", () => {
  it("personal 人人可建；group/team 要是成員；global 限超管", () => {
    expect(canCreateIn(auth(), "personal")).toBeNull();
    expect(canCreateIn(auth(), "group", U.groupA)).toBeNull();
    expect(canCreateIn(auth(), "group", U.groupB)).toContain("不屬於");
    expect(canCreateIn(auth(), "team", null, U.team1)).toBeNull();
    expect(canCreateIn(auth(), "team", null, U.team2)).toContain("不屬於");
    expect(canCreateIn(auth(), "global")).toContain("超級管理員");
    expect(canCreateIn(auth({ user: { ...auth().user, isSuperAdmin: true } }), "global")).toBeNull();
  });
});
