import { describe, it, expect, beforeEach } from "vitest";
import {
  computeSimpleSteps,
  currentSimpleStepIndex,
  defaultProjectMode,
  loadProjectMode,
  resolveProjectMode,
  runningVisualCount,
  saveProjectMode,
  scenesNeedingVisual,
  scenesReadyToSubmit,
  splitScriptReadiness,
  type SimpleScene,
} from "./simpleMode";

const scene = (over: Partial<SimpleScene> = {}): SimpleScene => ({
  id: crypto.randomUUID(),
  title: "鏡",
  status: "todo",
  assetUrl: null,
  prompt: "提示詞",
  ...over,
});

describe("預設模式", () => {
  beforeEach(() => localStorage.clear());

  it("空專案給簡易模式，開工過的專案維持完整版", () => {
    expect(defaultProjectMode({ sceneCount: 0, generationCount: 0 })).toBe("simple");
    // 已經有分鏡＝使用者正在用完整版工作，切走會藏起他正在用的東西
    expect(defaultProjectMode({ sceneCount: 3, generationCount: 0 })).toBe("pro");
    expect(defaultProjectMode({ sceneCount: 0, generationCount: 5 })).toBe("pro");
  });

  it("存過的偏好蓋過預設判定，且逐專案獨立", () => {
    saveProjectMode("p1", "pro");
    expect(resolveProjectMode("p1", { sceneCount: 0, generationCount: 0 })).toBe("pro");
    expect(resolveProjectMode("p2", { sceneCount: 0, generationCount: 0 })).toBe("simple");
  });

  it("localStorage 壞值當作沒存過", () => {
    localStorage.setItem("aios.projectMode.p3", "garbage");
    expect(loadProjectMode("p3")).toBeNull();
  });
});

describe("四步進度", () => {
  it("全部由伺服器資料推導——重整後同一組資料算出同一個進度", () => {
    const scenes = [scene({ assetUrl: "a.png", status: "approved" }), scene({ assetUrl: "b.png", status: "approved" })];
    const steps = computeSimpleSteps({ worldviewReady: true, scenes });
    expect(steps.map((s) => s.done)).toEqual([true, true, true, true]);
    expect(currentSimpleStepIndex(steps)).toBe(4);
  });

  it("畫面沒出齊時停在第三步，且提示帶出 N／M", () => {
    const scenes = [scene({ assetUrl: "a.png" }), scene()];
    const steps = computeSimpleSteps({ worldviewReady: true, scenes });
    expect(currentSimpleStepIndex(steps)).toBe(2);
    expect(steps[2].hint).toContain("1／2");
  });

  it("沒有分鏡時第三、四步不算完成（否則空專案會顯示已交付）", () => {
    const steps = computeSimpleSteps({ worldviewReady: true, scenes: [] });
    expect(steps.map((s) => s.done)).toEqual([true, false, false, false]);
  });
});

describe("批次動作的挑選規則", () => {
  it("已在生成中的格子不重送（重複送＝白扣點又互相覆蓋）", () => {
    const list = [scene(), scene({ pendingGenStatus: "running" }), scene({ assetUrl: "x.png" })];
    expect(scenesNeedingVisual(list)).toHaveLength(1);
    expect(runningVisualCount(list)).toBe(1);
  });

  it("送審只挑有畫面且尚未送審／通過的格子", () => {
    const list = [
      scene({ assetUrl: "a.png" }),
      scene({ assetUrl: "b.png", status: "pending" }),
      scene({ assetUrl: "c.png", status: "approved" }),
      scene(),
    ];
    expect(scenesReadyToSubmit(list)).toHaveLength(1);
  });
});

describe("拆分鏡輸入檢查", () => {
  it("字太少時先給白話提示，不要按了才吃後端 zod 錯誤", () => {
    expect(splitScriptReadiness("").ok).toBe(false);
    expect(splitScriptReadiness("太短").reason).toContain("至少 20 字");
    expect(splitScriptReadiness("鏡1：清晨捷運月台，阿明疲憊滑著手機，旁白：你有多久沒好好呼吸").ok).toBe(true);
    expect(splitScriptReadiness("字".repeat(8001)).reason).toContain("上限");
  });
});
