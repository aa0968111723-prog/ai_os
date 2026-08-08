import { describe, expect, it } from "vitest";
import { dotVisibleAt, formatTMs, TMS_NEAR_WINDOW_MS } from "./timecode";

describe("formatTMs（影片留言的時間碼顯示）", () => {
  it("慣例格式 mm:ss；超過一小時才帶小時位", () => {
    expect(formatTMs(0)).toBe("00:00");
    expect(formatTMs(18_000)).toBe("00:18");
    expect(formatTMs(62_500)).toBe("01:02"); // 毫秒尾數捨去——顯示秒級就夠指回原處
    expect(formatTMs(3_723_000)).toBe("1:02:03");
  });
  it("負值夾成 0，不顯示「-0:01」這種東西", () => {
    expect(formatTMs(-500)).toBe("00:00");
  });
});

describe("dotVisibleAt（圓點只在播放頭接近時顯示）", () => {
  it("靜態圖標注（tMs=null）一律顯示——既有行為一個位元都不變", () => {
    expect(dotVisibleAt(null, 5_000)).toBe(true);
    expect(dotVisibleAt(undefined, 0)).toBe(true);
  });
  it("播放頭在 ±1.5s 內才顯示", () => {
    expect(dotVisibleAt(18_000, 18_000)).toBe(true);
    expect(dotVisibleAt(18_000, 18_000 + TMS_NEAR_WINDOW_MS)).toBe(true);
    expect(dotVisibleAt(18_000, 18_000 + TMS_NEAR_WINDOW_MS + 1)).toBe(false);
    expect(dotVisibleAt(18_000, 5_000)).toBe(false);
  });
  it("量不到播放頭（媒體不是影片／資料異常）寧可顯示——一則存在的標注不可以無症狀地消失", () => {
    expect(dotVisibleAt(18_000, null)).toBe(true);
  });
});
