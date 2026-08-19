import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "client/src/components/WorkflowCard.tsx"), "utf8");

describe("製作範本 idea sample teaches 小華 A–F, not 禪堂一炷香", () => {
  it("empty idea placeholder samples 淡大校門口 白帽T, not 七幕 禪堂", () => {
    expect(source).toContain("例：淡大校門口，粉橘短髮女孩、白帽T的小華向鏡頭自我介紹");
    expect(source).not.toContain("清晨禪堂中一炷香緩緩升起，傳達放下與新生");
    expect(source).not.toContain("一炷香");
    expect(source).not.toContain("安倢");
    expect(source).not.toContain("慕恩");
    expect(source).not.toContain("紅傘");
    expect(source).not.toContain("針織外套");
  });
});
