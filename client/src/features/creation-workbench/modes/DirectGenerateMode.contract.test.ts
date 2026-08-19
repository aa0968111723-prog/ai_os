import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "client/src/features/creation-workbench/modes/DirectGenerateMode.tsx"),
  "utf8",
);

describe("製作 AI 工作台 prompt sample teaches 小華 A–F, not 禪堂一炷香", () => {
  it("empty-prompt placeholder samples 淡大校門口 白帽T, not 七幕 禪堂", () => {
    expect(source).toContain("例：小華站在淡大校門口校名牌前，粉橘短髮女孩、白帽T，暖色光");
    expect(source).not.toContain("清晨禪堂，柔和光線灑落，一炷香的靜謐");
    expect(source).not.toContain("一炷香");
    expect(source).not.toContain("禪堂");
    expect(source).not.toContain("安倢");
    expect(source).not.toContain("慕恩");
    expect(source).not.toContain("紅傘");
    expect(source).not.toContain("針織外套");
    expect(source).not.toContain("米白外套");
  });
});
