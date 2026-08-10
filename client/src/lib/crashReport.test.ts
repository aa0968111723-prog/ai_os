/**
 * 崩潰診斷的測試。這支東西存在的理由是「使用者回報得出可行動的資訊」，
 * 所以它自己絕對不能在錯誤路徑上再炸一次——畸形 error 物件是常態，不是例外。
 */
import { describe, expect, it } from "vitest";
import {
  buildCrashReport,
  displayCrashHeadline,
  isChunkLoadError,
  isMinifiedReactError,
  minifiedReactErrorCode,
} from "./crashReport";

describe("isChunkLoadError", () => {
  it("recognises the dynamic-import failure shapes browsers actually emit", () => {
    const chunky = [
      new Error("Failed to fetch dynamically imported module: https://x/assets/ProjectPage-abc.js"),
      new Error("error loading dynamically imported module"),
      new Error("Importing a module script failed."),
      new Error("Loading chunk 42 failed."),
      new Error("Loading CSS chunk 7 failed."),
      Object.assign(new Error("boom"), { name: "ChunkLoadError" }),
    ];
    for (const e of chunky) expect(isChunkLoadError(e), e.message).toBe(true);
  });

  it("does not misclassify ordinary application errors", () => {
    for (const e of [
      new Error("Cannot read properties of undefined (reading 'map')"),
      new TypeError("wv.themes is not a function"),
      null,
      undefined,
      "",
    ]) {
      expect(isChunkLoadError(e)).toBe(false);
    }
  });
});

describe("buildCrashReport", () => {
  it("puts the real error on the first line so a screenshot is enough to diagnose", () => {
    const err = new Error("wv.themes.filter is not a function");
    const r = buildCrashReport(err, "\n    at ProjectPage\n    at Suspense");
    expect(r.headline).toBe("Error: wv.themes.filter is not a function");
    expect(r.detail).toContain("wv.themes.filter is not a function");
    expect(r.detail).toContain("ProjectPage");
  });

  it("includes url/userAgent/time context when given", () => {
    const r = buildCrashReport(new Error("x"), null, {
      url: "https://a.test/project/p-1",
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
      at: "2026-08-05T05:05:00.000Z",
    });
    expect(r.detail).toContain("https://a.test/project/p-1");
    expect(r.detail).toContain("Android 14");
    expect(r.detail).toContain("2026-08-05T05:05:00.000Z");
  });

  it("never throws on malformed error values", () => {
    const nasty: unknown[] = [
      null,
      undefined,
      "字串錯誤",
      42,
      {},
      { message: 123, name: {}, stack: [] },
      { get message() { throw new Error("evil getter"); } },
      Object.create(null),
    ];
    for (const e of nasty) {
      expect(() => buildCrashReport(e, null)).not.toThrow();
      expect(buildCrashReport(e, null).headline.length).toBeGreaterThan(0);
    }
  });

  it("clips runaway stacks so the card stays readable", () => {
    const err = Object.assign(new Error("x"), { stack: "at f\n".repeat(5000) });
    const r = buildCrashReport(err, "at C\n".repeat(5000));
    expect(r.detail).toContain("（已截斷）");
    expect(r.detail.length).toBeLessThan(8000);
  });
});

describe("minified React error helpers", () => {
  const mini = new Error(
    "Minified React error #185; visit https://react.dev/errors/185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.",
  );

  it("detects minified React errors and extracts the code", () => {
    expect(isMinifiedReactError(mini)).toBe(true);
    expect(minifiedReactErrorCode(mini)).toBe("185");
    expect(isMinifiedReactError(new Error("Cannot read properties of undefined"))).toBe(false);
  });

  it("displayCrashHeadline never surfaces the raw Minified message", () => {
    const report = buildCrashReport(mini, "\n    at ShotCard");
    // 診斷用 detail 仍保留原始訊息（回報用）
    expect(report.detail).toContain("Minified React error #185");
    // UI 摘要只露簡短碼
    expect(displayCrashHeadline(mini, report)).toBe("React 內部錯誤 #185");
    expect(displayCrashHeadline(mini, report)).not.toMatch(/Minified|react\.dev/i);
  });

  it("displayCrashHeadline keeps ordinary error headlines", () => {
    const err = new Error("wv.themes.filter is not a function");
    const report = buildCrashReport(err);
    expect(displayCrashHeadline(err, report)).toBe("Error: wv.themes.filter is not a function");
  });
});
