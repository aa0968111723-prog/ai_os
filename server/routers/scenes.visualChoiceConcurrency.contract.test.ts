import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "server/routers/scenes.ts"), "utf8");

describe("visual choice write concurrency", () => {
  it("guards setCards with the existing scene revision mechanism", () => {
    const start = source.indexOf("setCards:");
    const block = source.slice(start, source.indexOf("generateInto:", start));
    expect(block).toContain("expectedRev:");
    expect(block).toContain("baseline:");
    expect(block).toContain("applyWithRevision({");
    expect(block).toContain('entity: "scene"');
  });
});
