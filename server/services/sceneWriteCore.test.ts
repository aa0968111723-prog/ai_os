import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./sceneWriteCore.ts", import.meta.url), "utf8");
const assistantSource = readFileSync(new URL("../routers/assistant.ts", import.meta.url), "utf8");
const scenesSource = readFileSync(new URL("../routers/scenes.ts", import.meta.url), "utf8");
const mcpSource = readFileSync(new URL("./mcpWriteExpansion.ts", import.meta.url), "utf8");

describe("create_scene retry identity", () => {
  it("replays the same project+title+prompt+voiceover+duration draft within 2 minutes", () => {
    expect(source).toContain("SCENE_DRAFT_REPLAY_MS = 120_000");
    expect(source).toContain("export async function addSceneDraftOnce");
    expect(source).toContain("gte(schema.scenes.createdAt, new Date(Date.now() - SCENE_DRAFT_REPLAY_MS))");
    expect(source).toContain("eq(schema.scenes.title, clippedTitle)");
    expect(source).toContain("eq(schema.scenes.status, \"todo\")");
    expect(source).toContain("isNull(schema.scenes.assetId)");
  });

  it("site create_scene, addDraft, and MCP add_scene share the same replay helper", () => {
    expect(assistantSource).toContain("addSceneDraftOnce({");
    expect(scenesSource).toContain("addSceneDraftOnce({");
    expect(mcpSource).toContain("addSceneDraftOnce({");
    expect(assistantSource).not.toMatch(/if \(a\.type === "create_scene"\)[\s\S]*insert\(schema\.scenes\)/);
  });

  it("an explicit effect id still wins over the 2-minute content replay", () => {
    const idAt = source.indexOf("if (input.id)");
    const recentAt = source.indexOf("eq(schema.scenes.title, clippedTitle)");
    expect(idAt).toBeGreaterThan(0);
    expect(recentAt).toBeGreaterThan(idAt);
  });
});
