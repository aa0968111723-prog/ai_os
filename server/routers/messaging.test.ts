/**
 * messaging 純函式守衛的單元測試（不碰 DB）。
 * dmKeyFor：私訊配對鍵與順序無關、一對人唯一、自己找自己非法（保證「一對人只有一條 dm」的去重基礎）。
 * myTeams/inTeam：由 auth.groups 展開我所屬團隊——通訊錄以團隊為界，錯了會讓人私訊到不同團隊的陌生人。
 * normalizeTitle：群組名修剪空白。
 */
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { dmKeyFor, myTeams, inTeam, normalizeTitle } from "./messaging";
import type { AuthState } from "../services/auth";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

function auth(groups: AuthState["groups"]): AuthState {
  return {
    user: { id: A, name: "我", email: "me@x.co", isSuperAdmin: false, mustChangePassword: false },
    groups,
    adminTeamIds: [],
  };
}

describe("dmKeyFor：私訊配對鍵", () => {
  it("與順序無關（a,b 與 b,a 同鍵）", () => {
    expect(dmKeyFor(A, B)).toBe(dmKeyFor(B, A));
  });

  it("鍵是兩人 id 排序後以冒號相接", () => {
    expect(dmKeyFor(A, B)).toBe(`${A}:${B}`);
    expect(dmKeyFor(B, A)).toBe(`${A}:${B}`); // 大者在後
  });

  it("自己找自己：拋 BAD_REQUEST", () => {
    try {
      dmKeyFor(A, A);
      throw new Error("應該要拋錯");
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_REQUEST");
    }
  });
});

describe("myTeams / inTeam：我所屬團隊", () => {
  const state = auth([
    { groupId: "g1", groupName: "甲組", teamId: "t1", teamName: "弘法團隊", role: "member" },
    { groupId: "g2", groupName: "乙組", teamId: "t1", teamName: "弘法團隊", role: "leader" },
    { groupId: "g3", groupName: "丙組", teamId: "t2", teamName: "影音團隊", role: "member" },
  ]);

  it("跨組同團隊去重（t1 只算一次），列出不重複的團隊", () => {
    const teams = myTeams(state);
    expect(teams.map((t) => t.teamId).sort()).toEqual(["t1", "t2"]);
    expect(teams.find((t) => t.teamId === "t1")?.teamName).toBe("弘法團隊");
  });

  it("inTeam：屬於的團隊回 true、外團隊回 false", () => {
    expect(inTeam(state, "t1")).toBe(true);
    expect(inTeam(state, "t2")).toBe(true);
    expect(inTeam(state, "t9")).toBe(false);
  });

  it("沒有任何組：團隊為空、任何團隊都不屬於", () => {
    const none = auth([]);
    expect(myTeams(none)).toEqual([]);
    expect(inTeam(none, "t1")).toBe(false);
  });
});

describe("normalizeTitle：群組名修剪", () => {
  it("去頭尾空白", () => {
    expect(normalizeTitle("  專案討論  ")).toBe("專案討論");
  });
});
