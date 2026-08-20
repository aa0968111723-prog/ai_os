import { describe, expect, it } from "vitest";
import {
  PHONE_MAX_WIDTH,
  deviceClassForWidth,
  detectNativeShell,
  isCompanionSurface,
  resolveSurface,
} from "./companionSurface";

describe("deviceClassForWidth", () => {
  it("768 以上就不是手機（與 viewport.ts 同界線）", () => {
    expect(deviceClassForWidth(390)).toBe("phone");
    expect(deviceClassForWidth(PHONE_MAX_WIDTH)).toBe("phone");
    expect(deviceClassForWidth(768)).toBe("tablet");
    expect(deviceClassForWidth(1024)).toBe("tablet");
    expect(deviceClassForWidth(1440)).toBe("desktop");
  });

  it("量不到寬度時當桌機——寧可給完整版，也不要把桌機鎖進單手介面", () => {
    expect(deviceClassForWidth(0)).toBe("desktop");
    expect(deviceClassForWidth(Number.NaN)).toBe("desktop");
  });
});

describe("resolveSurface", () => {
  it("平板一律完整工作站，就算裝了 App 也一樣", () => {
    expect(resolveSurface({ width: 768, nativeShell: true }).surface).toBe("workspace");
    expect(resolveSurface({ width: 1024, nativeShell: true }).surface).toBe("workspace");
  });

  it("桌機永遠是工作站", () => {
    expect(resolveSurface({ width: 1440 }).surface).toBe("workspace");
  });

  it("手機瀏覽器拿的是 mobile_web，不是 Companion——分享連結要打得開", () => {
    expect(resolveSurface({ width: 390 }).surface).toBe("mobile_web");
  });

  it("手機原生 App 才是 Companion", () => {
    const decision = resolveSurface({ width: 390, nativeShell: true });
    expect(decision.surface).toBe("companion");
    expect(decision.device).toBe("phone");
  });

  it("使用者選完整工作站時，任何偵測都讓位", () => {
    expect(resolveSurface({ width: 390, nativeShell: true, forceWorkspace: true }).surface)
      .toBe("workspace");
  });

  it("?surface=companion 只在手機寬度生效", () => {
    expect(resolveSurface({ width: 390, forceCompanion: true }).surface).toBe("companion");
    expect(resolveSurface({ width: 1024, forceCompanion: true }).surface).toBe("workspace");
  });

  it("每個答案都講得出理由", () => {
    expect(resolveSurface({ width: 1024 }).reason).toContain("平板");
    expect(resolveSurface({ width: 390 }).reason.length).toBeGreaterThan(0);
  });
});

describe("detectNativeShell", () => {
  it("認 Capacitor API", () => {
    expect(detectNativeShell({ capacitorNative: true })).toBe(true);
  });

  it("也認 UA 尾巴——bridge 注入前的第一個 render 就要判得出來", () => {
    expect(detectNativeShell({ userAgent: "Mozilla/5.0 (Linux; Android 14) AiosApp/1.0" })).toBe(true);
  });

  it("一般手機瀏覽器不是原生外殼", () => {
    expect(detectNativeShell({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" })).toBe(false);
    expect(detectNativeShell({})).toBe(false);
  });
});

describe("isCompanionSurface", () => {
  it("只有 companion 掛 Companion 樣式", () => {
    expect(isCompanionSurface("companion")).toBe(true);
    expect(isCompanionSurface("mobile_web")).toBe(false);
    expect(isCompanionSurface("workspace")).toBe(false);
  });
});
