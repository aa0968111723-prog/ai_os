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
const generationCommand = readFileSync(join(process.cwd(), "server/services/generationCommand.ts"), "utf8");
const generationCore = readFileSync(join(process.cwd(), "server/services/generationCore.ts"), "utf8");
const adopt = readFileSync(join(process.cwd(), "server/services/consistencyAdopt.ts"), "utf8");
const creative = readFileSync(join(process.cwd(), "server/routers/creativeContext.ts"), "utf8");
const dataHub = readFileSync(join(process.cwd(), "server/routers/dataHub.ts"), "utf8");
const trpc = readFileSync(join(process.cwd(), "server/trpc.ts"), "utf8");
const bindings = readFileSync(join(process.cwd(), "server/services/projectDataBindings.ts"), "utf8");

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

  it("assistant sceneNo uses orderIndex display lookup, never scenes[n-1]", () => {
    expect(assistant).toContain("findSceneByDisplayNo");
    expect(assistant).not.toContain("scenes[no - 1]");
    expect(assistant).not.toContain("scenes[a.sceneNo - 1]");
    expect(assistant).toContain("settleAssistantAskCompletion");
    expect(assistant).toContain("ASSISTANT_VIEWER_NO_WRITE_RULE");
    expect(assistant).toContain("formatStudioShotContext");
  });

  it("assistant scene writes use the same authoritative read-back as database row tools", () => {
    expect(assistant).toContain("verifySceneWriteReadBack");
    expect(assistant).toContain("ASSISTANT_SCENE_READ_BACK_METHOD");
    expect(assistant).toContain("authoritative_scene_row_read_back");
    const updateStart = assistant.indexOf('if (a.type === "update_scene")');
    const createStart = assistant.indexOf('if (a.type === "create_scene")');
    const updateBlock = assistant.slice(updateStart, assistant.indexOf('if (a.type === "direct_shot")', updateStart));
    const createBlock = assistant.slice(createStart, assistant.indexOf('if (a.type === "run_workflow")', createStart));
    expect(updateBlock).toContain("verifySceneWriteReadBack");
    expect(createBlock).toContain("verifySceneWriteReadBack");
    expect(createBlock).toContain("voiceover");
    expect(createBlock).toContain("durationSec");
  });
});

describe("teammate map: Candidate-only generateInto / Adopt / isolation", () => {
  it("generateInto keeps the scene pointer; Adopt is the only writer of assetId", () => {
    const into = scenes.slice(scenes.indexOf("generateInto:"), scenes.indexOf("generateVariants:"));
    expect(into).toContain("executeGenerationCommand");
    expect(into).toContain("preserveScenePointer: true");
    expect(generationCommand).toContain("const preserveScenePointer = core.preserveScenePointer ?? isVisualSceneBound(core)");
    expect(generationCore).toContain("if (!gen.sceneId || meta.preserveScenePointer === true) return null");
    expect(creative).toContain("adoptGenerationCurrent");
    expect(adopt).toContain("export async function adoptGenerationCurrent");
    expect(adopt).toMatch(/assetId:\s*asset\.id/);
  });

  it("cross-group requireGroup and personal bind stay deny-by-default", () => {
    expect(trpc).toContain('throw new TRPCError({ code: "FORBIDDEN", message: "你不屬於這個組" })');
    expect(dataHub).toContain("bindableDenyReason");
    expect(dataHub).toContain("createBinding");
    expect(bindings).toContain('case "personal":');
    expect(bindings).toContain("個人資料表不能提供給專案");
    expect(bindings).toContain("table.groupId === project.groupId");
  });
});
