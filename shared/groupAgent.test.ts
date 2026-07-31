import { describe, expect, it } from "vitest";
import {
  campaignProgress,
  canRunCommand,
  countDoneCampaignSteps,
  decideWatchAction,
  levelAtLeast,
  nextRunnableStep,
  resolveCampaignOutcome,
  resolveCommandLevel,
  skipUnreachableSteps,
  withinCampaignBudget,
  type GroupCampaignStep,
} from "./groupAgent";

const step = (over: Partial<GroupCampaignStep> & { id: string }): GroupCampaignStep => ({
  kind: "dispatch",
  title: over.id,
  note: "",
  status: "pending",
  ...over,
});

describe("resolveCommandLevel（指揮權分級的唯一規則）", () => {
  it("組長／團隊管理員／開發者恆為 command，不看任何授權欄位", () => {
    for (const role of ["admin", "leader"] as const) {
      expect(resolveCommandLevel(role, null)).toBe("command");
      expect(resolveCommandLevel(role, { agentCommandLevel: "none", canDispatchAgent: false })).toBe("command");
    }
  });

  it("一般組員預設 none（沒設過、也沒有舊布林）", () => {
    expect(resolveCommandLevel("member", null)).toBe("none");
    expect(resolveCommandLevel("member", { agentCommandLevel: null, canDispatchAgent: null })).toBe("none");
  });

  it("欄位剛上線時退回讀舊布林——既有派工授權不會在 migration 當下無聲失效", () => {
    expect(resolveCommandLevel("member", { agentCommandLevel: null, canDispatchAgent: true })).toBe("dispatch");
  });

  it("明確設過的等級優先於舊布林（升級與降級都算數）", () => {
    expect(resolveCommandLevel("member", { agentCommandLevel: "supervise", canDispatchAgent: null })).toBe("supervise");
    expect(resolveCommandLevel("member", { agentCommandLevel: "none", canDispatchAgent: true })).toBe("none");
  });

  it("欄位被寫進無法辨識的值時退回舊布林，不會當成最高權", () => {
    expect(resolveCommandLevel("member", { agentCommandLevel: "superuser", canDispatchAgent: null })).toBe("none");
    expect(resolveCommandLevel("member", { agentCommandLevel: "superuser", canDispatchAgent: true })).toBe("dispatch");
  });
});

describe("canRunCommand（每種指令的最低等級）", () => {
  it("dispatch 等級只能派工，碰不到任何既有計畫", () => {
    expect(canRunCommand("dispatch", "dispatch")).toBe(true);
    for (const kind of ["approve_run", "stop_run", "discard_run", "retry_run", "assign_task"] as const) {
      expect(canRunCommand("dispatch", kind)).toBe(false);
    }
  });

  it("supervise 才能核准／停止／重跑／改派——「能不能開始花點」與「能不能生一份待核」不同量級", () => {
    for (const kind of ["approve_run", "stop_run", "discard_run", "retry_run", "assign_task"] as const) {
      expect(canRunCommand("supervise", kind)).toBe(true);
    }
  });

  it("none 什麼都不能做", () => {
    expect(canRunCommand("none", "dispatch")).toBe(false);
    expect(canRunCommand("none", "approve_run")).toBe(false);
  });

  it("levelAtLeast 是全序：command ⊃ supervise ⊃ dispatch ⊃ none", () => {
    expect(levelAtLeast("command", "supervise")).toBe(true);
    expect(levelAtLeast("supervise", "command")).toBe(false);
    expect(levelAtLeast("dispatch", "dispatch")).toBe(true);
  });
});

describe("nextRunnableStep（依賴滿足才輪得到）", () => {
  it("沒有依賴的第一個 pending 先跑", () => {
    const steps = [step({ id: "a", status: "done" }), step({ id: "b" }), step({ id: "c" })];
    expect(nextRunnableStep(steps)?.id).toBe("b");
  });

  it("依賴還沒 done 就不放行（跳過它，找下一個可跑的）", () => {
    const steps = [step({ id: "a", status: "running" }), step({ id: "b", dependsOn: ["a"] }), step({ id: "c" })];
    expect(nextRunnableStep(steps)?.id).toBe("c");
  });

  it("全部都在等依賴時回 undefined（執行器這輪就什麼都不做）", () => {
    const steps = [step({ id: "a", status: "running" }), step({ id: "b", dependsOn: ["a"] })];
    expect(nextRunnableStep(steps)).toBeUndefined();
  });
});

describe("skipUnreachableSteps（失敗的支線要收尾，不能留殭屍）", () => {
  it("依賴失敗的後續步驟遞移標成 skipped", () => {
    const steps = [
      step({ id: "a", status: "failed" }),
      step({ id: "b", dependsOn: ["a"] }),
      step({ id: "c", dependsOn: ["b"] }),
      step({ id: "d" }),
    ];
    expect(skipUnreachableSteps(steps)).toBe(2);
    expect(steps.map((s) => s.status)).toEqual(["failed", "skipped", "skipped", "pending"]);
  });

  it("沒有任何死步時不動任何東西", () => {
    const steps = [step({ id: "a", status: "done" }), step({ id: "b", dependsOn: ["a"] })];
    expect(skipUnreachableSteps(steps)).toBe(0);
    expect(steps[1].status).toBe("pending");
  });
});

