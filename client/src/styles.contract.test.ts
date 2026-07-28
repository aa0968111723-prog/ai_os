import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");

describe("global stylesheet contract", () => {
  it("retains the complete application layout instead of only theme tokens", () => {
    expect(styles.length).toBeGreaterThan(30_000);
    expect(styles).toContain(".app {");
    expect(styles).toContain(".topbar {");
    expect(styles).toContain(".launch-grid {");
    expect(styles).toContain(".dm-layout {");
  });
});
