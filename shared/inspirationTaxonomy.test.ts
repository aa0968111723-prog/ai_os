import { describe, expect, it } from "vitest";
import {
  INSPIRATION_FACETS,
  TAXONOMY_VERSION,
  allInspirationTags,
  classifyInspiration,
  describeInspirationTag,
  groupInspirationTags,
  inspirationTagLabel,
  isKnownInspirationTag,
} from "./inspirationTaxonomy";

describe("inspiration taxonomy dictionary", () => {
  it("keeps facet and value ids unique and label-complete", () => {
    const facetIds = new Set<string>();
    for (const facet of INSPIRATION_FACETS) {
      expect(facetIds.has(facet.id)).toBe(false);
      facetIds.add(facet.id);
      expect(facet.label.length).toBeGreaterThan(0);
      expect(facet.maxValues).toBeGreaterThan(0);
      const valueIds = new Set<string>();
      for (const value of facet.values) {
        expect(valueIds.has(value.id)).toBe(false);
        valueIds.add(value.id);
        expect(value.label.length).toBeGreaterThan(0);
        // modality 是從 mediaKind 推的，沒有關鍵詞；其餘每個值都必須可命中
        if (!facet.derived) expect(value.keywords.length).toBeGreaterThan(0);
      }
    }
  });

  it("never lets the same keyword decide two values inside one facet", () => {
    // 同一 facet 內重複的關鍵詞會讓兩個值同分，排序只剩宣告順序＝分類形同擲骰
    for (const facet of INSPIRATION_FACETS) {
      const seen = new Map<string, string>();
      for (const value of facet.values) {
        for (const keyword of value.keywords) {
          const owner = seen.get(keyword);
          expect(owner, `${facet.id}: "${keyword}" 同時屬於 ${owner} 與 ${value.id}`).toBeUndefined();
          seen.set(keyword, value.id);
        }
      }
    }
  });

  it("exposes every tag through the lookup helpers", () => {
    const tags = allInspirationTags();
    expect(tags.length).toBeGreaterThan(30);
    for (const tag of tags) {
      expect(isKnownInspirationTag(tag)).toBe(true);
      expect(describeInspirationTag(tag)).not.toBeNull();
      expect(inspirationTagLabel(tag)).not.toBe(tag);
    }
    expect(isKnownInspirationTag("subject:not-a-real-value")).toBe(false);
    expect(describeInspirationTag("nope")).toBeNull();
    // 找不到就回原字串，不吐 undefined 到畫面
    expect(inspirationTagLabel("nope")).toBe("nope");
  });
});

