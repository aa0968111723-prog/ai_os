import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalEnv } from "./loadEnv";

describe("loadLocalEnv", () => {
  it("fills only missing keys and never requires printing the value", () => {
    const dir = mkdtempSync(join(tmpdir(), "aios-env-"));
    writeFileSync(join(dir, ".env"), "AIOS_LOADENV_PROBE=from-file\nAIOS_LOADENV_EXISTING=file-value\n");
    process.env.AIOS_LOADENV_EXISTING = "already-set";
    delete process.env.AIOS_LOADENV_PROBE;
    const first = loadLocalEnv(dir);
    expect(first.loaded).toBe(true);
    expect(first.filledKeys).toBeGreaterThan(0);
    expect(process.env.AIOS_LOADENV_PROBE).toBe("from-file");
    expect(process.env.AIOS_LOADENV_EXISTING).toBe("already-set");
    const second = loadLocalEnv(dir);
    expect(second.filledKeys).toBe(0);
    delete process.env.AIOS_LOADENV_PROBE;
    delete process.env.AIOS_LOADENV_EXISTING;
  });
});
