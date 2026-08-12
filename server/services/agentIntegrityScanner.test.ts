import { describe, expect, it } from "vitest";
import { formatIntegrityReport, type IntegrityScanReport } from "./agentIntegrityScanner";

describe("agentIntegrityScanner formatting", () => {
  it("renders a readable empty report", () => {
    const report: IntegrityScanReport = {
      scannedAt: "2026-08-12T00:00:00.000Z",
      findings: [],
      ok: true,
      p0Count: 0,
      p1Count: 0,
    };
    const text = formatIntegrityReport(report);
    expect(text).toContain("ok=true");
    expect(text).toContain("No integrity findings");
  });

  it("renders severity, code, and sample ids", () => {
    const report: IntegrityScanReport = {
      scannedAt: "2026-08-12T00:00:00.000Z",
      findings: [{
        code: "EFFECT_NOTE_MISSING",
        severity: "P0",
        summary: "missing note",
        count: 2,
        sampleIds: ["a", "b"],
      }],
      ok: false,
      p0Count: 1,
      p1Count: 0,
    };
    const text = formatIntegrityReport(report);
    expect(text).toContain("[P0] EFFECT_NOTE_MISSING");
    expect(text).toContain("samples=a,b");
  });
});
