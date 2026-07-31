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
  formatChipsPrimarySecondary,
  formatWorldviewStylesLabel,
  isWorldviewReady,
  hasActs,
  removesDefaultTaboos,
  DEFAULT_TABOOS,
  LOGLINE_INJECT_MAX,
  VISUAL_INJECT_MAX,
  LLM_INJECT_MAX,
  CHIP_SOFT_MAX,
  toggleWorldviewChip,
  selectWorldviewStyle,
  selectWorldviewStyleFamily,
  selectWorldviewStyleLook,
  selectWorldviewStyleTexture,
  keepPrimaryWorldviewStyle,
  promoteWorldviewChip,
  hasStyleFamilyConflict,
  parseWorldviewStyleSlots,
  stylesForVisualInject,
  canonicalizeWorldviewStyles,
  chipSoftWarnings,
  worldviewChipGuidanceForAi,
  normalizeWorldviewChipsPatch,
  summarizeWorldviewChipsPatch,
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

  it("跨家族多選只注入可解析主風格；調性最多前兩個", () => {
    const crowded = worldviewSchema.parse({
      styles: ["寫實攝影", "水墨禪意", "3D 動畫"],
      tones: ["莊嚴", "溫暖", "活潑", "簡約"],
      logline: "測試",
    });
    const s = formatWorldviewVisualPositive(crowded);
    expect(s).toContain("photorealistic");
    expect(s).not.toContain("ink wash");
    expect(s).not.toContain("3D animated");
    expect(s).toContain("solemn");
    expect(s).toContain("warm, gentle");
    expect(s).not.toContain("lively");
    expect(s).not.toContain("minimal");
    expect(VISUAL_INJECT_MAX.styles).toBe(2);
    expect(VISUAL_INJECT_MAX.tones).toBe(2);
  });

  it("同家族主風格＋質感可並存注入", () => {
    const film = worldviewSchema.parse({
      styles: ["寫實攝影", "膠片質感"],
      logline: "測試",
    });
    const s = formatWorldviewVisualPositive(film);
    expect(s).toContain("photorealistic");
    expect(s).toContain("analog film grain");
  });
});

