import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/components/PropCards.tsx"), "utf8");

describe("素材卡 UI sample writes 禪學社圓標, not 紅傘", () => {
  it("empty-state 帶入這張範例卡 mints A–F 禪定龜龜圓標, not 七幕 紅傘", () => {
    expect(source).toContain('name: "禪學社圓標"');
    expect(source).toContain("龜殼上的圓形社徽、墨色線稿、淡定感");
    expect(source).toContain("禪定龜龜殼上帶著，第三句登場");
    expect(source).not.toContain('name: "紅傘"');
    expect(source).not.toContain("安倢");
    expect(source).not.toContain("慕恩");
    expect(source).not.toContain("哲維");
    expect(source).not.toContain("瑀晴");
    expect(source).not.toContain("placeholder=\"例：紅傘\"");
    expect(source).not.toContain("正紅色長柄傘");
  });
});
