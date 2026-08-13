import { describe, expect, it } from "vitest";
import {
  containsGeminiSecret,
  formatGeminiCertReport,
  geminiCertExitCode,
  publicGeminiCertSnapshot,
  resetGeminiCertMemoryForTests,
  runGeminiCertification,
  saveLastGeminiCert,
  shouldAutoCert,
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

describe("shouldAutoCert / public snapshot", () => {
  it("does not auto-run without a key, and refuses to persist secrets", () => {
    resetGeminiCertMemoryForTests();
    const prevKey = process.env.GEMINI_API_KEY;
    const prevBoot = process.env.GEMINI_LIVE_CERT_ON_BOOT;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_LIVE_CERT_ON_BOOT;
    try {
      expect(shouldAutoCert({ ...process.env, GEMINI_API_KEY: "" })).toBe(false);
      expect(shouldAutoCert({ ...process.env, GEMINI_API_KEY: "x", GEMINI_LIVE_CERT_ON_BOOT: "0" })).toBe(false);
      expect(shouldAutoCert({ ...process.env, GEMINI_API_KEY: "x" })).toBe(true);
      expect(publicGeminiCertSnapshot().status).toBe("NONE");
      expect(() => saveLastGeminiCert({
        configured: true,
        items: [{ name: "leak", verdict: "PASS", detail: "AIzaSyDummyTokenValue0000000000000" }],
        summary: { pass: 1, blocked: 0, fail: 0 },
        at: "2026-08-13T00:00:00.000Z",
        source: "boot",
      })).toThrow(/secret/);
    } finally {
      if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevKey;
      if (prevBoot === undefined) delete process.env.GEMINI_LIVE_CERT_ON_BOOT;
      else process.env.GEMINI_LIVE_CERT_ON_BOOT = prevBoot;
      resetGeminiCertMemoryForTests();
    }
  });
});
