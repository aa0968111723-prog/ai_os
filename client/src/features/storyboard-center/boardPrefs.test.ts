/**
 * 分鏡分組規則測試：場序保持、場內依 orderIndex、未分場殿後、空場保留。
 * 分組錯了鏡會「消失」在別的場底下——比樣式壞更嚴重，必須鎖行為。
 */
import { describe, it, expect } from "vitest";
import { groupShotsByScene } from "./boardPrefs";

const shot = (id: string, storySceneId: string | null, orderIndex: number) => ({ id, storySceneId, orderIndex });

describe("groupShotsByScene", () => {
  it("場依傳入順序、場內鏡依 orderIndex 排序", () => {
    const groups = groupShotsByScene(
      ["s1", "s2"],
      [shot("b", "s1", 2), shot("a", "s1", 1), shot("c", "s2", 3)],
    );
    expect(groups.map((g) => g.storySceneId)).toEqual(["s1", "s2"]);
    expect(groups[0].shots.map((s) => s.id)).toEqual(["a", "b"]);
    expect(groups[1].shots.map((s) => s.id)).toEqual(["c"]);
  });

  it("未分場（null 或指向不存在的場）殿後成一組", () => {
    const groups = groupShotsByScene(["s1"], [shot("x", null, 5), shot("y", "ghost", 1), shot("a", "s1", 2)]);
    expect(groups).toHaveLength(2);
    expect(groups[1].storySceneId).toBeNull();
    expect(groups[1].shots.map((s) => s.id)).toEqual(["y", "x"]);
  });

  it("空場保留（顯示空群供之後掛鏡）；沒有未分場鏡就不出現未分場組", () => {
    const groups = groupShotsByScene(["s1", "s2"], [shot("a", "s1", 1)]);
    expect(groups).toHaveLength(2);
    expect(groups[1].shots).toEqual([]);
  });
});
