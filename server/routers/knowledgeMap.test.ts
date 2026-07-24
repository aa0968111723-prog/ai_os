/**
 * pickMapDatabases 單元測試（知識族譜的資料庫收斂）：
 * 輸入是「此人可見」（已過 databaseAcl）的資料庫清單，這裡驗證「組相關性」收斂——
 * 本組組庫／本團隊庫／全站／個人留下，別組與別團隊的組庫、團隊庫剔除，並套用上限。
 */
import { describe, expect, it } from "vitest";
import { pickMapDatabases } from "./knowledgeMap";

const G1 = "group-1";
const G2 = "group-2";
const T1 = "team-1";
const T2 = "team-2";

type Row = { id: string; scope: string; groupId: string | null; teamId: string | null };
const row = (id: string, scope: string, groupId: string | null = null, teamId: string | null = null): Row => ({ id, scope, groupId, teamId });

describe("pickMapDatabases", () => {
  it("保留本組組庫、本團隊庫、全站與個人庫", () => {
    const tables = [
      row("a", "group", G1),
      row("b", "team", null, T1),
      row("c", "global"),
      row("d", "personal"),
    ];
    expect(pickMapDatabases(tables, G1, T1).map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("剔除別組的組庫與別團隊的團隊庫", () => {
    const tables = [
      row("mine", "group", G1),
      row("other-group", "group", G2),
      row("other-team", "team", null, T2),
    ];
    expect(pickMapDatabases(tables, G1, T1).map((t) => t.id)).toEqual(["mine"]);
  });

  it("組所屬團隊未知（teamId=null）時不收任何團隊庫——寧缺勿錯掛", () => {
    const tables = [row("t", "team", null, T1), row("g", "global")];
    expect(pickMapDatabases(tables, G1, null).map((t) => t.id)).toEqual(["g"]);
  });

  it("套用上限：超過 limit 的截尾（清單已由呼叫端按更新時間排序）", () => {
    const tables = Array.from({ length: 5 }, (_, i) => row(`db-${i}`, "global"));
    expect(pickMapDatabases(tables, G1, T1, 3).map((t) => t.id)).toEqual(["db-0", "db-1", "db-2"]);
  });
});
