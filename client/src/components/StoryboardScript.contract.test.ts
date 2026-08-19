import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/components/StoryboardScript.tsx"), "utf8");

describe("文字腳本 help samples are 小華 A–F, not 七幕", () => {
  it("edit-mode card-name help teaches 小華／禪定龜龜, not 安倢／紅傘", () => {
    expect(source).toContain("角色卡：小華・禪定龜龜");
    expect(source).toContain("場景卡：淡大校門口");
    expect(source).toContain("素材卡：禪學社圓標");
    expect(source).not.toContain("角色卡：安倢");
    expect(source).not.toContain("素材卡：安倢的紅傘");
    expect(source).not.toContain("場景卡：禪堂");
    expect(source).not.toContain("慕恩");
    expect(source).not.toContain("哲維");
    expect(source).not.toContain("瑀晴");
  });
});
