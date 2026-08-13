import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scenes = readFileSync(join(process.cwd(), "server/routers/scenes.ts"), "utf8");
const core = readFileSync(join(process.cwd(), "server/services/generationCore.ts"), "utf8");

describe("scene visual variant architecture", () => {
  it("fans out 2–4 idempotent jobs through the one generation command", () => {
    const block = scenes.slice(scenes.indexOf("generateVariants:"), scenes.indexOf("generateVariants:") + 5000);
    expect(block).toContain(".min(2).max(4)");
    expect(block).toContain("executeGenerationCommand({");
    expect(block).toContain("id,");
    expect(block).toContain("Promise.allSettled");
    expect(block).toContain("preserveScenePointer: true");
    expect(block).not.toContain("submitGenerationCore");
  });

  it("lands assets as versions but protects current until explicit adoption", () => {
    expect(core).toContain("splitGenerationSourceMeta(gen.params).meta.preserveScenePointer !== true");
    expect(core).toContain(".insert(schema.assets)");
  });
});
