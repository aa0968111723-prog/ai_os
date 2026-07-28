import { describe, expect, it } from "vitest";
import { deviceKind, kindFromLabel, relSeen, urlBase64ToUint8Array } from "./push";

describe("push helpers", () => {
  it("decodes VAPID base64url to bytes", () => {
    // "hello" in base64url-ish padding
    const bytes = urlBase64ToUint8Array("aGVsbG8");
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it("maps labels to device kinds", () => {
    expect(kindFromLabel("iPhone・Safari")).toBe("phone");
    expect(kindFromLabel("Android・Chrome")).toBe("phone");
    expect(kindFromLabel("iPad・Safari")).toBe("tablet");
    expect(kindFromLabel("Windows・Chrome")).toBe("desktop");
    expect(kindFromLabel("Mac・Safari・主畫面")).toBe("desktop");
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
});
