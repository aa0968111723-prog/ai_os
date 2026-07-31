import { describe, expect, it } from "vitest";
import { PRESENCE_TOUCH_MIN_MS, shouldWritePresence } from "./presence";
import { PRESENCE_ONLINE_MS } from "../../shared/presence";

describe("presence 心跳節流", () => {
  it("沒寫過就寫", () => {
    expect(shouldWritePresence(undefined, 1_000)).toBe(true);
  });

  it("節流窗內不重複寫（每個 API 呼叫都寫會把 DB 灌爆）", () => {
    expect(shouldWritePresence(1_000, 1_000 + PRESENCE_TOUCH_MIN_MS - 1)).toBe(false);
    expect(shouldWritePresence(1_000, 1_000)).toBe(false);
  });

  it("超過節流窗就寫", () => {
    expect(shouldWritePresence(1_000, 1_000 + PRESENCE_TOUCH_MIN_MS)).toBe(true);
  });

  it("時鐘回撥（NTP 校正）不會卡住整段時間不更新", () => {
    expect(shouldWritePresence(10_000, 5_000)).toBe(true);
  });

  it("心跳頻率必須明顯快於上線窗，否則正在用的人會掉出線上", () => {
    // 這條不變式才是兩個常數之所以是這兩個值的原因——動任一個都要重新看這裡
    expect(PRESENCE_TOUCH_MIN_MS * 2).toBeLessThan(PRESENCE_ONLINE_MS);
  });
});
