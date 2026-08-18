import { describe, expect, it } from "vitest";
import { storyParseModelSchema } from "../../shared/story";
import { XIAOHUA_SEVEN_ACT_SCRIPT, XIAOHUA_SEVEN_ACTS } from "../../shared/fixtures/xiaohuaSevenAct";
import { mockStoryExtract } from "./storyParse";

describe("小華七幕 parse → scene → shot（E2E_MOCK，不打 live NIM）", () => {
  it("ingests the 7-act script into 7 scenes with shots", () => {
    const plan = mockStoryExtract(XIAOHUA_SEVEN_ACT_SCRIPT);
    expect(storyParseModelSchema.safeParse(plan).success).toBe(true);
    expect(plan.characters.map((c) => c.name)).toEqual(["小華", "禪定龜龜"]);
    expect(plan.locations.map((l) => l.name)).toEqual(expect.arrayContaining(["宿舍", "克難坡"]));
    expect(plan.scenes).toHaveLength(7);
    const shots = plan.scenes.flatMap((scene) => scene.shots);
    expect(shots.length).toBeGreaterThanOrEqual(7);
    expect(shots.some((shot) => (shot.characterRefs ?? []).includes("小華"))).toBe(true);
    expect(shots.some((shot) => (shot.characterRefs ?? []).includes("禪定龜龜"))).toBe(true);
    const blob = JSON.stringify(plan);
    for (const act of XIAOHUA_SEVEN_ACTS) {
      expect(blob).toContain(act.slice(0, 12));
    }
    expect(blob).toContain("第七幕");
    expect(blob).not.toMatch(/安倢|媽媽叫醒/);
  });
});
