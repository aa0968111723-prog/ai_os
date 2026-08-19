import { describe, expect, it } from "vitest";
import {
  danglingIdList,
  livingCardIds,
  livingIdList,
  nullableLivingId,
  sceneCardIdsWithout,
  sceneCardIdsWithoutMany,
} from "./sceneEntityIds";

const LIVE = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";

describe("sceneEntityIds JSONB fail-closed", () => {
  it("keeps only ids that still exist", () => {
    expect(livingIdList([LIVE, GONE, LIVE], new Set([LIVE]))).toEqual([LIVE]);
    expect(livingCardIds([GONE], new Set([LIVE]))).toBeNull();
    expect(danglingIdList([LIVE, GONE], new Set([LIVE]))).toEqual([GONE]);
  });

  it("stripping a deleted card does not leave a dangling array", () => {
    expect(sceneCardIdsWithout([LIVE, GONE], GONE)).toEqual([LIVE]);
    expect(sceneCardIdsWithout([GONE], GONE)).toBeNull();
    expect(sceneCardIdsWithoutMany([LIVE, GONE], new Set([LIVE, GONE]))).toBeNull();
  });

  it("sourceAssetId / storySceneId / assetId drop when the target is gone", () => {
    expect(nullableLivingId(GONE, new Set([LIVE]))).toBeNull();
    expect(nullableLivingId(LIVE, new Set([LIVE]))).toBe(LIVE);
  });
});
