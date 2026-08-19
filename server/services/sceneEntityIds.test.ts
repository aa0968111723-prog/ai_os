import { describe, expect, it } from "vitest";
import { applyLivingSceneRefs } from "./sceneEntityIds";

const LIVE = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";
const ASSET = "33333333-3333-4333-8333-333333333333";

describe("keepLivingSceneRefs fail-closed", () => {
  it("drops dangling JSONB ids and recycled sourceAssetId; does not invent replacements", () => {
    const living = applyLivingSceneRefs(
      {
        characterIds: [LIVE, GONE],
        scenePresetIds: [GONE],
        propIds: [LIVE],
        lookIds: [GONE, LIVE],
        storySceneId: GONE,
        assetId: ASSET,
      },
      {
        characters: new Set([LIVE]),
        scenePresets: new Set(),
        props: new Set([LIVE]),
        looks: new Set([LIVE]),
        storyScenes: new Set(),
        assets: new Set(),
      },
    );
    expect(living.characterIds).toEqual([LIVE]);
    expect(living.scenePresetIds).toBeNull();
    expect(living.propIds).toEqual([LIVE]);
    expect(living.lookIds).toEqual([LIVE]);
    expect(living.storySceneId).toBeNull();
    expect(living.assetId).toBeNull();
  });
});
