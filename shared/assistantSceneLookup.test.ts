import { describe, expect, it } from "vitest";
import { displayShotNo, findSceneByDisplayNo } from "./assistantSceneLookup";

describe("findSceneByDisplayNo（sceneNo maps to orderIndex, not array index）", () => {
  const scenes = [
    { id: "c", orderIndex: 11, title: "last" },
    { id: "a", orderIndex: 2, title: "first surviving" },
    { id: "b", orderIndex: 9, title: "after hole" },
  ];

  it("uses orderIndex sort so soft-delete holes do not pick the wrong shot", () => {
    // Unsorted array index 2-1 would be `a` — that is the banned scenes[n-1] bug.
    expect(scenes[2 - 1]?.id).toBe("a");
    expect(findSceneByDisplayNo(scenes, 1)?.id).toBe("a");
    expect(findSceneByDisplayNo(scenes, 2)?.id).toBe("b");
    expect(findSceneByDisplayNo(scenes, 3)?.id).toBe("c");
  });

  it("rejects invalid sceneNo and does not wrap", () => {
    expect(findSceneByDisplayNo(scenes, 0)).toBeUndefined();
    expect(findSceneByDisplayNo(scenes, 4)).toBeUndefined();
    expect(findSceneByDisplayNo(scenes, 1.5)).toBeUndefined();
  });

  it("displayShotNo matches Animation Studio compact numbering", () => {
    expect(displayShotNo(scenes, "b")).toBe(2);
    expect(displayShotNo(scenes, "missing")).toBeUndefined();
  });
});
