import { describe, expect, it } from "vitest";
import {
  COMPANION_EVENT_KINDS,
  COMPANION_NOTIFICATION_PRIORITIES,
  companionNotificationCopy,
  companionNotificationPlan,
  companionPriorityRank,
} from "./companionNotifications";

describe("companionNotificationPlan", () => {
  it("進度事件是 silent——不是什麼事都通知", () => {
    const plan = companionNotificationPlan({ kind: "generation_progress" });
    expect(plan.priority).toBe("silent");
    expect(plan.push).toBe(false);
    expect(plan.orbNudge).toBe(false);
  });

  it("等你拍板的事會震動", () => {
    const plan = companionNotificationPlan({ kind: "approval_required" });
    expect(plan.priority).toBe("action_required");
    expect(plan.push).toBe(true);
    expect(plan.haptic).toBe(true);
  });

  it("大批失敗升成 critical：那不是一件事，是這一輪垮了", () => {
    expect(companionNotificationPlan({ kind: "generation_failed", count: 1 }).priority)
      .toBe("action_required");
    expect(companionNotificationPlan({ kind: "generation_failed", count: 6 }).priority)
      .toBe("critical");
  });

  it("點數用完是 critical，且在看著也不降級", () => {
    const plan = companionNotificationPlan({ kind: "quota_exhausted", viewing: true });
    expect(plan.priority).toBe("critical");
    expect(plan.push).toBe(true);
  });

  it("正在看這個專案時降一級——不對著使用者的臉重複他剛看到的東西", () => {
    const away = companionNotificationPlan({ kind: "generation_completed" });
    const watching = companionNotificationPlan({ kind: "generation_completed", viewing: true });
    expect(away.priority).toBe("completed");
    expect(watching.priority).toBe("informational");
    expect(watching.push).toBe(false);
  });

  it("使用者自己說要盯的事，完成時值得講一聲", () => {
    expect(companionNotificationPlan({ kind: "project_updated" }).priority).toBe("informational");
    expect(companionNotificationPlan({ kind: "project_updated", watched: true }).priority)
      .toBe("completed");
  });

  it("生成完成會合併：一次來十筆不能推十次", () => {
    expect(companionNotificationPlan({ kind: "generation_completed" }).coalesceMs)
      .toBeGreaterThan(0);
  });

  it("每一種事件都有計畫（新增事件不會靜靜掉到 undefined）", () => {
    for (const kind of COMPANION_EVENT_KINDS) {
      const plan = companionNotificationPlan({ kind });
      expect(COMPANION_NOTIFICATION_PRIORITIES).toContain(plan.priority);
    }
  });
});

describe("companionPriorityRank", () => {
  it("critical 排最前、silent 排最後", () => {
    expect(companionPriorityRank("critical")).toBeLessThan(companionPriorityRank("action_required"));
    expect(companionPriorityRank("silent")).toBeGreaterThan(companionPriorityRank("informational"));
  });
});

describe("companionNotificationCopy", () => {
  it("講「發生什麼 ＋ 我可以幫你做什麼」", () => {
    expect(companionNotificationCopy("generation_completed", { itemLabel: "A08" }))
      .toBe("A08 完成了，要看嗎？");
    expect(companionNotificationCopy("generation_failed", { count: 3 }))
      .toContain("我可以幫你重跑");
  });

  it("帶得出專案名", () => {
    expect(companionNotificationCopy("approval_required", { projectTitle: "淡江動畫", count: 2 }))
      .toContain("淡江動畫");
  });

  it("每一種事件都講得出人話，沒有「XX 事件已觸發」", () => {
    for (const kind of COMPANION_EVENT_KINDS) {
      const copy = companionNotificationCopy(kind, { count: 2 });
      expect(copy.length).toBeGreaterThan(4);
      expect(copy).not.toContain("event");
    }
  });
});
