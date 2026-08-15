import { describe, expect, it } from "vitest";
import { PHONE_STAGES, inferPhoneStage } from "./phoneStages";

const at = (over: Partial<Parameters<typeof inferPhoneStage>[0]> = {}) =>
  inferPhoneStage({
    hasStory: false,
    shots: 0,
    shotsWithVisual: 0,
    generationsDone: 0,
    archived: false,
    ...over,
  });

describe("手機階段推導", () => {
  it("全空的新專案停在故事", () => {
    expect(at()).toBe("story");
  });

  it("有故事、還沒有分鏡 → 分鏡", () => {
    expect(at({ hasStory: true })).toBe("storyboard");
  });

  it("有分鏡、一格畫面都還沒有 → 視覺", () => {
    // 這裡刻意保守：說成「生成」會讓「繼續製作」把人帶到一個空的生成頁
    expect(at({ hasStory: true, shots: 8 })).toBe("visual");
  });

  it("部分分鏡有畫面 → 生成", () => {
    expect(at({ hasStory: true, shots: 8, shotsWithVisual: 3 })).toBe("generate");
  });

  it("每一鏡都有畫面、也真的生成過 → 交付", () => {
    expect(at({ hasStory: true, shots: 8, shotsWithVisual: 8, generationsDone: 8 })).toBe("deliver");
  });

  it("每一鏡都有畫面但都是手動上傳（沒生成過）→ 仍在生成階段", () => {
    // 沒跑過任何生成就說「可以交付」是在替使用者做他沒做過的判斷
    expect(at({ hasStory: true, shots: 8, shotsWithVisual: 8, generationsDone: 0 })).toBe("generate");
  });

  it("封存的專案一律算交付完畢", () => {
    expect(at({ archived: true })).toBe("deliver");
    expect(at({ archived: true, hasStory: true, shots: 8 })).toBe("deliver");
  });

  it("沒有故事但已經有分鏡的舊資料不會倒退回故事階段", () => {
    // 先有分鏡才補故事的專案（或從舊版遷移過來的）不該被推回第一格
    expect(at({ hasStory: false, shots: 5, shotsWithVisual: 2 })).toBe("generate");
  });

  it("推導結果一定落在宣告的五個階段內", () => {
    for (const hasStory of [true, false]) {
      for (const shots of [0, 1, 9]) {
        for (const withVisual of [0, 1, 9]) {
          for (const done of [0, 3]) {
            const stage = at({ hasStory, shots, shotsWithVisual: Math.min(withVisual, shots), generationsDone: done });
            expect(PHONE_STAGES).toContain(stage);
          }
        }
      }
    }
  });
});
