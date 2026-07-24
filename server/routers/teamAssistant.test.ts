import { describe, expect, it } from "vitest";
import { dispatchAllowed, resolveDispatches } from "./teamAssistant";

/** 迷你專案列（只需 id/title，resolveDispatches 泛型只吃這兩欄） */
const proj = (id: string, title: string) => ({ id, title });
const projByRef = new Map([
  ["p1", proj("uuid-1", "招生短片")],
  ["p2", proj("uuid-2", "社課回顧")],
]);

describe("dispatchAllowed（派工權純規則）", () => {
  it("組長／團隊管理員／開發者恆可派工，不看授權旗標", () => {
    for (const role of ["admin", "leader"] as const) {
      expect(dispatchAllowed(role, null)).toBe(true);
      expect(dispatchAllowed(role, undefined)).toBe(true);
      expect(dispatchAllowed(role, false)).toBe(true);
    }
  });

  it("一般組員預設不可派工（null/undefined/false 皆擋）", () => {
    expect(dispatchAllowed("member", null)).toBe(false);
    expect(dispatchAllowed("member", undefined)).toBe(false);
    expect(dispatchAllowed("member", false)).toBe(false);
  });

  it("被明確授權（true）的組員可派工", () => {
    expect(dispatchAllowed("member", true)).toBe(true);
  });
});

describe("resolveDispatches（LLM 代號派工 → 可執行提議）", () => {
  it("無派工權時一律回空——即使 LLM 越權提議也不落地（露出面與執行面同守一條規則）", () => {
    const out = resolveDispatches(projByRef, [{ projectRef: "p1", goal: "把腳本拆成分鏡並逐鏡出圖" }], false);
    expect(out).toEqual([]);
  });

  it("有派工權時解析出真實 projectId 與人看得懂的標籤", () => {
    const out = resolveDispatches(projByRef, [{ projectRef: "p2", goal: "為每一鏡生成畫面並送審" }], true);
    expect(out).toHaveLength(1);
    expect(out[0].projectId).toBe("uuid-2");
    expect(out[0].projectTitle).toBe("社課回顧");
    expect(out[0].label).toContain("社課回顧");
  });

  it("幻覺的專案代號（對不到現況清單）整筆略過，不給註定失敗的按鈕", () => {
    const out = resolveDispatches(
      projByRef,
      [
        { projectRef: "p9", goal: "這個代號不存在，應被丟棄" },
        { projectRef: "p1", goal: "這筆合法，應保留" },
      ],
      true,
    );
    expect(out).toHaveLength(1);
    expect(out[0].projectId).toBe("uuid-1");
  });

  it("目標 trim 後不足 5 字（與 planAgentCore 下限一致）略過，免得按了才吃 BAD_REQUEST", () => {
    const out = resolveDispatches(projByRef, [{ projectRef: "p1", goal: "  短  " }], true);
    expect(out).toEqual([]);
  });

  it("projectRef 前後空白容錯（LLM 偶爾多帶空白）", () => {
    const out = resolveDispatches(projByRef, [{ projectRef: " p1 ", goal: "把知識庫的腳本拆成分鏡" }], true);
    expect(out).toHaveLength(1);
    expect(out[0].projectId).toBe("uuid-1");
  });

  it("過長目標的標籤截斷到 28 字加省略號（按鈕不被灌爆）", () => {
    const longGoal = "一".repeat(60);
    const out = resolveDispatches(projByRef, [{ projectRef: "p1", goal: longGoal }], true);
    expect(out[0].label).toContain("…");
    // goal 本身保留全文（送 dispatch 用），只有 label 截斷
    expect(out[0].goal).toBe(longGoal);
  });
});
