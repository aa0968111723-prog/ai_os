import { describe, expect, it } from "vitest";
import {
  TKU_ZEN_PROMO_SCRIPT,
  tkuZenHasForbidden,
  tkuZenSpokenDialogue,
} from "../../shared/fixtures/tkuZenPromo";
import { mockStoryExtract } from "./storyParse";

describe("淡江禪學社 parse 150s fallback", () => {
  it("extracts only 小華 and 禪定龜龜 from the SHOTLIST script", () => {
    const plan = mockStoryExtract(TKU_ZEN_PROMO_SCRIPT);
    expect(plan.characters.map((c) => c.name)).toEqual(["小華", "禪定龜龜"]);
    expect(plan.characters[0]?.appearance).toContain("大二化工");
    expect(plan.characters[0]?.costume ?? "").toMatch(/針織外套|粉橘/);
    expect(plan.locations.map((l) => l.name)).toEqual(expect.arrayContaining(["克難坡"]));
    const spoken = plan.scenes
      .flatMap((scene) => scene.shots)
      .map((shot) => tkuZenSpokenDialogue(`${shot.dialogue ?? ""}\n${shot.voiceover ?? ""}\n${shot.prompt ?? ""}`))
      .join("\n");
    expect(spoken).toContain("我是大二化工系的小華");
    expect(spoken).toContain("真的真的");
    expect(spoken).toContain("禪定龜龜");
    expect(tkuZenHasForbidden(JSON.stringify(plan))).toEqual([]);
  });
});