describe("chips 優先序、家族與軟警告", () => {
  it("toggle／promote 維護順序＝主要（主軸／調性複選）", () => {
    let cur: string[] = [];
    cur = toggleWorldviewChip(cur, "寫實攝影");
    cur = toggleWorldviewChip(cur, "水墨禪意");
    expect(cur).toEqual(["寫實攝影", "水墨禪意"]);
    cur = promoteWorldviewChip(cur, "水墨禪意");
    expect(cur).toEqual(["水墨禪意", "寫實攝影"]);
    cur = toggleWorldviewChip(cur, "水墨禪意");
    expect(cur).toEqual(["寫實攝影"]);
  });

  it("selectWorldviewStyle：look 准單選、texture 可疊、跨家族切換", () => {
    expect(selectWorldviewStyle([], "寫實攝影")).toEqual(["寫實攝影"]);
    expect(selectWorldviewStyle(["寫實攝影"], "水墨禪意")).toEqual(["水墨禪意"]);
    expect(selectWorldviewStyle(["寫實攝影"], "寫實攝影")).toEqual([]);
    expect(selectWorldviewStyle(["寫實攝影"], "膠片質感")).toEqual(["寫實攝影", "膠片質感"]);
    expect(selectWorldviewStyle(["寫實攝影", "膠片質感"], "膠片質感")).toEqual(["寫實攝影"]);
    // 舊多選：點 look → 只留該 look
    expect(selectWorldviewStyle(["寫實攝影", "水墨禪意", "3D 動畫"], "水墨禪意")).toEqual(["水墨禪意"]);
  });

  it("selectWorldviewStyleFamily／Look／Texture", () => {
    expect(selectWorldviewStyleFamily([], "photo")).toEqual(["寫實攝影"]);
    expect(selectWorldviewStyleFamily(["手繪插畫"], "photo")).toEqual(["寫實攝影"]);
    expect(selectWorldviewStyleFamily(["寫實攝影", "膠片質感"], "photo")).toEqual([
      "寫實攝影",
      "膠片質感",
    ]);
    expect(selectWorldviewStyleLook(["寫實攝影", "膠片質感"], "寫實攝影")).toEqual([]);
    expect(selectWorldviewStyleTexture([], "膠片質感")).toEqual(["寫實攝影", "膠片質感"]);
  });

  it("parse／canonicalize／stylesForVisualInject", () => {
    expect(parseWorldviewStyleSlots(["寫實攝影", "膠片質感"])).toMatchObject({
      family: "photo",
      look: "寫實攝影",
      texture: "膠片質感",
    });
    expect(canonicalizeWorldviewStyles(["寫實攝影", "水墨禪意", "3D 動畫"])).toEqual(["寫實攝影"]);
    expect(stylesForVisualInject(["寫實攝影", "膠片質感", "水墨禪意"])).toEqual([
      "寫實攝影",
      "膠片質感",
    ]);
    expect(formatWorldviewStylesLabel(["寫實攝影", "膠片質感"])).toBe(
      "主風格:寫實攝影；質感:膠片質感",
    );
  });

  it("keepPrimaryWorldviewStyle 一鍵收斂", () => {
    expect(keepPrimaryWorldviewStyle(["寫實攝影", "水墨禪意"])).toEqual(["寫實攝影"]);
    expect(keepPrimaryWorldviewStyle(["寫實攝影", "膠片質感"])).toEqual(["寫實攝影", "膠片質感"]);
    expect(keepPrimaryWorldviewStyle(["日系水彩"])).toEqual(["日系水彩"]);
    expect(keepPrimaryWorldviewStyle([])).toEqual([]);
  });

  it("跨媒材家族衝突／同家族不衝突", () => {
    expect(hasStyleFamilyConflict(["寫實攝影", "水墨禪意"])).toBe(true);
    expect(hasStyleFamilyConflict(["寫實攝影", "膠片質感"])).toBe(false);
    expect(hasStyleFamilyConflict(["日系水彩"])).toBe(false);
  });

  it("chipSoftWarnings 在超標與衝突時有文案", () => {
    const w = chipSoftWarnings({
      themes: ["a", "b", "c"],
      tones: ["1", "2", "3"],
      styles: ["寫實攝影", "3D 動畫"],
    });
    expect(w.some((x) => x.includes("視覺風格"))).toBe(true);
    expect(w.some((x) => x.includes("收斂") || x.includes("出圖"))).toBe(true);
    expect(w.some((x) => x.includes("調性"))).toBe(true);
    expect(w.some((x) => x.includes("訊息主軸"))).toBe(true);
    expect(w.some((x) => x.includes("媒材"))).toBe(true);
    expect(CHIP_SOFT_MAX.styles).toBe(2);
  });

  it("formatChipsPrimarySecondary 標主要／備選", () => {
    expect(formatChipsPrimarySecondary(["A"])).toBe("A");
    expect(formatChipsPrimarySecondary(["A", "B", "C"])).toBe("主要:A；備選:B、C");
    expect(formatChipsPrimarySecondary(["A", "B", "C"], 2)).toBe("主要:A；備選:B…(+1)");
  });

  it("worldviewChipGuidanceForAi 無警告時空字串", () => {
    expect(worldviewChipGuidanceForAi({ themes: ["禪修日常"], tones: ["溫暖"], styles: ["水墨禪意"] })).toBe(
      "",
    );
    expect(worldviewChipGuidanceForAi({ themes: [], tones: [], styles: ["寫實攝影", "3D 動畫"] })).toContain(
      "世界觀 chips 提示",
    );
  });

  it("generation-llm 截斷多選 chips", () => {
    const crowded = worldviewSchema.parse({
      ...full,
      styles: ["寫實攝影", "水墨禪意", "3D 動畫"],
      tones: ["莊嚴", "溫暖", "活潑"],
      themes: ["苦→修行→轉變→感恩", "禪修日常", "活動紀實"],
    });
    const s = formatWorldviewForAi(crowded, "generation-llm");
    expect(s).toContain("視覺風格:寫實攝影");
    expect(s).not.toContain("水墨禪意");
    expect(s).toContain("調性:莊嚴、溫暖");
    expect(s).not.toContain("活潑");
    expect(s).toContain("訊息主軸:苦→修行→轉變→感恩、禪修日常");
    expect(s).not.toContain("活動紀實");
    expect(LLM_INJECT_MAX.themes).toBe(2);
  });

  it("brief／export 含風格標籤與選項提示", () => {
    const crowded = worldviewSchema.parse({
      ...full,
      styles: ["寫實攝影", "3D 動畫"],
    });
    const brief = formatWorldviewForAi(crowded, "brief");
    expect(brief).toContain("寫實攝影");
    expect(brief).toContain("選項提示");
    const exp = formatWorldviewForAi(crowded, "export");
    expect(exp).toContain("寫實攝影");
  });

  it("normalizeWorldviewChipsPatch 截斷去重 canonicalize；未傳欄位不出現", () => {
    const p = normalizeWorldviewChipsPatch({
      styles: [" 寫實攝影 ", "寫實攝影", "水墨禪意", "3D 動畫"],
      tones: ["溫暖", "真誠", "活潑"],
    });
    expect(p.styles).toEqual(["寫實攝影"]);
    expect(p.tones).toEqual(["溫暖", "真誠"]);
    expect(p.themes).toBeUndefined();
    expect(summarizeWorldviewChipsPatch(p)).toContain("寫實攝影");

    const film = normalizeWorldviewChipsPatch({
      styles: ["寫實攝影", "膠片質感"],
    });
    expect(film.styles).toEqual(["寫實攝影", "膠片質感"]);
  });
});

describe("removesDefaultTaboos", () => {
  it("刪掉預設禁語其中一條 → true", () => {
    const prev = DEFAULT_TABOOS();
    const next = prev.slice(1);
    expect(removesDefaultTaboos(prev, next)).toBe(true);
  });

  it("原樣或只加新條 → false", () => {
    const prev = DEFAULT_TABOOS();
    expect(removesDefaultTaboos(prev, prev)).toBe(false);
    expect(removesDefaultTaboos(prev, [...prev, "自訂"])).toBe(false);
  });
});