describe("resolveCampaignOutcome（整份計畫的終局）", () => {
  it("還有步驟在跑／在等／待跑 → 尚未結束", () => {
    expect(resolveCampaignOutcome([step({ id: "a", status: "done" }), step({ id: "b", status: "running" })])).toBeNull();
    expect(resolveCampaignOutcome([step({ id: "a", status: "waiting" })])).toBeNull();
  });

  it("全部 done → done", () => {
    expect(resolveCampaignOutcome([step({ id: "a", status: "done" }), step({ id: "b", status: "done" })])).toBe("done");
  });

  it("有 skipped 但沒有失敗 → 仍算完成：停掉一條支線後其餘正常跑完，那份計畫是完成的", () => {
    expect(resolveCampaignOutcome([step({ id: "a", status: "done" }), step({ id: "b", status: "skipped" })])).toBe("done");
  });

  it("有 failed → failed（優先於 stopped）", () => {
    expect(resolveCampaignOutcome([step({ id: "a", status: "failed" }), step({ id: "b", status: "stopped" })])).toBe("failed");
  });

  it("只有 stopped → stopped", () => {
    expect(resolveCampaignOutcome([step({ id: "a", status: "done" }), step({ id: "b", status: "stopped" })])).toBe("stopped");
  });
});

describe("campaignProgress（skipped 不留在分母）", () => {
  it("略過的步驟不會讓進度永遠停在 5/8", () => {
    const steps = [
      step({ id: "a", status: "done" }),
      step({ id: "b", status: "done" }),
      step({ id: "c", status: "skipped" }),
    ];
    expect(countDoneCampaignSteps(steps)).toBe(2);
    expect(campaignProgress(steps)).toEqual({ done: 2, total: 2 });
  });
});

describe("withinCampaignBudget（組代理自動花錢的閘）", () => {
  it("沒授權（0 或負）一律不放行——預設不給，比預設給了再靠人記得關安全", () => {
    expect(withinCampaignBudget({ budgetPoints: 0, spentPoints: 0, stepPoints: 1 })).toBe(false);
    expect(withinCampaignBudget({ budgetPoints: -5, spentPoints: 0, stepPoints: 0 })).toBe(false);
  });

  it("剛好用完額度可以放行，超過一點就不行", () => {
    expect(withinCampaignBudget({ budgetPoints: 100, spentPoints: 60, stepPoints: 40 })).toBe(true);
    expect(withinCampaignBudget({ budgetPoints: 100, spentPoints: 60, stepPoints: 41 })).toBe(false);
  });
});

describe("decideWatchAction（盯子計畫的決策：整個 L3 唯一會自己花錢的判斷）", () => {
  const base = { childEstPoints: 30, budgetPoints: 100, spentPoints: 0, attempts: 0, maxAttempts: 1 };

  it("待核准且放得進授權 → 核准", () => {
    expect(decideWatchAction({ ...base, childStatus: "awaiting_approval" })).toEqual({ action: "approve" });
  });

  it("待核准但超出授權 → 停下來等人，不是失敗（差 10 點就整份失敗，使用者只能重排一次）", () => {
    const d = decideWatchAction({ ...base, childStatus: "awaiting_approval", childEstPoints: 40, budgetPoints: 30 });
    expect(d.action).toBe("hold");
    expect(d.action === "hold" && d.reason).toContain("超出本次授權");
  });

  it("沒有授權（0 點）時每一份子計畫都停下來等人核准", () => {
    expect(decideWatchAction({ ...base, childStatus: "awaiting_approval", budgetPoints: 0 }).action).toBe("hold");
  });

  it("已用額度會累計——同一份計畫的第二次核准要看剩下多少", () => {
    expect(decideWatchAction({ ...base, childStatus: "awaiting_approval", spentPoints: 80, childEstPoints: 30 }).action).toBe("hold");
    expect(decideWatchAction({ ...base, childStatus: "awaiting_approval", spentPoints: 70, childEstPoints: 30 }).action).toBe("approve");
  });

  it("執行中／等待人員 → 這輪什麼都不做（子計畫可能跑數十分鐘）", () => {
    expect(decideWatchAction({ ...base, childStatus: "running" })).toEqual({ action: "wait" });
    expect(decideWatchAction({ ...base, childStatus: "waiting" })).toEqual({ action: "wait" });
  });

  it("完成 → 這步完成", () => {
    expect(decideWatchAction({ ...base, childStatus: "done" })).toEqual({ action: "done" });
  });

  it("失敗且還有重試額度 → 重新規劃；用完 → 失敗且說明試過幾次", () => {
    expect(decideWatchAction({ ...base, childStatus: "failed", attempts: 0, maxAttempts: 1 })).toEqual({ action: "retry" });
    const d = decideWatchAction({ ...base, childStatus: "failed", attempts: 1, maxAttempts: 1, childError: "模型逾時" });
    expect(d.action).toBe("fail");
    expect(d.action === "fail" && d.reason).toContain("模型逾時");
    expect(d.action === "fail" && d.reason).toContain("已重新規劃 1 次");
  });

  it("maxAttempts=0 時失敗就停，理由不會出現誤導的「達上限」字樣", () => {
    const d = decideWatchAction({ ...base, childStatus: "failed", maxAttempts: 0 });
    expect(d.action).toBe("fail");
    expect(d.action === "fail" && d.reason).not.toContain("達上限");
  });

  it("人剛停掉／放棄的子計畫一律不重試——組代理不該把人的決定再開一次", () => {
    for (const status of ["stopped", "discarded"]) {
      const d = decideWatchAction({ ...base, childStatus: status, attempts: 0, maxAttempts: 3 });
      expect(d.action).toBe("fail");
    }
  });
});
