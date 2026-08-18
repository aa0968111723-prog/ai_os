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
const siteAssistant = readFileSync(join(process.cwd(), "server/routers/globalAssistant.ts"), "utf8");
const repairExecute = readFileSync(join(process.cwd(), "server/services/animationRepairExecute.ts"), "utf8");
const sceneList = readFileSync(join(process.cwd(), "client/src/components/SceneList.tsx"), "utf8");

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
    expect(inspector).toContain("setCards.mutate({");
    expect(inspector).toContain("characterIds: next");
    expect(inspector).toContain("lookIds: nextLooks");
    expect(inspector).toContain("expectedRev: shot.rev");
    expect(inspector).toContain("shouldApplySceneWriteAck");
    expect(inspector).toContain("sceneId: boundSceneId");
  });

  it("story autosave serializes in-flight saves and does not baseline from live editor", () => {
    expect(storyStage).toContain("createStorySaveGate");
    expect(storyStage).toContain("dispatchStorySave(live)");
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
    expect(assistant).toContain("formatPersistedStoryForAssistant");
    expect(assistant).toContain("buildAssistantProjectStatusContext");
    expect(assistant).toContain("shotIdFromPageContext");
    expect(assistant).toContain("shotId: shotIdFromPageContext(input.pageContext)");
    expect(assistant).toContain("assistantAskCompletionChip");
    expect(assistant).toContain("userMessage: input.message");
    expect(assistant).toContain("allowPaidFallback");
    expect(assistant).toContain("if (!a.sceneNo) continue");
    expect(assistant).toContain("請指定要生成的分鏡");
    expect(assistant).toContain("expectedRev: scene.rev");
    expect(assistant).toContain("expectedRev: project.rev");
    expect(assistant).toContain("bindAssistantAskDeadline");
    expect(assistant).toContain("ASSISTANT_ASK_TIMEOUT_MESSAGE");
  });

  it("site assistant animation writes have real handlers (not capability-only)", () => {
    expect(siteAssistant).toContain('capabilityId === "animation_adopt_candidate"');
    expect(siteAssistant).toContain('capabilityId === "animation_keep_current"');
    expect(siteAssistant).toContain('capabilityId === "animation_execute_repair"');
    expect(siteAssistant).toContain("adoptGenerationVerified");
    expect(siteAssistant).toContain("reviewShotVerified");
    expect(siteAssistant).toContain("executeAnimationRepairVerified");
    expect(siteAssistant).toContain("pickAnimationCompareItem");
    expect(siteAssistant).toContain("我不會把「執行修復」說成已完成");
    expect(siteAssistant).toContain("message: input.message");
    expect(repairExecute).toContain("applyWithRevisionTrpc");
    expect(repairExecute).not.toContain("db.update(schema.scenes)");
  });

  it("assistant scene writes use the same authoritative read-back as database row tools", () => {
    expect(assistant).toContain("verifySceneWriteReadBack");
    expect(assistant).toContain("ASSISTANT_SCENE_READ_BACK_METHOD");
    expect(readFileSync(join(process.cwd(), "shared/assistantSceneReadBack.ts"), "utf8"))
      .toContain('authoritative_scene_row_read_back');
    const exec = assistant.slice(assistant.indexOf("async function applyAssistantScenePatch"));
    expect(exec).toContain('if (a.type === "update_scene")');
    expect(exec).toContain('if (a.type === "direct_shot")');
    expect(exec).toContain('if (a.type === "create_scene")');
    expect(exec.split("verifySceneWriteReadBack").length).toBeGreaterThan(3);
    expect(exec).toContain("durationSec: Math.round(a.durationSec)");
  });

  it("SceneList and ShotCard send expectedRev on inline edits", () => {
    expect(sceneList).toContain("expectedRev: s.rev");
    expect(sceneList).toContain("baseline: { title: s.title }");
    expect(sceneList).toContain("baseline: { durationSec: s.durationSec }");
    expect(sceneList).toContain("trimStartMs: s.trimStartMs ?? null");
    const shotCard = readFileSync(join(process.cwd(), "client/src/features/storyboard-center/ShotCard.tsx"), "utf8");
    expect(shotCard).toContain("expectedRev: shot.rev");
    expect(shotCard).toContain("baseline: { [field]:");
  });

  it("assistant add_character writes read back the character row", () => {
    const exec = assistant.slice(assistant.indexOf("async function applyAssistantScenePatch"));
    expect(assistant).toContain('type: z.literal("add_character")');
    expect(exec).toContain('if (a.type === "add_character")');
    expect(exec).toContain("authoritative_character_row_read_back");
    expect(exec).toContain("MAX_PROJECT_CHARACTERS");
    expect(assistant).toContain("proposeAddCharacterActions");
    expect(assistant).toContain("待補外觀描述");
    expect(assistant).toContain('type: z.literal("add_character")');
    expect(assistant).toContain('"add_character"');
    expect(assistant).toContain("publishToProject(project.id, { kind: \"character\"");
    expect(assistant).toContain("authoritative_character_row_read_back");
  });

  it("generateStoryboard publishes scene invalidate so studio timeline matches /p/", () => {
    const story = readFileSync(join(process.cwd(), "server/routers/story.ts"), "utf8");
    const start = story.indexOf("generateStoryboard:");
    const block = story.slice(start, story.indexOf("undoRun:", start));
    expect(block).toContain("publishToProject(input.projectId");
    expect(block).toContain('kind: "scene"');
    expect(block).toContain("已產生分鏡");
  });
});

