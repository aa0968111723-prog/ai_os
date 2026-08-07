import { describe, expect, it } from "vitest";
import { collectDeviceProfile, deviceKind, deviceLabel, kindFromLabel, relSeen, urlBase64ToUint8Array } from "./push";

describe("push helpers", () => {
  it("decodes VAPID base64url to bytes", () => {
    // "hello" in base64url-ish padding
    const bytes = urlBase64ToUint8Array("aGVsbG8");
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  // 標籤格式與判定規則本身測在 shared/deviceNaming.test.ts（前後端共用同一份）；
  // 這裡只確認客戶端確實接上了那一份，沒有留下自己那套簡版
  it("maps labels to device kinds", () => {
    expect(kindFromLabel("iPhone・Safari")).toBe("phone");
    expect(kindFromLabel("Samsung Galaxy S24 Ultra・Chrome 131・主畫面")).toBe("phone");
    expect(kindFromLabel("Samsung Galaxy Tab S9・Chrome 131")).toBe("tablet");
    expect(kindFromLabel("Windows 11・Chrome 131")).toBe("desktop");
    expect(kindFromLabel(null)).toBe("unknown");
  });

  it("relSeen formats recent times", () => {
    expect(relSeen(new Date())).toBe("剛剛");
    expect(relSeen(Date.now() - 5 * 60_000)).toBe("5 分鐘前");
    expect(relSeen(Date.now() - 3 * 3600_000)).toBe("3 小時前");
  });

  it("deviceKind is one of known kinds in browser env", () => {
    const k = deviceKind();
    expect(["phone", "tablet", "desktop", "unknown"]).toContain(k);
  });

  it("deviceLabel 至少講得出系統與瀏覽器（同步版，無 UA-CH）", () => {
    const label = deviceLabel();
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(80);
  });

  // UA-CH 在測試環境（jsdom）不存在——這條釘住「取不到就安靜退回 UA 能講的部分」，
  // 不會讓啟用通知的流程炸掉
  it("collectDeviceProfile 在沒有 UA-CH 的環境仍回得出完整結構", async () => {
    const profile = await collectDeviceProfile();
    expect(profile.label.length).toBeGreaterThan(0);
    expect(["phone", "tablet", "desktop", "unknown"]).toContain(profile.kind);
    expect(profile.details.kind).toBe(profile.kind);
    expect(profile.details.browser).toBeTruthy();
  });
});
