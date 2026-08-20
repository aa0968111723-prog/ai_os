import { describe, expect, it } from "vitest";
import { ASSISTANT_CAPABILITIES } from "./assistantExecution";
import {
  COMPANION_ACTION_POLICIES,
  companionCanAutoRun,
  companionConfirmCopy,
  companionPolicyFor,
} from "./companionActions";

describe("Companion Action Registry", () => {
  it("每一項既有能力都有政策——不會有手機上按得到、卻沒人審過的動作", () => {
    expect(COMPANION_ACTION_POLICIES).toHaveLength(ASSISTANT_CAPABILITIES.length);
    for (const capability of ASSISTANT_CAPABILITIES) {
      expect(companionPolicyFor(capability.id).capabilityId).toBe(capability.id);
    }
  });

  it("唯讀動作一律直接執行——不要每個小操作都問「確定嗎？」", () => {
    for (const capability of ASSISTANT_CAPABILITIES.filter((c) => c.risk === "READ")) {
      const policy = companionPolicyFor(capability.id);
      expect(policy.tier).toBe("low");
      expect(policy.confirm).toBe("auto");
    }
  });

  it("查進度這類 low risk 可以自動跑", () => {
    expect(companionCanAutoRun("read_generations")).toBe(true);
    expect(companionCanAutoRun("read_tasks")).toBe(true);
  });

  it("永久改角色 Reference 屬 high risk，必須出確認卡", () => {
    const policy = companionPolicyFor("add_character");
    expect(policy.tier).toBe("high");
    expect(policy.confirm).toBe("confirm_card");
    expect(companionCanAutoRun("add_character")).toBe(false);
  });

  it("對外影響（私訊、行事曆）一律 high", () => {
    expect(companionPolicyFor("send_dm").tier).toBe("high");
    expect(companionPolicyFor("send_dm").external).toBe(true);
    expect(companionPolicyFor("add_schedule_item").tier).toBe("high");
  });

  it("大型批次花費要先問", () => {
    expect(companionPolicyFor("orchestrate_group_campaign").tier).toBe("high");
  });

  it("換掉現用畫面是 medium：直接做，但要有 Undo", () => {
    const policy = companionPolicyFor("animation_adopt_candidate");
    expect(policy.tier).toBe("medium");
    expect(policy.confirm).toBe("auto_with_undo");
    expect(policy.undoable).toBe(true);
  });

  it("重新生成會花點數，但可以直接跑（medium）", () => {
    const policy = companionPolicyFor("animation_execute_repair");
    expect(policy.tier).toBe("medium");
    expect(policy.costful).toBe(true);
  });

  it("撤不回來的 medium 會被推上確認卡——不承諾做不到的 Undo", () => {
    const policy = companionPolicyFor("animation_execute_repair");
    expect(policy.undoable).toBe(false);
    expect(policy.confirm).toBe("confirm_card");
  });

  it("沒登錄的能力預設 high／confirm_card：未知的東西先問", () => {
    const policy = companionPolicyFor("some_capability_added_next_year");
    expect(policy.tier).toBe("high");
    expect(policy.confirm).toBe("confirm_card");
    expect(companionCanAutoRun(undefined)).toBe(false);
    expect(companionCanAutoRun(null)).toBe(false);
  });

  it("語音只在真的要擋人時開口", () => {
    expect(companionPolicyFor("read_tasks").speakConfirmation).toBe(false);
    expect(companionPolicyFor("send_dm").speakConfirmation).toBe(true);
  });
});

describe("companionConfirmCopy", () => {
  it("講會發生什麼，不是講法務語氣", () => {
    const copy = companionConfirmCopy(companionPolicyFor("send_dm"), { targetLabel: "小華" });
    expect(copy.title).toContain("小華");
    expect(copy.body).toContain("其他人會收到");
    expect(copy.body).toContain("無法復原");
    expect(copy.confirmLabel).toBe("就這樣做");
  });

  it("批量會講出數量", () => {
    const copy = companionConfirmCopy(companionPolicyFor("generate_media"), { count: 12 });
    expect(copy.title).toContain("12 項");
    expect(copy.body).toContain("點數");
  });

  it("沒有副作用時給的是「確認後我就開始」，不是空字串", () => {
    const copy = companionConfirmCopy(companionPolicyFor("create_project"));
    expect(copy.body).toBe("確認後我就開始。");
  });
});