describe("SceneList insertAfter queue (do not invent a /p/ button)", () => {
  it("SceneRow already queues「在這之後插入」in click order", () => {
    expect(sceneList).toContain('aria-label="在這之後插入一鏡"');
    expect(sceneList).toContain("enqueueInsertAfter");
    expect(sceneList).toContain("pumpInsertAfter");
    expect(sceneList).toContain("insertTailRef");
    expect(sceneList).not.toContain("在這格之後插入");
  });
});

describe("teammate map: Candidate-only generateInto / Adopt / isolation", () => {
  it("listByProject projects latestDoneVisualGenId; SceneList Adopt calls adoptGeneration", () => {
    const list = scenes.slice(scenes.indexOf("listByProject:"), scenes.indexOf("addFromGeneration:"));
    expect(list).toContain("latestDoneVisualGenId");
    expect(list).toContain("g.status = 'done'");
    expect(sceneList).toContain("pendingAdoptGenerationId");
    expect(sceneList).toContain("creativeContext.adoptGeneration");
    expect(sceneList).toContain("採用這一版");
  });

  it("generateInto keeps the scene pointer; Adopt is the only writer of assetId", () => {
    const into = scenes.slice(scenes.indexOf("generateInto:"), scenes.indexOf("generateVariants:"));
    expect(into).toContain("executeGenerationCommand");
    expect(into).toContain("preserveScenePointer: true");
    expect(generationCommand).toContain("const preserveScenePointer = core.preserveScenePointer ?? isVisualSceneBound(core)");
    expect(generationCore).toContain("if (!gen.sceneId || meta.preserveScenePointer === true) return null");
    expect(creative).toContain("adoptGenerationCurrent");
    expect(adopt).toContain("export async function adoptGenerationCurrent");
    expect(adopt).toContain("export async function adoptGenerationVerified");
    expect(adopt).toMatch(/assetId:\s*asset\.id/);
    expect(adopt).toContain("rev: sql`${schema.scenes.rev} + 1`");
    expect(adopt).toContain("scene?.assetId === adopted.assetId");
  });

  it("cross-group requireGroup and personal bind stay deny-by-default", () => {
    expect(trpc).toContain('throw new TRPCError({ code: "FORBIDDEN", message: "你不屬於這個組" })');
    expect(dataHub).toContain("bindableDenyReason");
    expect(dataHub).toContain("createBinding");
    expect(bindings).toContain('case "personal":');
    expect(bindings).toContain("個人資料表不能提供給專案");
    expect(bindings).toContain("table.groupId === project.groupId");
  });

  it("review bumps rev through applySceneVisualPatch", () => {
    const review = scenes.slice(scenes.indexOf("review:"), scenes.indexOf("inheritFromPrevious:"));
    expect(review).toContain("applySceneVisualPatch");
    expect(review).not.toContain("db.update(schema.scenes)");
  });

  it("setVisual adopt paths bump rev through applySceneVisualPatch", () => {
    const fromAsset = scenes.slice(scenes.indexOf("setVisualFromAsset:"), scenes.indexOf("setVisualFromGeneration:"));
    const fromGen = scenes.slice(scenes.indexOf("setVisualFromGeneration:"), scenes.indexOf("move:"));
    expect(fromAsset).toContain("applySceneVisualPatch");
    expect(fromAsset).not.toContain("db.update(schema.scenes).set(patch)");
    expect(fromGen).toContain("applySceneVisualPatch");
    expect(fromGen).not.toContain("db.update(schema.scenes).set(patch)");
    expect(scenes).toContain("expectedRev: scene.rev");
  });

  it("inheritFromPrevious goes through applyWithRevisionTrpc and conflict is formatted before 500 rewrite", () => {
    const inherit = scenes.slice(scenes.indexOf("inheritFromPrevious:"), scenes.indexOf("batchGenerate:"));
    expect(inherit).toContain("applyWithRevisionTrpc");
    expect(inherit).toContain("expectedRev: input.expectedRev ?? cur.rev");
    expect(inherit).not.toContain("db.update(schema.scenes).set(patch)");
    const conflictIdx = trpc.indexOf("isRevisionConflictError(error.cause)");
    const internalIdx = trpc.indexOf('error.code === "INTERNAL_SERVER_ERROR"');
    expect(conflictIdx).toBeGreaterThan(-1);
    expect(conflictIdx).toBeLessThan(internalIdx);
  });
});

