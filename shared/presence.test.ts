import { describe, expect, it } from "vitest";
import { PRESENCE_ONLINE_MS, PRESENCE_RECENT_MS, presenceLabel, presenceState } from "./presence";

const NOW = new Date("2026-07-31T10:00:00.000Z").getTime();
const ago = (ms: number) => new Date(NOW - ms);

describe("presenceState（上線三態）", () => {
  it("剛剛有動作＝上線中", () => {
    expect(presenceState(ago(0), NOW)).toBe("online");
    expect(presenceState(ago(60_000), NOW)).toBe("online");
  });

  it("超過上線窗、未滿剛離開窗＝recent", () => {
    expect(presenceState(ago(PRESENCE_ONLINE_MS), NOW)).toBe("recent");
    expect(presenceState(ago(10 * 60_000), NOW)).toBe("recent");
  });

  it("超過剛離開窗＝離線（邊界值本身即離線）", () => {
    expect(presenceState(ago(PRESENCE_RECENT_MS), NOW)).toBe("offline");
    expect(presenceState(ago(60 * 60_000), NOW)).toBe("offline");
  });

  it("沒有紀錄＝離線（不是「不知道」就當上線）", () => {
    expect(presenceState(null, NOW)).toBe("offline");
    expect(presenceState(undefined, NOW)).toBe("offline");
    expect(presenceState("不是時間", NOW)).toBe("offline");
  });

  it("時鐘落差造成的未來時刻仍算上線中，不會閃成離線", () => {
    expect(presenceState(new Date(NOW + 30_000), NOW)).toBe("online");
  });

  it("接受字串與毫秒數（superjson 之外的快取路徑）", () => {
    expect(presenceState(ago(30_000).toISOString(), NOW)).toBe("online");
    expect(presenceState(NOW - 30_000, NOW)).toBe("online");
  });
});

describe("presenceLabel（顏色之外的文字訊息）", () => {
  it("上線中／離線給固定字", () => {
    expect(presenceLabel(ago(10_000), NOW)).toBe("上線中");
    expect(presenceLabel(null, NOW)).toBe("離線");
    expect(presenceLabel(ago(2 * PRESENCE_RECENT_MS), NOW)).toBe("離線");
  });

  it("剛離開帶分鐘數（四捨五入，至少 1 分鐘）", () => {
    expect(presenceLabel(ago(5 * 60_000), NOW)).toBe("5 分鐘前在線");
    expect(presenceLabel(ago(5 * 60_000 + 20_000), NOW)).toBe("5 分鐘前在線");
    expect(presenceLabel(ago(14 * 60_000), NOW)).toBe("14 分鐘前在線");
  });
});
