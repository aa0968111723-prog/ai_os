import { describe, expect, it } from "vitest";
import {
  bilingualChips,
  STYLE_EN,
  TONE_EN,
  STYLE_OPTIONS,
  TONE_OPTIONS,
  worldviewSchema,
  formatWorldviewForAi,
  formatWorldviewVisualPositive,
  isWorldviewReady,
  hasActs,
  removesDefaultTaboos,
  DEFAULT_TABOOS,
  LOGLINE_INJECT_MAX,
} from "./worldview";

describe("bilingualChips（視覺注入的英文錨點）", () => {
  it("內建風格 chips 全部有英文對應（新增內建選項時必須同步補映射）", () => {
    for (const s of STYLE_OPTIONS) expect(STYLE_EN[s], `STYLE_EN 缺 ${s}`).toBeTruthy();
    for (const t of TONE_OPTIONS) expect(TONE_EN[t], `TONE_EN 缺 ${t}`).toBeTruthy();
  });

  it("已映射的 chip 轉成「中文(英文)」形", () => {
    expect(bilingualChips(["日系水彩"], STYLE_EN)).toEqual(["日系水彩(Japanese watercolor illustration)"]);
  });

  it("組長自訂（無對應）chip 原樣保留，不猜翻譯", () => {
    expect(bilingualChips(["賽博龐克霓虹"], STYLE_EN)).toEqual(["賽博龐克霓虹"]);
    expect(bilingualChips([], STYLE_EN)).toEqual([]);
  });
});

const full = worldviewSchema.parse({
  logline: "一位訪客在晨光禪堂點起一炷香，把浮躁的心交還給平靜。",
  message: "把心交給當下，就能安住。",
  audience: "忙碌的都會上班族",
  themes: ["苦→修行→轉變→感恩"],
  tones: ["溫暖", "療癒"],
  styles: ["水墨禪意"],
  people: ["安倢：紅傘、米白外套"],
  acts: {
    hook: "晨光前庭",
    turn: "靜坐側影",
    cta: "字卡留白",
  },
  references: ["https://example.com/ref"],
  taboos: DEFAULT_TABOOS(),
});

describe("isWorldviewReady / hasActs", () => {
  it("僅 logline 不算就緒（缺調性或風格）", () => {
    expect(isWorldviewReady(worldviewSchema.parse({ logline: "有故事" }))).toBe(false);
  });

  it("logline + 調性 = 就緒", () => {
    expect(isWorldviewReady(worldviewSchema.parse({ logline: "有故事", tones: ["溫暖"] }))).toBe(true);
  });

  it("message + 風格 = 就緒", () => {
    expect(isWorldviewReady(worldviewSchema.parse({ message: "一片一訊息", styles: ["日系水彩"] }))).toBe(true);
  });

  it("hasActs 任一幕非空", () => {
    expect(hasActs(full)).toBe(true);
    expect(hasActs(worldviewSchema.parse({}))).toBe(false);
  });
});

describe("formatWorldviewForAi：跨消費端契約", () => {
  it("brief 必含 message 與 taboos（代理／助手防偏離）", () => {
    const s = formatWorldviewForAi(full, "brief");
    expect(s).toContain(full.message);
    expect(s).toContain(full.logline);
    expect(s).toContain("溫暖");
    expect(s).toContain("禁忌");
    expect(s).toContain("醫療");
    // brief 不塞長 acts／people／URL（控 token）
    expect(s).not.toContain("三幕");
    expect(s).not.toContain("example.com");
  });

  it("director 含 audience、acts、people", () => {
    const s = formatWorldviewForAi(full, "director");
    expect(s).toContain("忙碌的都會上班族");
    expect(s).toContain("鉤子：晨光前庭");
    expect(s).toContain("安倢：紅傘");
    expect(s).toContain("敘事人物");
    expect(s).toContain("禁忌");
  });

  it("export 含風格／主軸／三幕／人物／參考備註", () => {
    const s = formatWorldviewForAi(full, "export");
    expect(s).toContain("視覺風格");
    expect(s).toContain("訊息主軸");
    expect(s).toContain("三幕結構");
    expect(s).toContain("敘事人物");
    expect(s).toContain("參考連結");
  });

  it("generation-llm 含 themes 與截斷 logline", () => {
    const long = worldviewSchema.parse({
      ...full,
      logline: "字".repeat(LOGLINE_INJECT_MAX + 20),
      themes: ["禪修日常"],
    });
    const s = formatWorldviewForAi(long, "generation-llm");
    expect(s).toContain("訊息主軸:禪修日常");
    expect(s).toContain("故事錨點:");
    expect(s).toContain("…");
    expect(s.length).toBeLessThan(long.logline.length + 200);
  });
});

describe("formatWorldviewVisualPositive", () => {
  it("雙語風格 + 短 logline + message；不含禁忌句（禁忌走 negative）", () => {
    const s = formatWorldviewVisualPositive(full);
    expect(s).toContain("Chinese ink wash");
    expect(s).toContain("warm, gentle");
    expect(s).toContain("故事錨點");
    expect(s).toContain(full.message);
    expect(s).not.toContain("避免");
    expect(s).not.toContain("醫療");
  });
});

describe("removesDefaultTaboos", () => {
  it("刪掉預設禁語其中一條 → true", () => {
    const prev = DEFAULT_TABOOS();
    const next = prev.slice(1);
    expect(removesDefaultTaboos(prev, next)).toBe(true);
  });

  it("只加自訂不刪預設 → false", () => {
    const prev = DEFAULT_TABOOS();
    expect(removesDefaultTaboos(prev, [...prev, "不出現招牌字"])).toBe(false);
  });
});

describe("消費端 source-lock：必須走 formatWorldviewForAi（防各寫一行摘要分岔）", () => {
  it("director / agentCore / assistant / messageAssistant / exporter 皆 import formatWorldviewForAi", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..");
    const files = [
      "server/routers/director.ts",
      "server/services/agentCore.ts",
      "server/routers/assistant.ts",
      "server/services/messageAssistant.ts",
      "server/services/exporter.ts",
      "server/services/generationCore.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src, rel).toMatch(/formatWorldviewForAi|formatWorldviewVisualPositive/);
    }
  });
});
