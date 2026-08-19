import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertMcpProjectScope, mcpUnchanged } from "./mcpWriteExpansion";

describe("MCP write honesty helpers", () => {
  it("marks empty patches as unchanged so agents cannot claim a write", () => {
    expect(mcpUnchanged({ characterId: "c1", name: "小華" })).toEqual({
      characterId: "c1",
      name: "小華",
      unchanged: true,
    });
  });

  it("allows same-project updates and omitted projectId", () => {
    expect(() => assertMcpProjectScope("proj-a", undefined, "角色卡")).not.toThrow();
    expect(() => assertMcpProjectScope("proj-a", "proj-a", "角色卡")).not.toThrow();
    expect(() => assertMcpProjectScope("proj-a", "", "角色卡")).not.toThrow();
  });

  it("rejects same-group cross-project id writes (小華 in A vs B)", () => {
    try {
      assertMcpProjectScope("proj-a", "proj-b", "角色卡");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("FORBIDDEN");
      expect((error as TRPCError).message).toContain("角色卡不屬於這個專案");
    }
  });

  it("MCP update_scene and update_worldview go through applyWithRevision", () => {
    const source = readFileSync(new URL("./mcpWriteExpansion.ts", import.meta.url), "utf8");
    const scene = source.slice(source.indexOf('if (name === "update_scene")'), source.indexOf('if (name === "reorder_scenes")'));
    const wv = source.slice(source.indexOf('if (name === "update_worldview")'), source.indexOf('if (name === "rename_asset")'));
    expect(scene).toContain("applyWithRevision");
    expect(scene).toContain("expectedRev: scene.rev");
    expect(scene).not.toContain("db.update(schema.scenes).set(patch)");
    expect(wv).toContain("applyWithRevision");
    expect(wv).toContain("expectedRev: project.rev");
    expect(wv).not.toContain("db.update(schema.projects).set({ worldview");
  });

  it("submit_generation can bind sceneNo through findSceneByDisplayNo", () => {
    const source = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");
    const block = source.slice(source.indexOf('if (name === "submit_generation")'), source.indexOf('if (name === "post_message")'));
    expect(block).toContain("findSceneByDisplayNo");
    expect(block).toContain("sceneId");
    expect(block).toContain("args.sceneNo");
    expect(block).toContain("sceneFillRole");
    expect(block).toContain("resolveSceneCards(shot, null)");
    expect(block).toContain("lookIds: shot.lookIds ?? undefined");
    expect(block).toContain("shotDirection");
    expect(block).toContain("sceneRole");
    expect(block).not.toContain("select({ id: schema.scenes.id, orderIndex: schema.scenes.orderIndex })");
    expect(source).toContain("要寫進第 N 鏡請帶 sceneNo");
  });

  it("generate_into_scene goes through executeGenerationCommand so a failed first send cannot look like success", () => {
    const source = readFileSync(new URL("./mcpWriteExpansion.ts", import.meta.url), "utf8");
    const block = source.slice(source.indexOf('if (name === "generate_into_scene")'), source.indexOf('if (name === "update_worldview")'));
    expect(block).toContain("executeGenerationCommand");
    expect(block).toContain("resolveHonoredCharacterSheet");
    expect(block).toContain("characterIds: cards.characterIds");
    expect(block).toContain("buildShotContextPrompt(scene, model)");
    expect(block).not.toContain("scene.prompt ?? scene.title");
    expect(block).toContain("regenRejection(model)");
    expect(block).toContain('code: "BAD_REQUEST"');
    expect(block).toContain("assertNoPendingVisual(scene.id)");
    expect(block).toContain("ensureXiaohuaCharacterIds");
    expect(block).toContain("characterIds,");
    expect(block).toContain("id: typeof args.client_request_id === \"string\" ? args.client_request_id : undefined");
    const command = readFileSync(new URL("./generationCommand.ts", import.meta.url), "utf8");
    expect(command).toContain("shouldReplayIdempotentGeneration(generation.status)");
    expect(command).toContain("IDEMPOTENT_FAILED_GENERATION_RETRY");
  });

  it("add/update character·preset·prop bind images through assertReferenceImage(projectId)", () => {
    const source = readFileSync(new URL("./mcpWriteExpansion.ts", import.meta.url), "utf8");
    expect(source).toContain('import { assertReferenceImage, resolveHonoredCharacterSheet } from "./referenceAsset"');
    expect(source.match(/await assertReferenceImage\(/g)?.length).toBeGreaterThanOrEqual(6);
    expect(source).toContain("project.groupId, project.id");
    expect(source).toContain("row.groupId, row.projectId");
  });
});
