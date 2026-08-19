/**
 * #755 structural guard: Storyboard suggestion loading is project-scoped,
 * not one tRPC query per ShotCard. Behaviour is covered by ShotCard tests
 * plus shared/shotAssetSuggestions.test.ts request-count evidence.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const stage = readFileSync(join(root, "client/src/features/storyboard-center/StoryboardStage.tsx"), "utf8");
const card = readFileSync(join(root, "client/src/features/storyboard-center/ShotCard.tsx"), "utf8");

describe("Storyboard suggestion query consolidation", () => {
  it("StoryboardStage issues one project-scoped batch query", () => {
    expect(stage).toContain("trpc.story.shotAssetSuggestionsBatch.useQuery");
    expect(stage).toContain("{ projectId }");
    expect(stage).not.toMatch(/shotAssetSuggestionsBatch\.useQuery\([\s\S]*shotIds/);
    expect(stage.match(/shotAssetSuggestionsBatch\.useQuery/g)).toHaveLength(1);
    expect(stage).not.toContain("refetchInterval");
  });

  it("ShotCard no longer owns a suggestion network lifecycle", () => {
    expect(card).not.toContain("shotAssetSuggestions.useQuery");
    expect(card).toContain("assetHints");
    expect(card).toContain("shotAssetSuggestionsBatch.invalidate");
  });

  it("does not raise the Node header limit to hide GET fan-out", () => {
    expect(stage).not.toContain("maxHeaderSize");
    expect(card).not.toContain("maxHeaderSize");
  });

  it("exposes Studio-style ＋新增鏡 so a parse-timeout project is not stuck", () => {
    expect(stage).toContain("scenes.addDraft.useMutation");
    expect(stage).toContain("scenes.insertAfter.useMutation");
    expect(stage).toContain("insertAfter.mutate({ sceneId: focusShot.id })");
    expect(stage).toContain("新增鏡");
    expect(stage).toContain("在這之後插入一鏡");
    expect(stage).toContain("onFocusShot={setAnchorShotId}");
    expect(stage).toContain("解析未完成也能依原文拆鏡");
    expect(card).toContain("scenes.insertAfter.useMutation");
    expect(card).toContain("insertAfter.mutate({ sceneId: shot.id })");
    expect(card).toContain("在這之後插入一鏡");
  });

  it("does not add a visible-window second query (Phase E) on top of the project batch", () => {
    // 300-shot assemble stays 5 DB queries / compact payload — no IntersectionObserver prefetch.
    expect(stage).not.toContain("IntersectionObserver");
    expect(stage.match(/shotAssetSuggestionsBatch/g)?.length).toBe(2);
  });
});
