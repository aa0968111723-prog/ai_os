import { describe, expect, it } from "vitest";
import { PHONE_STAGES } from "@shared/phoneStages";
import { MOBILE_STAGES, continueAnchor, continueLabel, stageIndex, stageLabel, stageSentence } from "./stages";

describe("手機製作階段", () => {
  it("前後端的階段字面值完全一致", () => {
    // 兩邊各寫一組字的話，伺服器推的階段會對不上畫面上亮起來的那一格——
    // 症狀是進度列永遠停在第一格，而且不會有任何錯誤。
    expect(MOBILE_STAGES.map((s) => s.id)).toEqual([...PHONE_STAGES]);
  });

  it("未知階段退回第一格而不是炸掉", () => {
    // 伺服器加了新階段、前端還沒部署時，畫面該退化不該白屏
    expect(stageIndex("something-new")).toBe(0);
    expect(stageLabel("something-new")).toBe("故事");
  });

  it("待裁決的生成蓋過階段敘述——那是最該先處理的事", () => {
    expect(stageSentence({ stage: "generate", shots: 8, shotsWithVisual: 3, awaitingGenerations: 2 }))
      .toBe("2 筆生成等你裁決");
  });

  it("每個階段都講得出一句具體的現況與一顆具體的按鈕", () => {
    for (const step of MOBILE_STAGES) {
      const sentence = stageSentence({ stage: step.id, shots: 5, shotsWithVisual: 2, awaitingGenerations: 0 });
      expect(sentence.length).toBeGreaterThan(0);
      // 按鈕要講出它會做什麼，泛稱「繼續製作」只留給收尾階段
      expect(continueLabel(step.id).length).toBeGreaterThan(0);
      expect(continueAnchor(step.id).length).toBeGreaterThan(0);
    }
  });

  it("「繼續製作」的錨點沿用桌面版既有的區塊 id（深連結契約）", () => {
    expect(continueAnchor("story")).toBe("story");
    expect(continueAnchor("storyboard")).toBe("storyboard");
    expect(continueAnchor("visual")).toBe("production");
    expect(continueAnchor("generate")).toBe("production");
  });
});
