import { describe, expect, it } from "vitest";
import {
  createRequestTiming,
  currentRequestTiming,
  formatRequestTiming,
  markTiming,
  measureTiming,
  readMark,
  recordTimingSegment,
  runWithRequestTiming,
} from "./requestTiming";

describe("requestTiming", () => {
  it("沒有進行中的請求脈絡時所有 record 都是 no-op", async () => {
    expect(currentRequestTiming()).toBeUndefined();
    markTiming("firstToken");
    recordTimingSegment("db", 10);
    // 沒有脈絡時 measureTiming 仍要照常執行受測函式，只是不記帳
    await expect(measureTiming("s3", async () => "ok")).resolves.toBe("ok");
  });

  it("分開累計 db／s3／llm，並記下次數與總毫秒", async () => {
    const timing = createRequestTiming("test.ask", Date.now());
    await runWithRequestTiming(timing, async () => {
      recordTimingSegment("db", 30);
      recordTimingSegment("db", 12);
      recordTimingSegment("s3", 88);
    });
    expect(timing.buckets.get("db")).toEqual({ count: 2, totalMs: 42 });
    expect(timing.buckets.get("s3")).toEqual({ count: 1, totalMs: 88 });
    expect(timing.buckets.get("llm")).toBeUndefined();
  });

  it("時間點只認第一次——首 token 不會被後面的 token 覆寫", async () => {
    const timing = createRequestTiming("test.ask", Date.now() - 500);
    runWithRequestTiming(timing, () => {
      markTiming("firstToken");
      const first = readMark("firstToken");
      markTiming("firstToken");
      expect(readMark("firstToken")).toBe(first);
    });
    expect(timing.marks.get("firstToken")).toBeGreaterThanOrEqual(500);
  });

  it("受測函式丟錯時仍要記下那一段耗時", async () => {
    const timing = createRequestTiming("test.ask", Date.now());
    await runWithRequestTiming(timing, async () => {
      await expect(
        measureTiming("db", async () => {
          throw new Error("DB 掛了");
        }),
      ).rejects.toThrow("DB 掛了");
    });
    expect(timing.buckets.get("db")?.count).toBe(1);
  });

  it("跨 await 仍留在同一個計時脈絡（ALS 不會在非同步邊界掉脈絡）", async () => {
    const timing = createRequestTiming("test.ask", Date.now());
    await runWithRequestTiming(timing, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      recordTimingSegment("llm", 7);
    });
    expect(timing.buckets.get("llm")).toEqual({ count: 1, totalMs: 7 });
  });

  it("格式化成一行可 grep 的摘要", () => {
    const timing = createRequestTiming("assistant.ask", Date.now());
    timing.marks.set("firstToken", 246);
    timing.buckets.set("db", { count: 12, totalMs: 310 });
    const line = formatRequestTiming(timing, 1820);
    expect(line).toContain("[timing] assistant.ask");
    expect(line).toContain("total=1820ms");
    expect(line).toContain("firstToken=246ms");
    expect(line).toContain("db=12");
    expect(line).toContain("310ms");
  });
});
