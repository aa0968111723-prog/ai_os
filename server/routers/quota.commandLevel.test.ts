/**
 * 組代理指揮權（agent_command_level）落庫規則的單元測試。
 *
 * 這裡驗的不是「欄位有沒有寫進去」，而是「新四級 mutation 與舊布林 mutation 會不會分岔」——
 * 分岔的後果是授權錯誤：畫面顯示關掉了、後端仍放行（或反過來），兩種都只有出事時才會被發現。
 * 因此把折算規則抽成純函式，連同 shared/groupAgent 的 resolveCommandLevel 一起做端到端的語意驗證。
 */
import { describe, expect, it } from "vitest";
import { dispatchFlagForLevel, levelFromDispatchToggle } from "./quota";
import { resolveCommandLevel, type GroupCommandLevel } from "../../shared/groupAgent";

describe("dispatchFlagForLevel", () => {
  it("dispatch 以上寫 true，none 寫 null（沿用本欄「null＝未授權」的原始語意）", () => {
    expect(dispatchFlagForLevel("none")).toBe(null);
    expect(dispatchFlagForLevel("dispatch")).toBe(true);
    expect(dispatchFlagForLevel("supervise")).toBe(true);
    expect(dispatchFlagForLevel("command")).toBe(true);
  });

  it("降到 none 時舊布林必須一起被清掉——否則只讀舊欄位的路徑會繼續放行，降權無聲失效", () => {
    // 先被授權（舊布林 true），再被降級成 none
    const afterDowngrade = { agentCommandLevel: "none" as GroupCommandLevel, canDispatchAgent: dispatchFlagForLevel("none") };
    expect(afterDowngrade.canDispatchAgent).toBe(null);
    expect(resolveCommandLevel("member", afterDowngrade)).toBe("none");
  });
});

describe("levelFromDispatchToggle", () => {
  it("關閉一律寫 none：只把布林設回 null 而留著 supervise，開關就變成謊言（後端仍准他核准花點）", () => {
    expect(levelFromDispatchToggle("supervise", false)).toBe("none");
    expect(levelFromDispatchToggle("command", false)).toBe("none");
    expect(levelFromDispatchToggle("dispatch", false)).toBe("none");
    expect(levelFromDispatchToggle("none", false)).toBe("none");
  });

  it("打開時把未授權者升到 dispatch", () => {
    expect(levelFromDispatchToggle("none", true)).toBe("dispatch");
  });

  it("打開時不降級：按「開」卻讓可監督者掉回可派工，是使用者不會預期的默默收權", () => {
    expect(levelFromDispatchToggle("supervise", true)).toBe("supervise");
    expect(levelFromDispatchToggle("command", true)).toBe("command");
    expect(levelFromDispatchToggle("dispatch", true)).toBe("dispatch");
  });
});

describe("兩支 mutation 寫出來的列，讀回來必須是同一個意思", () => {
  /** 模擬 setMemberCommandLevel 的寫入 */
  const writeLevel = (level: GroupCommandLevel) => ({ agentCommandLevel: level, canDispatchAgent: dispatchFlagForLevel(level) });
  /** 模擬 setMemberDispatch 的寫入（先讀現況再折算） */
  const writeToggle = (row: { agentCommandLevel: GroupCommandLevel | null; canDispatchAgent: boolean | null }, canDispatch: boolean) => {
    const level = levelFromDispatchToggle(resolveCommandLevel("member", row), canDispatch);
    return { agentCommandLevel: level, canDispatchAgent: dispatchFlagForLevel(level) };
  };

  it("四級寫入後，resolveCommandLevel 讀回同一級（明確等級優先於布林）", () => {
    for (const level of ["none", "dispatch", "supervise", "command"] as GroupCommandLevel[]) {
      expect(resolveCommandLevel("member", writeLevel(level))).toBe(level);
    }
  });

  it("先設 supervise、再用舊開關按「關」→ 真的收回到 none（不是只關掉布林、等級還留著）", () => {
    const row = writeLevel("supervise");
    const after = writeToggle(row, false);
    expect(resolveCommandLevel("member", after)).toBe("none");
    expect(after.canDispatchAgent).toBe(null);
  });

  it("先設 supervise、再用舊開關按「開」→ 維持 supervise（不被舊布林覆蓋成 dispatch）", () => {
    const row = writeLevel("supervise");
    expect(resolveCommandLevel("member", writeToggle(row, true))).toBe("supervise");
  });

  it("欄位從沒設過（migration 前就授權過的舊資料）按「開」→ 升到 dispatch，既有授權不變窄也不變寬", () => {
    const legacy = { agentCommandLevel: null, canDispatchAgent: true };
    expect(resolveCommandLevel("member", legacy)).toBe("dispatch"); // 退回讀舊布林
    expect(resolveCommandLevel("member", writeToggle(legacy, true))).toBe("dispatch");
  });

  it("組長角色不看這個欄位：就算列上寫著 none 也恆為 command", () => {
    expect(resolveCommandLevel("leader", writeLevel("none"))).toBe("command");
  });
});
