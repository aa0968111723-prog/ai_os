/**
 * Data-integrity P0 source locks: OCC on story persist, project-scoped
 * reference images, and assertGenerationEntityIds on import / director / prompts.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("P0-1 story persist always sends expectedRev", () => {
  const persist = readFileSync(new URL("./collabDoc.ts", import.meta.url), "utf8");

  it("persistStoryDoc materialize 帶 expectedRev，衝突不覆蓋", () => {
    expect(persist).not.toContain("expectedRev: opts?.expectedRev ?? existing.rev");
    expect(persist).toContain("expectedRev: opts.expectedRev");
    expect(persist).toContain("omitted expectedRev");
    expect(persist).toContain("isRevisionConflictError");
    expect(persist).toContain("不覆蓋 stories.content");
    expect(persist).toContain("baseline: { content: opts.baselineContent ?? existing.content }");
    expect(persist).toContain("不落衝突快照");
    expect(persist).toContain("以 SQL 為準");
    const persistFn = persist.slice(persist.indexOf("export async function persistStoryDoc"));
    const applyBlock = persistFn.slice(
      persistFn.indexOf("await applyWithRevision"),
      persistFn.indexOf("isRevisionConflictError"),
    );
    expect(applyBlock).toContain("await persistStorySnapshot");
    const conflictBlock = persistFn.slice(persistFn.indexOf("isRevisionConflictError"), persistFn.indexOf("throw err;"));
    expect(conflictBlock).not.toContain("persistStorySnapshot");
  });

  it("Yjs flushRoom 用 lastMaterializedRev，衝突不重試（避免延遲 LWW）", () => {
    expect(persist).toContain("lastMaterializedRev");
    expect(persist).toContain("expectedRev: room.lastMaterializedRev");
    expect(persist).toContain("不重試 materialize");
    expect(persist).toContain("persistInFlight");
    expect(persist).toContain("conflict: true");
  });

  it("flushCollab throws CONFLICT when materialize hits a rev clash", () => {
    const story = readFileSync(new URL("../routers/story.ts", import.meta.url), "utf8");
    const flush = story.slice(story.indexOf("flushCollab:"), story.indexOf("listVersions:"));
    expect(flush).toContain('code: "CONFLICT"');
    expect(flush).toContain("flushed.conflict");
    expect(flush).toContain("沒有用共編裡還沒存進去的字去解析");
  });

  it("restoreVersion bumps rev through applyWithRevision", () => {
    const story = readFileSync(new URL("../routers/story.ts", import.meta.url), "utf8");
    const restore = story.slice(story.indexOf("restoreVersion:"), story.indexOf("parse:"));
    expect(restore).toContain("applyWithRevisionTrpc");
    expect(restore).toContain("expectedRev: story.rev");
    expect(restore).not.toContain(".update(schema.stories)");
  });
});

describe("P0-2 assertReferenceImage is project-scoped", () => {
  it("helper requires asset.projectId === projectId", () => {
    const src = readFileSync(new URL("./referenceAsset.ts", import.meta.url), "utf8");
    expect(src).toContain("asset.projectId !== projectId");
    expect(src).toContain("同組其他專案的圖不能當定裝");
  });

  it("context bindings refuse same-group other-project assets and knowledge", () => {
    const src = readFileSync(new URL("./contextBindings.ts", import.meta.url), "utf8");
    expect(src).toContain("asset.projectId !== input.project.id");
    expect(src).toContain("row.projectId !== input.project.id");
    expect(src).toContain("同組其他專案的圖不能當定裝");
  });

  it("generateInto honours 角色卡 生成時帶入 via resolveHonoredCharacterSheet(projectId); 0/6 skips", () => {
    const scenes = readFileSync(new URL("../routers/scenes.ts", import.meta.url), "utf8");
    const into = scenes.slice(scenes.indexOf("generateInto:"), scenes.indexOf("generateVariants:"));
    expect(into).toContain("resolveHonoredCharacterSheet");
    expect(into).toContain("characterIds: cards.characterIds");
    expect(into).toContain("explicitSourceAssetId: input.sourceAssetId");
    const helper = readFileSync(new URL("./referenceAsset.ts", import.meta.url), "utf8");
    expect(helper).toContain("if (!opts.characterIds?.length) return undefined");
    expect(helper).toContain("await assertReferenceImage(id, groupId, projectId)");
  });

  it("Team Canon reference images also require the same project", () => {
    const src = readFileSync(new URL("./teamCanon.ts", import.meta.url), "utf8");
    expect(src).toContain("projectId: string");
    expect(src).toContain("asset.projectId !== input.projectId");
    expect(src).toContain("projectId: project.id");
    expect(src).toContain("asset.kind !== \"image\"");
  });
});

describe("P0-3 import/director/prompts cannot skip assertGenerationEntityIds", () => {
  it("director splitScriptCore asserts before insert", () => {
    const src = readFileSync(new URL("../routers/director.ts", import.meta.url), "utf8");
    expect(src).toContain("await assertGenerationEntityIds(project.id");
    expect(src.indexOf("await assertGenerationEntityIds")).toBeLessThan(src.indexOf(".insert(schema.scenes)"));
  });

  it("splitScriptCore reads stories.content before knowledge when script is omitted", () => {
    const src = readFileSync(new URL("../routers/director.ts", import.meta.url), "utf8");
    expect(src).toContain("schema.stories.content");
    expect(src).toContain("pickSplitScriptSource");
    expect(src.indexOf("schema.stories.content")).toBeLessThan(src.indexOf("mode: \"script_only\""));
  });

  it("storyParse materialize asserts before insert", () => {
    const src = readFileSync(new URL("./storyParse.ts", import.meta.url), "utf8");
    expect(src).toContain("await assertGenerationEntityIds(project.id");
    expect(src.indexOf("await assertGenerationEntityIds")).toBeLessThan(src.lastIndexOf(".insert(schema.scenes)"));
  });

  it("prompts.savePromptCore asserts card ids belong to the project", () => {
    const src = readFileSync(new URL("../routers/prompts.ts", import.meta.url), "utf8");
    expect(src).toContain("await assertGenerationEntityIds(project.id");
  });

  it("MCP get_project_context slices story through the shared helper", () => {
    const src = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");
    const block = src.slice(src.indexOf('if (name === "get_project_context")'), src.indexOf('if (name === "list_generations")'));
    expect(block).toContain("formatPersistedStoryForAssistant");
    expect(block).toContain("slicePersistedStoryContent");
    expect(block).toContain("storyBlock");
  });

  it("assertGenerationEntityIds also covers lookIds and storySceneId", () => {
    const src = readFileSync(new URL("./generationCore.ts", import.meta.url), "utf8");
    expect(src).toContain("lookIds?: string[]");
    expect(src).toContain("storySceneId?: string");
    expect(src).toContain("造型不屬於本專案或不存在");
    expect(src).toContain("場次不屬於本專案或不存在");
  });
});
