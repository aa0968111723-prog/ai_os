/**
 * 場景設定對整站的跨面契約：生成錨點、知識注入、generationCore 配線。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatSceneAnchor,
  formatSceneKnowledgeBlock,
  formatCharacterAnchor,
} from "./cardAnchors";
import { withCharacterAnchor, withSceneAnchor } from "./generationCore";
import { getModel, MODELS, type ModelEntry } from "../../shared/models";

const byCategory = (c: ModelEntry["category"]) => MODELS.find((m) => m.category === c)!;

describe("場景設定：跨面一致性（專案效益）", () => {
  const preset = {
    id: "s1",
    name: "禪堂前庭",
    palette: "米金、木色、白牆",
    lighting: "清晨柔側光",
  };

  it("生成錨點與知識卡色板／光線同源", () => {
    const visual = formatSceneAnchor([preset], ["s1"]);
    const knowledge = formatSceneKnowledgeBlock([preset]);
    expect(visual).toBe("光影鎖定 禪堂前庭：色板 米金、木色、白牆、光線 清晨柔側光");
    expect(knowledge).toContain("禪堂前庭：色板 米金、木色、白牆｜光線 清晨柔側光");
    // 關鍵描述一致 → 導演建議與生成圖不會各說各話
    expect(visual).toContain("米金、木色、白牆");
    expect(knowledge).toContain("米金、木色、白牆");
  });

  it("視覺類才注入 [場景設定]；llm／TTS 不注", () => {
    const t2i = byCategory("text-to-image");
    const llm = byCategory("llm");
    const tts = getModel("fal-ai/kokoro/mandarin-chinese")!;
    const anchor = formatSceneAnchor([preset], ["s1"]);
    expect(withSceneAnchor(t2i, "空景", anchor)).toContain("[場景設定]");
    expect(withSceneAnchor(llm, "寫旁白", anchor)).toBe("寫旁白");
    expect(withSceneAnchor(tts, "南無", anchor)).toBe("南無");
  });

  it("角色＋場景可疊加：身份錨點前置（角色 → 場景 → 使用者提示）", () => {
    const t2i = byCategory("text-to-image");
    const char = formatCharacterAnchor(
      [{ id: "c1", name: "安倢", appearance: "紅傘、米白外套" }],
      ["c1"],
    );
    const scene = formatSceneAnchor([preset], ["s1"]);
    // 與 submitGenerationCore 同巢狀：prop→scene→character（prepend 後角色在最前）
    const out = withCharacterAnchor(t2i, withSceneAnchor(t2i, "站在前庭", scene), char);
    expect(out.indexOf("[角色定裝]")).toBeLessThan(out.indexOf("[場景設定]"));
    expect(out.indexOf("[場景設定]")).toBeLessThan(out.indexOf("站在前庭"));
    expect(out).toContain("外觀鎖定 安倢：紅傘");
    expect(out).toContain("光影鎖定 禪堂前庭：色板");
  });

  it("勾選順序決定跨鏡光影順序（不因 DB 回傳亂序）", () => {
    const a = { id: "a", name: "A", palette: "暖", lighting: "柔" };
    const b = { id: "b", name: "B", palette: "冷", lighting: "硬" };
    expect(formatSceneAnchor([a, b], ["b", "a"])).toBe("光影鎖定 B：色板 冷、光線 硬；光影鎖定 A：色板 暖、光線 柔");
  });
});

describe("場景設定：架構 source-lock", () => {
  it("generationCore 自 cardAnchors 取 buildSceneAnchor（不再 import routers/scenePresets）", () => {
    const src = readFileSync(new URL("./generationCore.ts", import.meta.url), "utf8");
    expect(src).toContain('from "./cardAnchors"');
    expect(src).toContain("buildSceneAnchor");
    expect(src).toContain("withSceneAnchor");
    expect(src).not.toContain('from "../routers/scenePresets"');
    expect(src).not.toContain('from "../routers/characters"');
  });

  it("scenePresets router re-export buildSceneAnchor；mutations 掛 ACL", () => {
    const src = readFileSync(new URL("../routers/scenePresets.ts", import.meta.url), "utf8");
    expect(src).toContain('from "../services/cardAnchors"');
    expect(src).toContain("buildSceneAnchor");
    expect(src.match(/assertProjectEditable/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(src).toContain("assertReferenceImage");
    expect(src).toContain("clientRequestId");
    expect(src).toContain("isUniqueViolation");
  });

  it("knowledge 注入用 formatSceneKnowledgeBlock 單一真相", () => {
    const src = readFileSync(new URL("../routers/knowledge.ts", import.meta.url), "utf8");
    expect(src).toContain("formatSceneKnowledgeBlock");
    expect(src).toContain("formatCharacterKnowledgeBlock");
  });
});
