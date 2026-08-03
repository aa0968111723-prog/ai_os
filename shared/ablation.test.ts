import { describe, expect, it } from "vitest";
import { ablationRunCount, buildAblationVariants } from "./ablation";
import { CARD_ANCHOR_MARKERS, WORLDVIEW_INJECT_MARKER } from "./worldview";

const PROMPT = [
  "晨光禪堂點香",
  `${WORLDVIEW_INJECT_MARKER} 調性:療癒|核心訊息:把心交給佛`,
  `${CARD_ANCHOR_MARKERS[0]} 外觀鎖定 安捷：紅色雨傘`,
  `${CARD_ANCHOR_MARKERS[2]} 材質鎖定 紅傘：木質握把`,
].join("\n\n");

describe("buildAblationVariants", () => {
  it("removes exactly one section per variant and leaves the rest verbatim", () => {
    const variants = buildAblationVariants(PROMPT);
    expect(variants.map((variant) => variant.section)).toEqual(["background", "character", "prop"]);

    const withoutCharacter = variants.find((variant) => variant.section === "character");
    expect(withoutCharacter?.prompt).not.toContain(CARD_ANCHOR_MARKERS[0]);
    // 其餘段落必須逐字保留，否則差異就不只來自被拿掉的那一段
    expect(withoutCharacter?.prompt).toContain("晨光禪堂點香");
    expect(withoutCharacter?.prompt).toContain(WORLDVIEW_INJECT_MARKER);
    expect(withoutCharacter?.prompt).toContain(CARD_ANCHOR_MARKERS[2]);
  });

  it("does not leave the blank-line gap the removed section used to occupy", () => {
    const variants = buildAblationVariants(PROMPT);
    for (const variant of variants) {
      expect(variant.prompt).not.toMatch(/\n{3,}/);
      expect(variant.prompt).toBe(variant.prompt.trim());
    }
  });

  it("has nothing to ablate when the prompt carries no injected section", () => {
    expect(buildAblationVariants("只有使用者自己打的指令")).toEqual([]);
    expect(ablationRunCount(0)).toBe(0);
  });

  it("counts the baseline run on top of the ablated ones", () => {
    expect(ablationRunCount(3)).toBe(4);
  });
});
