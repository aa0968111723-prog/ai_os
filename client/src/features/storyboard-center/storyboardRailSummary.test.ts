import { describe, expect, it } from "vitest";
import { storyboardRailSummary } from "./storyboardRailSummary";

const shot = (over: Partial<Parameters<typeof storyboardRailSummary>[0][number]> = {}) => ({
  id: over.id ?? "s1",
  title: "鏡",
  orderIndex: 1,
  assetId: null,
  assetKind: null,
  ...over,
});

describe("storyboardRailSummary", () => {
  it("counts scenes, shots, and ready inputs without a new gate", () => {
    const out = storyboardRailSummary([
      shot({ id: "a", storySceneId: "sc1", prompt: "雨中走路" }),
      shot({ id: "b", storySceneId: "sc1", action: "停住望天" }),
      shot({ id: "c", storySceneId: "sc2" }),
    ]);
    expect(out.sceneCount).toBe(2);
    expect(out.shotCount).toBe(3);
    expect(out.readyCount).toBe(2);
    expect(out.summary).toBe("2 場・3 鏡・可生成 2");
  });

  it("surfaces blocked and running as warnings", () => {
    const blocked = storyboardRailSummary([
      shot({ id: "a", reviewStatus: "changes", prompt: "x" }),
    ]);
    expect(blocked.warning).toBe("1 鏡需修改");
    const running = storyboardRailSummary([
      shot({ id: "a", pendingGenStatus: "running", prompt: "x" }),
    ]);
    expect(running.warning).toBe("1 鏡生成中");
  });
});
