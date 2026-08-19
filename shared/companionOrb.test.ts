import { describe, expect, it } from "vitest";
import {
  ORB_STATES,
  ORB_TRANSIENT_MS,
  companionOrbToLegacy,
  deriveOrbState,
  isTransientOrbState,
  orbAccessibleLabel,
  orbMotionPlan,
  orbPriority,
  resolveOrbState,
} from "./companionOrb";

describe("deriveOrbState", () => {
  it("待機時是 idle", () => {
    expect(deriveOrbState({}).state).toBe("idle");
  });

  it("聆聽蓋過任何背景訊號——使用者正按著螢幕", () => {
    const view = deriveOrbState({
      listening: true,
      executing: true,
      awaitingConfirmation: true,
      failed: true,
      unreadNotifications: 3,
    });
    expect(view.state).toBe("listening");
  });

  it("待確認優先於執行中：人被擋住比機器在忙重要", () => {
    expect(deriveOrbState({ executing: true, awaitingConfirmation: true }).state)
      .toBe("waiting_confirmation");
  });

  it("只有 executing 帶進度環", () => {
    expect(deriveOrbState({ executing: true, progress: 0.5 }).progress).toBe(0.5);
    expect(deriveOrbState({ thinking: true, progress: 0.5 }).progress).toBeUndefined();
  });

  it("進度夾在 0–1 並取到 1%", () => {
    expect(deriveOrbState({ executing: true, progress: 1.9 }).progress).toBe(1);
    expect(deriveOrbState({ executing: true, progress: -2 }).progress).toBe(0);
    expect(deriveOrbState({ executing: true, progress: 0.12345 }).progress).toBe(0.12);
  });

  it("NaN 進度不會漏成 NaN 進到畫面", () => {
    expect(deriveOrbState({ executing: true, progress: Number.NaN }).progress).toBe(0);
  });

  it("未讀提醒在沒有別的事情時才變成 notification", () => {
    expect(deriveOrbState({ unreadNotifications: 2 }).state).toBe("notification");
    expect(deriveOrbState({ unreadNotifications: 2, thinking: true }).state).toBe("thinking");
  });

  it("同一份訊號永遠得到同一顆球（純投影）", () => {
    const signals = { executing: true, progress: 0.3 };
    expect(deriveOrbState(signals)).toEqual(deriveOrbState(signals));
  });
});

describe("一次性狀態", () => {
  it("success／error／notification 會自己退場，其餘不會", () => {
    expect(isTransientOrbState("success")).toBe(true);
    expect(isTransientOrbState("error")).toBe(true);
    expect(isTransientOrbState("notification")).toBe(true);
    expect(isTransientOrbState("idle")).toBe(false);
    expect(isTransientOrbState("executing")).toBe(false);
    expect(isTransientOrbState("listening")).toBe(false);
  });

  it("error 停留得比 success 久——壞消息要看得到", () => {
    expect(ORB_TRANSIENT_MS.error!).toBeGreaterThan(ORB_TRANSIENT_MS.success!);
  });
});

describe("resolveOrbState", () => {
  it("高優先序蓋過低的", () => {
    expect(resolveOrbState("idle", "error")).toBe("error");
    expect(resolveOrbState("error", "idle")).toBe("error");
  });

  it("同優先序取較新的事實", () => {
    expect(resolveOrbState("success", "success")).toBe("success");
  });

  it("每個狀態都有優先序（新增狀態不會靜靜掉到 undefined）", () => {
    for (const state of ORB_STATES) expect(Number.isFinite(orbPriority(state))).toBe(true);
  });
});

describe("orbAccessibleLabel", () => {
  it("Orb 不是純視覺物件：每個狀態都唸得出來", () => {
    for (const state of ORB_STATES) {
      const label = orbAccessibleLabel(state);
      expect(label.startsWith("AIOS 助手，")).toBe(true);
      expect(label.length).toBeGreaterThan(8);
    }
  });

  it("執行中會唸出百分比", () => {
    expect(orbAccessibleLabel("executing", 0.68)).toContain("68%");
  });

  it("待確認唸的是「查看待確認」而不是「開始對話」", () => {
    expect(orbAccessibleLabel("waiting_confirmation")).toContain("待確認");
  });
});

describe("orbMotionPlan", () => {
  it("預設是完整動畫", () => {
    const plan = orbMotionPlan({ cores: 8, memoryGb: 8 });
    expect(plan.tier).toBe("full");
    expect(plan.particles).toBeGreaterThan(0);
    expect(plan.swirl).toBe(true);
  });

  it("prefers-reduced-motion 降到 reduced：留呼吸、拿掉粒子與漂浮", () => {
    const plan = orbMotionPlan({ prefersReducedMotion: true, cores: 8 });
    expect(plan.tier).toBe("reduced");
    expect(plan.particles).toBe(0);
    expect(plan.floatPx).toBe(0);
    expect(plan.breathe).toBe(true);
  });

  it("低記憶體裝置直接 still——能力問題不是偏好問題", () => {
    expect(orbMotionPlan({ memoryGb: 2 }).tier).toBe("still");
  });

  it("少核心 CPU 降到 reduced", () => {
    expect(orbMotionPlan({ cores: 4 }).tier).toBe("reduced");
  });

  it("背景時一律 still，連使用者覆寫都不例外", () => {
    const plan = orbMotionPlan({ backgrounded: true, userOverride: "full" });
    expect(plan.tier).toBe("still");
    expect(plan.fps).toBe(0);
  });

  it("使用者覆寫勝過偵測", () => {
    expect(orbMotionPlan({ userOverride: "full", memoryGb: 1 }).tier).toBe("full");
  });

  it("省電與節省數據都會降級", () => {
    expect(orbMotionPlan({ saveBattery: true, cores: 8 }).tier).toBe("reduced");
    expect(orbMotionPlan({ saveData: true, cores: 8 }).tier).toBe("reduced");
  });

  it("降級理由講得出來（診斷用）", () => {
    expect(orbMotionPlan({ memoryGb: 1 }).reason).toContain("1GB");
  });
});

describe("companionOrbToLegacy", () => {
  it("八態都投影得到既有四態", () => {
    const legacy = new Set(ORB_STATES.map(companionOrbToLegacy));
    expect([...legacy].every((s) => ["idle", "thinking", "speaking", "error"].includes(s))).toBe(true);
  });

  it("執行中與思考中在舊球上都是 thinking", () => {
    expect(companionOrbToLegacy("executing")).toBe("thinking");
    expect(companionOrbToLegacy("thinking")).toBe("thinking");
  });
});
