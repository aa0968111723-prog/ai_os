import { describe, expect, it } from "vitest";
import { LOW_CONFIDENCE_SAMPLE, summarizeLogprobs } from "./llmIntrospection";

describe("summarizeLogprobs", () => {
  it("turns logprobs into probabilities and surfaces the least certain tokens", () => {
    const summary = summarizeLogprobs([
      { token: "把", logprob: -0.01 },
      { token: "心", logprob: -0.02 },
      { token: "療效", logprob: -2.3 },
    ]);
    expect(summary.meanConfidence).toBeGreaterThan(0);
    expect(summary.meanConfidence).toBeLessThan(1);
    expect(summary.lowestConfidence?.[0].token).toBe("療效");
    expect(summary.lowestConfidence?.[0].probability).toBeCloseTo(Math.exp(-2.3), 5);
  });

  it("averages in log space so a few confident tokens cannot mask an unsure one", () => {
    const geometric = summarizeLogprobs([
      { token: "a", logprob: 0 },
      { token: "b", logprob: 0 },
      { token: "c", logprob: -6 },
    ]).meanConfidence ?? 0;
    // 算術平均會給 0.67；幾何平均落在 0.14 左右，才反映得出「有一個 token 幾乎沒把握」
    expect(geometric).toBeLessThan(0.2);
  });

  it("caps the sample and ignores unusable entries", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ token: `t${index}`, logprob: -index }));
    expect(summarizeLogprobs(many).lowestConfidence).toHaveLength(LOW_CONFIDENCE_SAMPLE);
    expect(summarizeLogprobs([{ token: "x", logprob: Number.NaN }])).toEqual({});
    expect(summarizeLogprobs([])).toEqual({});
  });
});
