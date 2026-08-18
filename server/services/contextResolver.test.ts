import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatResolvedStoryContextBlock, shotIdFromPageContext } from "./contextResolver";

const resolverSrc = readFileSync(join(process.cwd(), "server/services/contextResolver.ts"), "utf8");

describe("formatResolvedStoryContextBlock", () => {
  it("pushes saved stories.content under 【你的故事】 so contextText is not empty", () => {
    expect(formatResolvedStoryContextBlock("小華走進山門。")).toBe("【你的故事】\n小華走進山門。");
  });

  it("skips blank / whitespace-only content", () => {
    expect(formatResolvedStoryContextBlock(null)).toBeNull();
    expect(formatResolvedStoryContextBlock("")).toBeNull();
    expect(formatResolvedStoryContextBlock("   \n")).toBeNull();
  });

  it("resolveContext pushes the story block into contextText before 【腳本】", () => {
    expect(resolverSrc).toContain("formatResolvedStoryContextBlock(story[0]?.content)");
    expect(resolverSrc).toContain("if (storyBlock) push(storyBlock)");
    expect(resolverSrc).toContain("if (scriptText) push(`【腳本】\\n${scriptText}`)");
    expect(resolverSrc).not.toContain("【故事全文】");
  });
});

describe("shotIdFromPageContext", () => {
  it("passes entityId as shotId when entityType is shot", () => {
    expect(shotIdFromPageContext({
      entityType: "shot",
      entityId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    })).toBe("0f8fad5b-d9cb-469f-a165-70867728950e");
  });

  it("does not invent a shotId for other entity types", () => {
    expect(shotIdFromPageContext({ entityType: "scene", entityId: "0f8fad5b-d9cb-469f-a165-70867728950e" })).toBeUndefined();
    expect(shotIdFromPageContext({ entityType: "shot" })).toBeUndefined();
    expect(shotIdFromPageContext(undefined)).toBeUndefined();
  });
});
