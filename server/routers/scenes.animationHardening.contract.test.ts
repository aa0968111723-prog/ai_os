/**
 * Animation hardening structure guards.
 *
 * Behavior is proven by shared/shotLooks.test.ts and the animation-consistency e2e.
 * These asserts stop a later edit from reopening the raw-write / missed-copy holes.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const scenes = readFileSync(join(process.cwd(), "server/routers/scenes.ts"), "utf8");
const assistant = readFileSync(join(process.cwd(), "server/routers/assistant.ts"), "utf8");
const inspector = readFileSync(join(process.cwd(), "client/src/features/animation-studio/ShotInspector.tsx"), "utf8");
const storyStage = readFileSync(join(process.cwd(), "client/src/features/story-workspace/StoryStage.tsx"), "utf8");

describe("animation shot writes stay consistent", () => {
  it("duplicate copies look / camera / performance / story scene (not just character ids)", () => {
    const start = scenes.indexOf("insertAfter:");
    const block = scenes.slice(start, scenes.indexOf("remove:", start));
    expect(block).toContain("lookIds: dup ? cur.lookIds : null");
    expect(block).toContain("camera: dup ? cur.camera : null");
    expect(block).toContain("performance: dup ? cur.performance : null");
    expect(block).toContain("storySceneId: dup ? cur.storySceneId : null");
  });

  it("setCards auto-strips orphan looks when only characterIds is sent", () => {
    const start = scenes.indexOf("setCards:");
    const block = scenes.slice(start, scenes.indexOf("generateInto:", start));
    expect(block).toContain("keepLooksOwnedByCharacters");
    expect(block).toContain("looksChanged");
    expect(block).toContain("unboundLookIds");
  });

  it("assistant scene writes go through applyWithRevision + realtime publish", () => {
    expect(assistant).toContain("async function applyAssistantScenePatch");
    expect(assistant).toContain("applyWithRevision({");
    expect(assistant).toContain("publishToProject(scene.projectId");
    const updateStart = assistant.indexOf('if (a.type === "update_scene")');
    const updateBlock = assistant.slice(updateStart, assistant.indexOf('if (a.type === "direct_shot")', updateStart));
    expect(updateBlock).toContain("applyAssistantScenePatch");
    expect(updateBlock).not.toContain("db.update(schema.scenes).set");
    const directStart = assistant.indexOf('if (a.type === "direct_shot")');
    const directBlock = assistant.slice(directStart, assistant.indexOf('if (a.type === "create_scene")', directStart));
    expect(directBlock).toContain("applyAssistantScenePatch");
    expect(directBlock).not.toContain("db.update(schema.scenes).set");
  });

  it("Shot Inspector sends lookIds when toggling a character", () => {
    expect(inspector).toContain("setCards.mutate({ sceneId: shot.id, characterIds: next, lookIds: nextLooks })");
  });

  it("story autosave serializes in-flight saves and does not baseline from live editor", () => {
    expect(storyStage).toContain("createStorySaveGate");
    expect(storyStage).toContain("gateRef.current?.dispatch(live)");
    expect(storyStage).not.toContain("baselineRef.current = contentRef.current");
    expect(assistant).toContain('if (a.type === "create_scene")');
    expect(assistant).toContain("publishToProject(project.id");
  });
});
