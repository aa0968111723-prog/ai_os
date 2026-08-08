import { describe, expect, it } from "vitest";
import { bindableDenyReason, BINDABLE_RESOURCE_KINDS } from "./projectDataBindings";
import type { AuthState } from "./auth";

/**
 * 綁定守門（P4）。
 *
 * 這支測試守的是 docs/data-hub-current-state-2026-08.md §14 的不變量與 §43：
 * 「個人資料表永遠不得被共享的專案助手／團隊助手／組 AI 取得。」
 *
 * 綁定是一條**新的**「這份資料算不算這個專案的」路徑，所以它是最可能把個人庫
 * 意外拉進共享情境的地方。這裡逐條釘死。
 */

const U = {
  me: "11111111-1111-4111-8111-111111111111",
  other: "22222222-2222-4222-8222-222222222222",
  groupA: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  groupB: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  team1: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  team2: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  project: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
};

function auth(over: Partial<AuthState> = {}): AuthState {
  return {
    user: { id: U.me, name: "我", email: "me@x", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId: U.groupA, groupName: "A", teamId: U.team1, teamName: "T1", role: "member" }],
    adminTeamIds: [],
    ...over,
  };
}

function table(over: Partial<Parameters<typeof bindableDenyReason>[1]> = {}) {
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

describe("bindableDenyReason", () => {
  it("同組的組資料表可以提供給專案", () => {
    expect(bindableDenyReason(auth(), table(), project)).toBeNull();
  });

  it("★ 個人資料表永遠不可提供給專案——連擁有者本人也不行", () => {
    const personal = table({ scope: "personal", ownerId: U.me, groupId: null });
    const reason = bindableDenyReason(auth(), personal, project);
    expect(reason).not.toBeNull();
    // 理由要講得出「為什麼」與「怎麼辦」，不是只說不行
    expect(reason).toContain("只有你看得到");
    expect(reason).toContain("組共用");
  });

  it("★ 開發者也不能把別人的個人庫提供給專案（個人庫連超級管理員都看不到）", () => {
    const superAdmin = auth({ user: { ...auth().user, isSuperAdmin: true } });
    const someoneElsesPersonal = table({ scope: "personal", ownerId: U.other, groupId: null });
    expect(bindableDenyReason(superAdmin, someoneElsesPersonal, project)).toBe("找不到這張資料表");
  });

  it("★ 別組的組資料表不可提供（跨組隔離）", () => {
    const otherGroupTable = table({ scope: "group", groupId: U.groupB });
    // 先確認這個人本來就看不到別組的表——擋在「找不到」那一層
    expect(bindableDenyReason(auth(), otherGroupTable, project)).toBe("找不到這張資料表");
  });

  it("★ 就算看得到別組的表（同時在兩個組），也不能提供給這個專案", () => {
    const inBothGroups = auth({
      groups: [
        { groupId: U.groupA, groupName: "A", teamId: U.team1, teamName: "T1", role: "member" },
        { groupId: U.groupB, groupName: "B", teamId: U.team1, teamName: "T1", role: "member" },
      ],
    });
    const otherGroupTable = table({ scope: "group", groupId: U.groupB });
    const reason = bindableDenyReason(inBothGroups, otherGroupTable, project);
    expect(reason).toBe("這張表屬於別的組，不能提供給這個專案");
  });

  it("團隊範圍的表可以提供（範圍本來就涵蓋這個專案的成員）", () => {
    const teamTable = table({ scope: "team", groupId: null, teamId: U.team1 });
    expect(bindableDenyReason(auth(), teamTable, project)).toBeNull();
  });

  it("★ 別團隊的表看不到，也就不可提供", () => {
    const otherTeamTable = table({ scope: "team", groupId: null, teamId: U.team2 });
    expect(bindableDenyReason(auth(), otherTeamTable, project)).toBe("找不到這張資料表");
  });

  it("全站範圍的表可以提供", () => {
    const globalTable = table({ scope: "global", groupId: null });
    expect(bindableDenyReason(auth(), globalTable, project)).toBeNull();
  });

  it("唯讀（memberWritable=false）不影響能不能提供——提供是讀取面的事", () => {
    const readOnly = table({ memberWritable: false });
    expect(bindableDenyReason(auth(), readOnly, project)).toBeNull();
  });

  it("未知 scope 一律擋下（fail closed）", () => {
    const weird = table({ scope: "mystery" as unknown as "group" });
    expect(bindableDenyReason(auth(), weird, project)).not.toBeNull();
  });

  it("目前只開放綁定資料表——knowledge／asset 本來就有 project_id", () => {
    expect([...BINDABLE_RESOURCE_KINDS]).toEqual(["table"]);
  });
});
