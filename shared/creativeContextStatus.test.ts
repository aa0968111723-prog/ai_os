import { describe, expect, it } from "vitest";
import { compactContextStates, compactSourceSummary, showConsistencyEnhance } from "./creativeContextStatus";

describe("compact creative-context UX copy", () => {
  it("only shows the three first-screen states", () => {
    expect(compactContextStates({
      applied: true,
      pending: 2,
      trainingAvailable: true,
      characters: 3,
      looks: 2,
      scenes: 4,
      props: 1,
      assets: 8,
      knowledge: 5,
    })).toEqual(["已套用專案設定", "有 2 項需要確認", "可加強一致性"]);
  });

  it("summarizes sources without configuration cards", () => {
    expect(compactSourceSummary({
      characters: 3,
      looks: 2,
      scenes: 4,
      props: 0,
      assets: 8,
      knowledge: 5,
      pending: 0,
    })).toEqual(["3 位角色", "2 套造型", "4 個場景", "8 項素材", "5 項知識引用"]);
  });

  it("does not offer fake training when the provider is absent", () => {
    expect(showConsistencyEnhance({
      providerConfigured: false,
      paidAuthorized: false,
      includedAssets: 12,
    })).toBe(false);
  });
});
