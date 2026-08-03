import { describe, expect, it } from "vitest";
import { CARD_ANCHOR_MARKERS, WORLDVIEW_INJECT_MARKER } from "../../shared/worldview";
import { clipTokenCount } from "./clipTokenizer";
import { measurePromptBudget } from "./promptTokens";

const PROMPT = [
  "一位訪客在晨光禪堂點起一炷香，把浮躁的心慢慢交還給平靜",
  `${WORLDVIEW_INJECT_MARKER} 調性:療癒|視覺風格:手繪插畫|核心訊息:把心交給佛，日子就有了呼吸的空隙`,
  `${CARD_ANCHOR_MARKERS[0]} 外觀鎖定 安捷：紅色雨傘、米白外套、帆布包`,
  `${CARD_ANCHOR_MARKERS[2]} 材質鎖定 紅傘：正紅色長柄傘、木質握把`,
].join("\n\n");

describe("measurePromptBudget（CLIP 家族＝真的量得到）", () => {
  const budget = measurePromptBudget("fal-ai/fast-lightning-sdxl", PROMPT);

  it("reports measured tokens, not an estimate", () => {
    expect(budget.encoder.measured).toBe(true);
    expect(budget.encoder.contentTokens).toBe(75);
    expect(budget.totalTokens).toBe(clipTokenCount(PROMPT.replace(/\s+/g, " ")));
  });

  it("splits per section by cumulative prefixes so the boundaries land on the real sequence", () => {
    const sum = budget.segments.reduce((total, segment) => total + (segment.tokens ?? 0), 0);
    expect(sum).toBe(budget.totalTokens);
    expect(budget.segments.map((segment) => segment.key)).toEqual([
      "instruction",
      "background",
      "character",
      "prop",
    ]);
  });

  it("marks exactly which sections fall outside the 75-token content window", () => {
    expect(budget.overflows).toBe(true);
    // 截斷從尾端發生：最後疊上去的素材設定確定整段在線外
    expect(budget.segments.at(-1)?.status).toBe("dropped");
    expect(budget.segments[0].status).toBe("inside");
  });

  it("measures per-word usage, and the per-word totals add up to each section", () => {
    expect(budget.chunks.length).toBeGreaterThan(10);
    const perSection = budget.chunks.reduce<Record<string, number>>((totals, chunk) => {
      totals[chunk.key] = (totals[chunk.key] ?? 0) + chunk.tokens;
      return totals;
    }, {});
    for (const segment of budget.segments) {
      expect(perSection[segment.key], segment.key).toBe(segment.tokens);
    }
    // 中文吃 token：六個字的道具描述比整個 "hand-drawn" 還貴
    const heavy = budget.chunks.find((chunk) => chunk.text === "正紅色長柄傘");
    expect(heavy?.tokens).toBeGreaterThan(10);
  });

  it("keeps chunk status consistent with the window", () => {
    for (const chunk of budget.chunks) {
      const end = chunk.startToken + chunk.tokens;
      if (end <= 75) expect(chunk.status).toBe("inside");
      else if (chunk.startToken >= 75) expect(chunk.status).toBe("dropped");
      else expect(chunk.status).toBe("truncated");
    }
  });
});

describe("measurePromptBudget（T5＝FLUX.1 那條線）", () => {
  const budget = measurePromptBudget("fal-ai/flux/dev", PROMPT);

  it("measures with the bundled T5 vocabulary, and reserves the end-of-sequence slot", () => {
    expect(budget.encoder.measured).toBe(true);
    expect(budget.encoder.sequenceTokens).toBe(512);
    expect(budget.encoder.contentTokens).toBe(511);
    expect(budget.totalTokens).toBeGreaterThan(0);
  });

  it("exposes the fact that T5 has no Chinese in its vocabulary", () => {
    // 這是這份量測最重要的發現：中文在 T5 詞表裡沒有對應片段，整串塌成一個 <unk>。
    // token 數看起來很小，但那不是省空間，是模型讀不到語意。
    expect(budget.unknownTokens).toBeGreaterThan(0);
    expect(budget.chunks.some((chunk) => chunk.unknown)).toBe(true);
    // 中文塌成未知符號 → 總 token 數遠少於同一段文字在 CLIP 上的量
    const onClip = measurePromptBudget("fal-ai/fast-lightning-sdxl", PROMPT);
    expect(budget.totalTokens!).toBeLessThan(onClip.totalTokens! / 3);
  });

  it("still reads English normally", () => {
    const english = measurePromptBudget("fal-ai/flux/dev", "a red umbrella, hand-drawn illustration");
    expect(english.unknownTokens).toBe(0);
    expect(english.totalTokens).toBeGreaterThan(5);
  });

  it("uses the shorter distilled window for schnell", () => {
    const schnell = measurePromptBudget("fal-ai/flux/schnell", PROMPT);
    expect(schnell.encoder.sequenceTokens).toBe(256);
    expect(schnell.encoder.contentTokens).toBe(255);
  });
});

describe("measurePromptBudget（沒有內建分詞器的家族）", () => {
  it("refuses to report token numbers it cannot measure", () => {
    const budget = measurePromptBudget("fal-ai/kolors", PROMPT);
    expect(budget.encoder.measured).toBe(false);
    expect(budget.totalTokens).toBeNull();
    expect(budget.overflows).toBe(false);
    expect(budget.chunks).toEqual([]);
    expect(budget.segments.every((segment) => segment.tokens === null)).toBe(true);
    // 字數是真的，所以照給；官方載明的窗口只作參考，不拿來判斷截斷
    expect(budget.totalChars).toBeGreaterThan(0);
    expect(budget.encoder.documentedLimitTokens).toBe(256);
    expect(budget.unknownTokens).toBeNull();
    expect(budget.segments.every((segment) => segment.status === "unmeasured")).toBe(true);
  });

  it("says nothing about a window the vendor never published", () => {
    const budget = measurePromptBudget("fal-ai/ideogram/v4", PROMPT);
    expect(budget.encoder.measured).toBe(false);
    expect(budget.encoder.documentedLimitTokens).toBeUndefined();
    expect(budget.encoder.contentTokens).toBeUndefined();
  });
});
