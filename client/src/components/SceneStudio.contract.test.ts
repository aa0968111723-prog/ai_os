import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const studio = readFileSync(resolve(process.cwd(), "client/src/components/SceneStudio.tsx"), "utf8");
const inspector = readFileSync(
  resolve(process.cwd(), "client/src/features/animation-studio/ShotInspector.tsx"),
  "utf8",
);

describe("單格／工作室 empty-field samples are 小華 A–F, not 七幕", () => {
  it("SceneStudio action + dialogue examples never mention 安倢／慕恩／紅傘", () => {
    expect(studio).toContain("小華從淡大校門口走到鏡頭前");
    expect(studio).toContain("@小華：咦？你是誰？");
    expect(studio).toContain("@禪定龜龜：");
    expect(studio).not.toContain("安倢");
    expect(studio).not.toContain("慕恩");
    expect(studio).not.toContain("紅傘");
  });

  it("ShotInspector action + dialogue placeholders match the same lock", () => {
    expect(inspector).toContain("小華從淡大校門口走到鏡頭前，停下");
    expect(inspector).toContain("@小華：咦？你是誰？");
    expect(inspector).not.toContain("安倢");
    expect(inspector).not.toContain("慕恩");
    expect(inspector).not.toContain("紅傘");
  });

  it("ShotInspector prompt placeholder teaches A–F 校門口 白帽T, not 禪堂空景", () => {
    expect(inspector).toContain("淡大校門口校名牌前，粉橘短髮女孩、白帽T的小華，暖色光");
    expect(inspector).not.toContain("清晨的禪堂空景");
  });
});
