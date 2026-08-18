import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(import.meta.dirname, "../..");
const CI_YML = resolve(ROOT, ".github/workflows/ci.yml");

function e2eSuiteLoop(yml: string): string[] {
  const m = yml.match(/for suite in ([^\n;]+);/);
  if (!m) throw new Error("ci.yml e2e job is missing `for suite in …`");
  return m[1].trim().split(/\s+/);
}

describe("CI e2e matrix", () => {
  const yml = readFileSync(CI_YML, "utf8");
  const suites = e2eSuiteLoop(yml);

  it("keeps the existing API suites (do not drop them to stay green)", () => {
    expect(suites).toEqual(expect.arrayContaining([
      "auth",
      "models",
      "phase2",
      "phase3",
      "phase4",
      "story",
      "messages",
      "databases",
      "agent",
      "mcp",
      "push",
      "export",
    ]));
  });

  it("runs animation-consistency in that same E2E_MOCK loop", () => {
    expect(suites).toContain("animation-consistency");
    expect(existsSync(resolve(ROOT, "scripts/e2e-animation-consistency.py"))).toBe(true);
    expect(yml).toMatch(/E2E_MOCK:\s*"1"/);
    expect(yml).toMatch(/E2E_PORT:\s*"3199"/);
  });

  it("does not wire phone-animation-repair (Vite + Chrome + TEST_* are not in this job)", () => {
    expect(suites).not.toContain("phone-animation-repair");
    expect(yml).not.toMatch(/test:e2e:phone-animation-repair|verify-phone-animation-repair/);
  });
});
