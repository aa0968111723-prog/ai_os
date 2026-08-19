import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildShotContextPrompt } from "./shotContextPrompt";

describe("buildShotContextPrompt", () => {
  it("stacks 鏡頭語言 on the visual prompt and keeps action for video models", async () => {
    const scene = {
      prompt: "淡大校門口，小華自我介紹",
      action: "走到校名牌前揮手",
      storySceneId: null,
      camera: { shotSize: "中景" },
      performance: { emotion: "開朗" },
    };
    const image = await buildShotContextPrompt(scene, { kind: "image" });
    expect(image).toBe("淡大校門口，小華自我介紹\n\n[鏡頭語言] 鏡頭：中景；表演：開朗");
    expect(image).not.toContain("走到校名牌前揮手");

    const video = await buildShotContextPrompt(scene, { kind: "video" });
    expect(video).toContain("淡大校門口，小華自我介紹｜動作：走到校名牌前揮手");
    expect(video).toContain("[鏡頭語言] 鏡頭：中景；表演：開朗");
  });

  it("returns empty when this shot has no visual prompt", async () => {
    await expect(buildShotContextPrompt({
      prompt: "   ",
      action: null,
      storySceneId: null,
      camera: { shotSize: "特寫" },
      performance: null,
    }, { kind: "image" })).resolves.toBe("");
  });
});

describe("MCP and animationPipeline share the same shot-context fallback", () => {
  it("generate_into_scene no longer falls back to scene.prompt ?? title", () => {
    const mcp = readFileSync(new URL("./mcpWriteExpansion.ts", import.meta.url), "utf8");
    const block = mcp.slice(mcp.indexOf('if (name === "generate_into_scene")'), mcp.indexOf('if (name === "update_worldview")'));
    expect(block).toContain("buildShotContextPrompt(scene, model)");
    expect(block).toContain("typeof args.prompt === \"string\" && args.prompt.trim()");
    expect(block).not.toContain("scene.prompt ?? scene.title");
  });

  it("executeAnimationGenerationStage uses the builder when the caller omits prompt", () => {
    const pipe = readFileSync(new URL("./animationPipeline.ts", import.meta.url), "utf8");
    const start = pipe.indexOf("export async function executeAnimationGenerationStage");
    const block = pipe.slice(start, pipe.indexOf("export async function targetedAnimationRepairPlan"));
    expect(block).toContain("buildShotContextPrompt(shot, model)");
    expect(block).toContain("input.prompt?.trim()");
    expect(block).not.toContain("shot.prompt?.trim()");
  });

  it("scenes generateInto / batch / variants still import the same builder", () => {
    const scenes = readFileSync(new URL("../routers/scenes.ts", import.meta.url), "utf8");
    expect(scenes).toContain('import { buildShotContextPrompt } from "../services/shotContextPrompt"');
    expect(scenes).not.toContain("async function buildShotContextPrompt(");
  });
});