describe("classifyInspiration", () => {
  it("always emits a modality tag derived from mediaKind", () => {
    for (const [kind, tag] of [
      ["image", "modality:image"],
      ["video", "modality:video"],
      ["audio", "modality:audio"],
      ["card", "modality:card"],
      ["text", "modality:text"],
    ] as const) {
      const result = classifyInspiration({ mediaKind: kind, title: "" });
      expect(result.tags).toContain(tag);
    }
    // 未知／缺漏一律當提示詞，與 DB 欄位預設一致
    expect(classifyInspiration({ mediaKind: "weird" }).tags).toContain("modality:text");
    expect(classifyInspiration({}).tags).toContain("modality:text");
  });

  it("classifies a Chinese prompt into subject / mood / light facets", () => {
    const result = classifyInspiration({
      mediaKind: "image",
      title: "孤獨城市夜景",
      promptText: "我想做一個有點孤獨的城市夜景故事，畫面偏冷色，偶爾有霓虹",
    });
    expect(result.tags).toContain("subject:city");
    expect(result.tags).toContain("mood:lonely");
    expect(result.tags).toContain("light:night");
    expect(result.tags).toContain("light:neon");
    // 題材優先當主分類
    expect(result.category).toBe("subject:city");
    expect(result.categoryLabel).toBe("城市建築");
    expect(result.version).toBe(TAXONOMY_VERSION);
  });

  it("classifies an English prompt the same way", () => {
    const result = classifyInspiration({
      mediaKind: "video",
      promptText: "aerial drone shot of a neon cyberpunk city at night, cinematic",
    });
    expect(result.tags).toContain("modality:video");
    expect(result.tags).toContain("subject:city");
    expect(result.tags).toContain("style:cyberpunk");
    expect(result.tags).toContain("light:neon");
    expect(result.tags).toContain("shot:aerial");
  });

  it("reads author tags, description and uploaded file names too", () => {
    const fromTags = classifyInspiration({ mediaKind: "image", tags: ["水墨", "禪修"] });
    expect(fromTags.tags).toContain("style:ink");
    expect(fromTags.tags).toContain("usage:dharma");

    const fromFileName = classifyInspiration({ mediaKind: "image", fileName: "sunset-beach-01.jpg" });
    expect(fromFileName.tags).toContain("light:golden");
    expect(fromFileName.tags).toContain("subject:nature");

    const fromDescription = classifyInspiration({ mediaKind: "image", description: "給法會用的海報主視覺" });
    expect(fromDescription.tags).toContain("usage:poster");
  });

  it("matches latin keywords on word boundaries only", () => {
    // "ink" 不該命中 "thinking"、"3d" 不該命中 "a3db"
    const noise = classifyInspiration({
      mediaKind: "image",
      promptText: "thinking about a3db and manganese, scanning",
    });
    expect(noise.tags).not.toContain("style:ink");
    expect(noise.tags).not.toContain("style:cg3d");
    expect(noise.tags).not.toContain("style:anime");

    // 真的寫出來就要命中（含帶符號的關鍵詞）
    expect(classifyInspiration({ promptText: "3D render, octane" }).tags).toContain("style:cg3d");
    expect(classifyInspiration({ promptText: "shot in b&w" }).tags).toContain("light:mono");
    expect(classifyInspiration({ promptText: "sci-fi corridor" }).tags).toContain("subject:fantasy");
  });

  it("caps each facet at its declared maxValues, strongest first", () => {
    const result = classifyInspiration({
      mediaKind: "image",
      // 五種風格全寫；風格 facet 上限 2，且水墨命中最多詞
      promptText: "水墨 國畫 書法 潑墨 宣紙 · pixel art · vintage · minimal · collage",
    });
    const styleTags = result.tags.filter((t) => t.startsWith("style:"));
    expect(styleTags.length).toBe(2);
    expect(styleTags[0]).toBe("style:ink");
  });

  it("is deterministic — same input, same output", () => {
    const input = {
      mediaKind: "image",
      title: "黃昏的海邊女生背影",
      promptText: "golden hour, close-up, warm tone, 療癒",
    };
    const a = classifyInspiration(input);
    const b = classifyInspiration(input);
    expect(a).toEqual(b);
    expect(a.tags).toEqual(b.tags);
  });

  it("falls back to the modality tag when nothing else matches", () => {
    const result = classifyInspiration({ mediaKind: "audio", title: "zzz", promptText: "zzz" });
    expect(result.tags).toEqual(["modality:audio"]);
    expect(result.category).toBe("modality:audio");
    expect(result.categoryLabel).toBe("音訊");
  });

  it("orders tags by facet declaration order for stable UI grouping", () => {
    const result = classifyInspiration({
      mediaKind: "image",
      promptText: "廟宇 水墨 寧靜 柔光 特寫 弘法",
    });
    const facets = result.tags.map((t) => t.split(":")[0]);
    const expectedOrder = ["modality", "subject", "style", "mood", "light", "shot", "usage"];
    const positions = facets.map((f) => expectedOrder.indexOf(f));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("reports per-tag hit scores so the UI can explain a classification", () => {
    const result = classifyInspiration({ mediaKind: "image", promptText: "城市 街道 建築 大樓" });
    const city = result.hits.find((h) => h.tag === "subject:city");
    expect(city?.score).toBe(4);
    expect(city?.facetLabel).toBe("題材");
    expect(city?.label).toBe("城市建築");
  });
});

describe("groupInspirationTags", () => {
  it("groups by facet in declaration order and drops unknown tags", () => {
    const groups = groupInspirationTags([
      "light:night",
      "subject:city",
      "modality:image",
      "totally:bogus",
    ]);
    expect(groups.map((g) => g.facet.id)).toEqual(["modality", "subject", "light"]);
    expect(groups[1].tags).toEqual([{ tag: "subject:city", label: "城市建築" }]);
  });

  it("returns an empty list when nothing is recognised", () => {
    expect(groupInspirationTags(["nope", "still:nope"])).toEqual([]);
  });
});
