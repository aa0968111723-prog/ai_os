import { describe, expect, it } from "vitest";
import { CARD_ANCHOR_MARKERS, WORLDVIEW_INJECT_MARKER } from "@shared/worldview";
import {
  buildPromptFlow,
  distributePromptWarnings,
  parseNegativeItems,
  parsePromptFields,
  visualWidth,
  type PromptFlowNodeKey,
} from "./promptFlow";

/** 與伺服器 buildPositive／withXxxAnchor 疊出來的形狀一致的真實樣本 */
const REAL_PROMPT = [
  "檢查分鏡生成是否都綁定角色定裝與場景預設",
  "",
  `${WORLDVIEW_INJECT_MARKER} 調性:療癒(soothing, healing)|視覺風格:手繪插畫(hand-drawn illustration)|故事錨點:一位訪客在晨光禪堂點起一炷香，在陪伴與整理之間，把浮躁的心慢慢交還給平靜。|核心訊息:把心交給佛，日子就有了呼吸的空隙。`,
  "",
  `${CARD_ANCHOR_MARKERS[0]} 外觀鎖定 安捷：紅色雨傘、米白外套、帆布包、無眼鏡、溫柔回望`,
  "",
  `${CARD_ANCHOR_MARKERS[1]} 光影鎖定 城市清晨：色板 暖色調、低飽和、光線 35mm 淺景深、柔和晨光斜射`,
  "",
  `${CARD_ANCHOR_MARKERS[2]} 材質鎖定 紅傘：正紅色長柄傘、木質握把、傘面微舊`,
].join("\n");

describe("buildPromptFlow", () => {
  it("splits the assembled prompt back into the sections the server stacked", () => {
    const flow = buildPromptFlow(REAL_PROMPT);
    expect(flow.map((node) => node.key)).toEqual([
      "instruction",
      "background",
      "character",
      "scene",
      "prop",
    ]);
    expect(flow[0].text).toBe("檢查分鏡生成是否都綁定角色定裝與場景預設");
    expect(flow[0].fields).toEqual([]);
    expect(flow[1].fields).toEqual([
      { label: "調性", value: "療癒(soothing, healing)" },
      { label: "視覺風格", value: "手繪插畫(hand-drawn illustration)" },
      { label: "故事錨點", value: "一位訪客在晨光禪堂點起一炷香，在陪伴與整理之間，把浮躁的心慢慢交還給平靜。" },
      { label: "核心訊息", value: "把心交給佛，日子就有了呼吸的空隙。" },
    ]);
    // 卡片段落的動詞前綴由節點副標承擔，欄位只留「名稱 → 外觀」
    expect(flow[2].fields).toEqual([{ label: "安捷", value: "紅色雨傘、米白外套、帆布包、無眼鏡、溫柔回望" }]);
    expect(flow[3].fields).toEqual([{ label: "城市清晨", value: "色板 暖色調、低飽和、光線 35mm 淺景深、柔和晨光斜射" }]);
    expect(flow[4].fields).toEqual([{ label: "紅傘", value: "正紅色長柄傘、木質握把、傘面微舊" }]);
  });

  it("keeps a prompt without any marker as a single instruction node", () => {
    const flow = buildPromptFlow("只有使用者自己打的指令");
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ key: "instruction", text: "只有使用者自己打的指令" });
  });

  it("orders sections by where they really appear, and drops empty ones", () => {
    const flow = buildPromptFlow(
      `指令\n\n${CARD_ANCHOR_MARKERS[0]} 外觀鎖定 安捷：紅傘\n\n${WORLDVIEW_INJECT_MARKER} \n\n${CARD_ANCHOR_MARKERS[2]} 材質鎖定 紅傘：木質握把`,
    );
    expect(flow.map((node) => node.key)).toEqual(["instruction", "character", "prop"]);
  });

  it("returns nothing for an empty prompt", () => {
    expect(buildPromptFlow("")).toEqual([]);
  });

  it("keeps multi-card sections as one field per card", () => {
    const flow = buildPromptFlow(`${CARD_ANCHOR_MARKERS[0]} 外觀鎖定 安捷：紅傘；外觀鎖定 阿嬤：灰色毛衣`);
    expect(flow[0].fields).toEqual([
      { label: "安捷", value: "紅傘" },
      { label: "阿嬤", value: "灰色毛衣" },
    ]);
  });
});

describe("parsePromptFields", () => {
  it("does not treat half a sentence as a field label", () => {
    // 冒號出現在句子中間：整段保留成內容，不能被切成假的「欄位名」
    const long = "一位訪客在晨光禪堂點起一炷香，在陪伴之間把心交還給平靜：這是重點";
    expect(parsePromptFields(long)).toEqual([{ value: long }]);
  });
});

describe("visualWidth", () => {
  it("counts full-width characters as twice the width of latin ones", () => {
    expect(visualWidth("把心交給佛")).toBe(5);
    expect(visualWidth("1080x1920")).toBe(4.5);
    // 這一段只有 21 個字元，但實際比 21 個中文字窄得多——欄位排版要看寬度不是字數
    expect(visualWidth("療癒(soothing, healing)")).toBeGreaterThan(10);
    expect(visualWidth("9:16")).toBeLessThan(10);
  });
});

describe("parseNegativeItems", () => {
  it("splits the taboo list so each blocked item is visible on its own", () => {
    expect(parseNegativeItems("治癒, 保佑、療效；醫療宣稱")).toEqual(["治癒", "保佑", "療效", "醫療宣稱"]);
    expect(parseNegativeItems("")).toEqual([]);
  });
});

describe("distributePromptWarnings", () => {
  const warning = (code: string) => ({
    code,
    severity: "warning" as const,
    title: `標題 ${code}`,
    detail: "說明",
  });

  it("attaches each warning to the section it is actually talking about", () => {
    const present = new Set<PromptFlowNodeKey>(["instruction", "character", "negative"]);
    const result = distributePromptWarnings(
      [warning("card_images_not_sent"), warning("negative_prompt_unsupported"), warning("manual_override")],
      present,
    );
    expect(result.byNode.character?.map((item) => item.code)).toEqual(["card_images_not_sent"]);
    expect(result.byNode.negative?.map((item) => item.code)).toEqual(["negative_prompt_unsupported"]);
    expect(result.byNode.instruction?.map((item) => item.code)).toEqual(["manual_override"]);
    expect(result.general).toEqual([]);
  });

  it("keeps warnings visible when the target node is absent or the code is unknown", () => {
    const result = distributePromptWarnings(
      [warning("cards_ignored"), warning("some_future_code")],
      new Set<PromptFlowNodeKey>(["instruction"]),
    );
    expect(result.byNode.character).toBeUndefined();
    expect(result.general.map((item) => item.code)).toEqual(["cards_ignored", "some_future_code"]);
  });
});
