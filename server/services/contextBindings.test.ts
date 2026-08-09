import { describe, expect, it } from "vitest";
import { contextTableDenyReason } from "./contextBindings";
import type { AuthState } from "./auth";

/**
 * Context Binding 的守門（驗收案例 E）。
 *
 * Context 是一條**新的**「這份資料算不算這個專案的」路徑——也就是最可能把
 * 個人私有資料意外拉進共享 AI 的地方。這裡逐條釘死，與
 * `projectDataBindings.test.ts` 對 project_data_bindings 的把關同一口徑。
 */

const U = {
  me: "11111111-1111-4111-8111-111111111111",
  other: "22222222-2222-4222-8222-222222222222",
  groupA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  groupB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  team1: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  project: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
};

function auth(over: Partial<AuthState> = {}): AuthState {
  return {
    user: { id: U.me, name: "我", email: "me@x", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId: U.groupA, groupName: "A", teamId: U.team1, teamName: "T1", role: "member" }],
    adminTeamIds: [],
    ...over,
  } as AuthState;
}

function table(over: Partial<Parameters<typeof contextTableDenyReason>[1]> = {}) {
  return {
    scope: "group" as const,
    ownerId: null as string | null,
    groupId: U.groupA,
    teamId: null as string | null,
    memberWritable: true,
    createdBy: U.other,
    ...over,
  };
}

const project = { id: U.project, groupId: U.groupA };

describe("contextTableDenyReason", () => {
  it("同組的組資料表可以加入專案脈絡", () => {
    expect(contextTableDenyReason(auth(), table(), project)).toBeNull();
  });

  it("★ 個人資料表永遠不可加入專案脈絡——連擁有者本人也不行", () => {
    const personal = table({ scope: "personal", ownerId: U.me, groupId: null });
    const reason = contextTableDenyReason(auth(), personal, project);
    expect(reason).not.toBeNull();
    // 理由要講得出「為什麼」與「怎麼辦」
    expect(reason).toContain("只有你看得到");
    expect(reason).toContain("組共用");
  });

  it("★ 別組的表不可加入——訊息不得洩漏「存在但你看不到」", () => {
    const foreign = table({ groupId: U.groupB });
    // 對不是成員的組，連讀取權都沒有 → 回「找不到」，不是「你沒有權限」
    expect(contextTableDenyReason(auth(), foreign, project)).toBe("找不到這份資料");
  });

  it("★ 有讀取權但屬於別組的表，仍不可綁進這個專案", () => {
    const other = auth({
      groups: [
        { groupId: U.groupA, groupName: "A", teamId: U.team1, teamName: "T1", role: "member" },
        { groupId: U.groupB, groupName: "B", teamId: U.team1, teamName: "T1", role: "member" },
      ],
    });
    expect(contextTableDenyReason(other, table({ groupId: U.groupB }), project)).toContain("別的組");
  });

  it("團隊與全站範圍可以加入（範圍本來就涵蓋這個專案的成員）", () => {
    expect(contextTableDenyReason(auth(), table({ scope: "team", teamId: U.team1, groupId: null }), project)).toBeNull();
    expect(contextTableDenyReason(auth(), table({ scope: "global", groupId: null }), project)).toBeNull();
  });

  it("看不到的表回「找不到」，不是「不能加入」", () => {
    const notMine = table({ scope: "personal", ownerId: U.other, groupId: null });
    expect(contextTableDenyReason(auth(), notMine, project)).toBe("找不到這份資料");
  });

  it("未知範圍一律拒絕（預設關閉，不是預設放行）", () => {
    const weird = { ...table(), scope: "whatever" } as unknown as Parameters<typeof contextTableDenyReason>[1];
    expect(contextTableDenyReason(auth({ user: { ...auth().user, isSuperAdmin: true } }), weird, project)).not.toBeNull();
  });
});
