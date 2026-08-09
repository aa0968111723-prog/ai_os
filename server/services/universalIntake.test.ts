import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sha256File } from "./universalIntake";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("universal intake byte handling", () => {
  it("computes the exact SHA-256 through a file stream", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ai-os-intake-test-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "result.bin");
    const bytes = Buffer.concat([Buffer.alloc(128 * 1024, 7), Buffer.from("external-result")]);
    await writeFile(file, bytes);
    expect(await sha256File(file)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });
});
