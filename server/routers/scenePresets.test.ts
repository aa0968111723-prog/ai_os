/**
 * 場景設定 router 契約：每專案上限、partial update。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_PROJECT_SCENE_PRESETS } from "./scenePresets";
import { MAX_GENERATE_SCENE_PRESETS } from "../../shared/cardLimits";

const source = readFileSync(new URL("./scenePresets.ts", import.meta.url), "utf8");

describe("scenePresets router 契約", () => {
  it("每專案場景卡硬上限 50", () => {
    expect(MAX_PROJECT_SCENE_PRESETS).toBe(50);
    expect(source).toContain("此專案場景設定已達上限");
  });

  it("update 為 partial（防 lost update）", () => {
    expect(source).toContain("partial update");
    expect(source).toContain("if (input.name !== undefined) patch.name");
    expect(source).not.toMatch(/name:\s*input\.name\?\.trim\(\)\s*\?\?\s*row\.name/);
  });

  it("生成帶入上限 4", () => {
    expect(MAX_GENERATE_SCENE_PRESETS).toBe(4);
  });
});
