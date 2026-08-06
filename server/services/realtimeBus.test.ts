/**
 * 跨實例在場名冊的合併規則。
 *
 * 這幾條規則錯了的症狀都很具體：名單重複（同一人出現兩次）、幽靈協作者（實例掛了人還在）、
 * 或是聚焦框顯示在別人上一個編輯的區塊。三者都只在「開到兩個 replica」時才會出現，
 * 開發與單機測試都碰不到，所以用純函式把規則釘死。
 */
import { describe, expect, it } from "vitest";
import {
  ROSTER_STALE_MS,
  mergeRosterFocus,
  mergeRosterUsers,
  pruneRosters,
  type RosterEntry,
} from "./realtimeBus";

const now = 1_000_000;
const user = (id: string, name = id) => ({ userId: id, name, color: "#000" });
const entry = (over: Partial<RosterEntry>): RosterEntry => ({
  users: [],
  focus: [],
  receivedAt: now,
  ...over,
});

describe("mergeRosterUsers", () => {
  it("本機 ∪ 遠端", () => {
    const merged = mergeRosterUsers([user("a")], [entry({ users: [user("b")] })], now);
    expect(merged.map((u) => u.userId).sort()).toEqual(["a", "b"]);
  });

  it("同一人同時連兩個實例只算一次（電腦＋手機）", () => {
    const merged = mergeRosterUsers([user("a")], [entry({ users: [user("a")] })], now);
    expect(merged).toHaveLength(1);
  });

  it("本機資料優先——本機一定是最新的", () => {
    const merged = mergeRosterUsers(
      [user("a", "本機名字")],
      [entry({ users: [user("a", "遠端舊名字")] })],
      now,
    );
    expect(merged[0].name).toBe("本機名字");
  });

  it("過期名冊不算——實例被砍掉後，畫面上不能留著永遠不會離開的幽靈協作者", () => {
    const stale = entry({ users: [user("ghost")], receivedAt: now - ROSTER_STALE_MS - 1 });
    expect(mergeRosterUsers([user("a")], [stale], now)).toEqual([user("a")]);
  });

  it("剛好在門檻上仍算數（邊界不該把還活著的實例判死）", () => {
    const edge = entry({ users: [user("b")], receivedAt: now - ROSTER_STALE_MS });
    expect(mergeRosterUsers([], [edge], now)).toHaveLength(1);
  });

  it("多個遠端實例都併進來", () => {
    const merged = mergeRosterUsers(
      [user("a")],
      [entry({ users: [user("b")] }), entry({ users: [user("c"), user("a")] })],
      now,
    );
    expect(merged.map((u) => u.userId).sort()).toEqual(["a", "b", "c"]);
  });

  it("沒有遠端名冊時就等於本機名單（單機模式）", () => {
    expect(mergeRosterUsers([user("a")], [], now)).toEqual([user("a")]);
  });
});

describe("mergeRosterFocus", () => {
  it("合併不同人的聚焦區塊", () => {
    const merged = mergeRosterFocus(
      [{ userId: "a", zone: "scenes" }],
      [entry({ focus: [{ userId: "b", zone: "script" }] })],
      now,
    );
    expect(merged).toEqual([
      { userId: "a", zone: "scenes" },
      { userId: "b", zone: "script" },
    ]);
  });

  it("同一人以本機為準——他本人的操作就發生在他連著的那台上", () => {
    const merged = mergeRosterFocus(
      [{ userId: "a", zone: "現在這裡" }],
      [entry({ focus: [{ userId: "a", zone: "剛剛那裡" }] })],
      now,
    );
    expect(merged).toEqual([{ userId: "a", zone: "現在這裡" }]);
  });

  it("過期名冊的聚焦不算", () => {
    const stale = entry({ focus: [{ userId: "b", zone: "old" }], receivedAt: now - ROSTER_STALE_MS - 1 });
    expect(mergeRosterFocus([], [stale], now)).toEqual([]);
  });
});

describe("pruneRosters", () => {
  it("清掉過期的並回報「有變動」（呼叫端據此重播在場名單）", () => {
    const rosters = new Map<string, RosterEntry>([
      ["live", entry({ users: [user("a")] })],
      ["dead", entry({ users: [user("b")], receivedAt: now - ROSTER_STALE_MS - 1 })],
    ]);
    expect(pruneRosters(rosters, now)).toBe(true);
    expect([...rosters.keys()]).toEqual(["live"]);
  });

  it("沒有東西過期就回 false（不做多餘的廣播）", () => {
    const rosters = new Map<string, RosterEntry>([["live", entry({ users: [user("a")] })]]);
    expect(pruneRosters(rosters, now)).toBe(false);
    expect(rosters.size).toBe(1);
  });
});
