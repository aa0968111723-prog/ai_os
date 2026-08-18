import { describe, expect, it } from "vitest";
import {
  ASSISTANT_SCENE_READ_BACK_METHOD,
  sceneFieldMatches,
  verifySceneWrite,
} from "./assistantSceneReadBack";

describe("verifySceneWrite（authoritative scene row read-back）", () => {
  it("requires the row to belong to the same project and not be deleted", () => {
    expect(verifySceneWrite({
      found: { projectId: "b", title: "x" },
      projectId: "a",
      expected: { title: "x" },
    }).verified).toBe(false);
    expect(verifySceneWrite({
      found: { projectId: "a", title: "x", deletedAt: new Date() },
      projectId: "a",
      expected: { title: "x" },
    }).verified).toBe(false);
    expect(verifySceneWrite({
      found: null,
      projectId: "a",
      expected: { title: "x" },
    }).verified).toBe(false);
  });

  it("matches requested fields only; extra row fields do not fail", () => {
    const found = {
      projectId: "p",
      title: "助手新加的一鏡",
      voiceover: "燈籠還在手上",
      prompt: "小蓮停在街口",
      durationSec: 4,
      extra: "ignored",
    };
    expect(verifySceneWrite({
      found,
      projectId: "p",
      expected: { title: "助手新加的一鏡", voiceover: "燈籠還在手上", prompt: "小蓮停在街口", durationSec: 4 },
    })).toEqual({ verified: true, unmatched: [] });
    expect(verifySceneWrite({
      found,
      projectId: "p",
      expected: { title: "錯的" },
    }).unmatched).toEqual(["title"]);
  });

  it("compares camera / performance as objects", () => {
    expect(sceneFieldMatches({ shotSize: "近景" }, { shotSize: "近景" })).toBe(true);
    expect(sceneFieldMatches({ shotSize: "遠景" }, { shotSize: "近景" })).toBe(false);
  });

  it("names the same verification method as the database row tools", () => {
    expect(ASSISTANT_SCENE_READ_BACK_METHOD).toBe("authoritative_scene_row_read_back");
  });
});
