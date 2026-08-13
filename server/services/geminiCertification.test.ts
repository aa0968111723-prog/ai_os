import { describe, expect, it } from "vitest";
import {
  containsGeminiSecret,
  formatGeminiCertReport,
  geminiCertExitCode,
  runGeminiCertification,
} from "./geminiCertification";

describe("containsGeminiSecret", () => {
  it("detects AIza tokens and env assignments, ignores configured=true", () => {
    expect(containsGeminiSecret("AIzaSyDummyTokenValue0000000000000")).toBe(true);
    expect(containsGeminiSecret("GEMINI_API_KEY=secret-value")).toBe(true);
    expect(containsGeminiSecret("GEMINI_API_KEY configured=true")).toBe(false);
    expect(containsGeminiSecret({ resultUrl: "stored:2026/08/a.png|image/png|12" })).toBe(false);
  });
});

describe("runGeminiCertification without live credential", () => {
  it("passes contract checks and blocks live/persist items without faking PASS", async () => {
    const prev = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const report = await runGeminiCertification({ live: true, persistAttach: true });
      expect(report.configured).toBe(false);
      const byName = Object.fromEntries(report.items.map((row) => [row.name, row]));
      expect(byName.catalog?.verdict).toBe("PASS");
      expect(byName.redact?.verdict).toBe("PASS");
      expect(byName.configured?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName["live-image"]?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName["live-edit"]?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName["live-omni"]?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName.storage?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName["generation-record"]?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName["asset-record"]?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName["shot-attach"]?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName.reload?.verdict).toBe("BLOCKED_BY_EXTERNAL_DEPENDENCY");
      expect(byName["no-secret"]?.verdict).toBe("PASS");
      expect(report.summary.fail).toBe(0);
      expect(report.summary.pass).toBeGreaterThan(0);
      expect(geminiCertExitCode(report)).toBe(2);
      const text = formatGeminiCertReport(report);
      expect(text).toContain("configured=false");
      expect(text).not.toMatch(/AIza/);
      expect(containsGeminiSecret(report)).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });
});
