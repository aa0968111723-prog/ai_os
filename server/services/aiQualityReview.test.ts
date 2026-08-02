import { describe, expect, it } from "vitest";
import { extractBalancedJsonObject, parseAiQualityReview } from "./aiQualityReview";

describe("AI quality review structured output recovery", () => {
  it("extracts balanced JSON when text contains braces inside strings", () => {
    expect(extractBalancedJsonObject('前言 {"summary":"保留 {prev} 代號","warnings":[],"contextUsed":[]} 後記'))
      .toBe('{"summary":"保留 {prev} 代號","warnings":[],"contextUsed":[]}');
  });

  it("accepts fenced strict JSON", () => {
    const result = parseAiQualityReview('```json\n{"summary":"可執行","warnings":[],"contextUsed":["角色卡"]}\n```');
    expect(result.parseMode).toBe("strict");
    expect(result.review.summary).toBe("可執行");
  });

  it("repairs trailing commas and normalizes incomplete warning fields", () => {
    const result = parseAiQualityReview('{“summary”:“需補參考圖”,“warnings”:[{“severity”:“high”,“title”:“角色漂移”,“reason”:“沒有定裝圖”,}],}');
    expect(result.parseMode).toBe("repaired");
    expect(result.review.warnings[0]).toMatchObject({ severity: "warning", title: "角色漂移", detail: "沒有定裝圖" });
  });

  it("keeps useful prose instead of replacing it with a generic format error", () => {
    const result = parseAiQualityReview("角色設定已帶入，但場景沒有參考圖，第二鏡可能改變光線。建議先核准場景關鍵幀。");
    expect(result.parseMode).toBe("text_fallback");
    expect(result.review.summary).toContain("場景沒有參考圖");
    expect(result.review.warnings[0].code).toBe("REVIEW_TEXT_FALLBACK");
  });
});
