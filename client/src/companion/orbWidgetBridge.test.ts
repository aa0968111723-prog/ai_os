import { beforeEach, describe, expect, it, vi } from "vitest";
import { pushOrbStateToWidget, widgetLabel } from "./orbWidgetBridge";

beforeEach(() => {
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe("widgetLabel", () => {
  it("講「現在有什麼在等你」，不是狀態機的名字", () => {
    expect(widgetLabel("idle", { awaiting: 2, failed: 0, running: 0 })).toBe("2 件等你確認");
    expect(widgetLabel("idle", { awaiting: 0, failed: 3, running: 0 })).toBe("3 個生成失敗了");
    expect(widgetLabel("idle", { awaiting: 0, failed: 0, running: 1 })).toBe("1 個生成進行中");
  });

  it("待確認優先於失敗與進行中", () => {
    expect(widgetLabel("idle", { awaiting: 1, failed: 9, running: 9 })).toBe("1 件等你確認");
  });

  it("沒事情時給的是可以按的一句話，不是空白", () => {
    expect(widgetLabel("idle", { awaiting: 0, failed: 0, running: 0 })).toBe("點一下跟 Aios 說話");
    expect(widgetLabel("thinking", { awaiting: 0, failed: 0, running: 0 })).toBe("我正在想…");
  });
});

describe("pushOrbStateToWidget", () => {
  it("沒有外掛時安靜不做事——瀏覽器與桌機是常態，不是錯誤", () => {
    expect(() => pushOrbStateToWidget("idle", "點一下")).not.toThrow();
  });

  it("有外掛時把狀態與文案送過去", () => {
    const setState = vi.fn(() => Promise.resolve());
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { AiosOrbWidget: { setState } } };
    pushOrbStateToWidget("executing", "1 個生成進行中");
    expect(setState).toHaveBeenCalledWith({ state: "executing", label: "1 個生成進行中" });
  });

  it("外掛失敗不會冒出使用者看得到的錯誤", async () => {
    const setState = vi.fn(() => Promise.reject(new Error("no widget")));
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { AiosOrbWidget: { setState } } };
    expect(() => pushOrbStateToWidget("error", "壞了")).not.toThrow();
    await Promise.resolve();
  });
});
