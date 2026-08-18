import { describe, expect, it } from "vitest";
import { storyParseModelSchema } from "../../shared/story";
import { TKU_ZEN_SHOTLIST_LINES } from "../../shared/fixtures/tkuZenPromo";
import { XIAOHUA_SEVEN_ACT_SCRIPT } from "../../shared/fixtures/xiaohuaSevenAct";
import { mockStoryExtract } from "./storyParse";

describe("小華 A–F SHOTLIST parse → scene → shot（E2E_MOCK，不打 live NIM）", () => {
  it("ingests the 6-beat 白帽T script, not 七幕", () => {
    const plan = mockStoryExtract(XIAOHUA_SEVEN_ACT_SCRIPT);
    expect(storyParseModelSchema.safeParse(plan).success).toBe(true);
    expect(plan.characters.map((c) => c.name)).toEqual(["小華", "禪定龜龜"]);
    expect(plan.locations.map((l) => l.name)).toEqual(expect.arrayContaining(["校門口", "夕陽"]));
    expect(plan.scenes).toHaveLength(6);
    const blob = JSON.stringify(plan);
    for (const line of TKU_ZEN_SHOTLIST_LINES) expect(blob).toContain(line);
    expect(blob).not.toMatch(/第七幕|安倢|媽媽叫醒|針織外套/);
  });
});