describe("worldview OCC uses projects.rev", () => {
  it("schema, updateWorldview, and blur saves share expectedRev", () => {
    const schemaSrc = readFileSync(join(process.cwd(), "server/db/schema/projects.ts"), "utf8");
    const projectTable = schemaSrc.slice(schemaSrc.indexOf("export const projects = pgTable"), schemaSrc.indexOf("export const knowledge"));
    expect(projectTable).toContain('rev: integer("rev")');
    const projects = readFileSync(join(process.cwd(), "server/routers/projects.ts"), "utf8");
    expect(projects).toContain("updateWorldview:");
    expect(projects).toContain("applyWithRevision");
    const page = readFileSync(join(process.cwd(), "client/src/pages/ProjectPage.tsx"), "utf8");
    expect(page).toContain("saveWorldviewOcc");
    expect(page).toContain("createWorldviewSaveGate");
    expect(page).toContain("expectedRev: req.expectedRev");
    expect(page).not.toContain("updateWv.mutate({ id, worldview:");
  });
});

const oneClickHook = readFileSync(join(process.cwd(), "client/src/features/story-workspace/useOneClickFilm.ts"), "utf8");
const overnightRealGen = readFileSync(join(process.cwd(), "scripts/overnight-real-gen-adopt.py"), "utf8");

describe("storyboard board blur sends expectedRev", () => {
  it("ShotCard and SceneGroupHeader no longer raw-mutate without rev", () => {
    const shotCard = readFileSync(join(process.cwd(), "client/src/features/storyboard-center/ShotCard.tsx"), "utf8");
    const header = readFileSync(join(process.cwd(), "client/src/features/storyboard-center/SceneGroupHeader.tsx"), "utf8");
    expect(sceneList).toContain("expectedRev: row?.rev");
    expect(shotCard).toContain("createShotFieldSaveGate");
    expect(shotCard).toContain("expectedRev: req.expectedRev");
    expect(shotCard).toContain("expectedRev: shot.rev");
    expect(header).toContain("expectedRev: scene.rev");
    expect(header).not.toContain("update.mutate({ id: scene.id, title: v })");
    expect(shotCard).toContain("rev: shot.rev");
    const binding = readFileSync(join(process.cwd(), "client/src/components/SceneCardBinding.tsx"), "utf8");
    const dock = readFileSync(join(process.cwd(), "client/src/features/storyboard-center/ResourceDock.tsx"), "utf8");
    expect(binding).toContain("expectedRev: scene.rev");
    expect(binding).toContain("baseline");
    expect(dock).toContain("expectedRev: binding.rev");
    expect(dock).toContain("baseline: { [kind]: current }");
  });
});

describe("DeliveryRoom picked batch matches eligible-shot filter", () => {
  it("uses listPickedBatchGenerateIds instead of raw picked.size", () => {
    const delivery = readFileSync(join(process.cwd(), "client/src/features/delivery/DeliveryRoom.tsx"), "utf8");
    expect(delivery).toContain("listPickedBatchGenerateIds");
    expect(delivery).toContain("pickedEligibleIds");
    expect(delivery).not.toContain("sceneIds: [...picked]");
  });
});

describe("one-click does not batch-generate on an empty board", () => {
  it("refuses batchGenerate when listByProject is still 0 shots", () => {
    expect(oneClickHook).toContain("listByProject.fetch");
    expect(oneClickHook).toContain("ONE_CLICK_NEED_SHOTS");
    const oneClick = readFileSync(join(process.cwd(), "client/src/features/story-workspace/oneClickFilm.ts"), "utf8");
    expect(oneClick).toContain('export const ONE_CLICK_NEED_SHOTS = "先解析出分鏡"');
    expect(oneClick).toContain("export function revealAfterOneClick");
    const page = readFileSync(join(process.cwd(), "client/src/pages/ProjectPage.tsx"), "utf8");
    expect(page).toContain("error={oneClick.error}");
    expect(page).toContain("revealAfterOneClick");
    expect(page).not.toMatch(/oneClick\.run\(\)[\s\S]{0,240}catch \(\(\) => \{\s*openInlineSection\("production"\);/);
    const bar = readFileSync(join(process.cwd(), "client/src/features/story-workspace/StoryReadinessBar.tsx"), "utf8");
    expect(bar).toContain("story-readiness__error");
    expect(bar).toContain('role="alert"');
  });
});

describe("overnight real generateInto + adopt rails", () => {
  it("only writes overnight-test-* into 動畫組, uses cheap image, and adopts after generateInto", () => {
    expect(overnightRealGen).toContain('if group.get("name") == "動畫組"');
    expect(overnightRealGen).toContain("總會短影音");
    expect(overnightRealGen).toContain("overnight-test-");
    expect(overnightRealGen).toContain("fal-ai/flux/schnell");
    expect(overnightRealGen).toContain("scenes.generateInto");
    expect(overnightRealGen).toContain("creativeContext.adoptGeneration");
    expect(overnightRealGen).toContain("preserveScenePointer");
    expect(overnightRealGen).toContain("REAL_GEN_SHOTS>3 refused");
    expect(overnightRealGen).not.toContain("veo");
  });
});

