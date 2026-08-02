/**
 * 場景設定（主）＋角色定裝 錨點純規則。
 * 重點：選取順序、截短、知識區塊上限——跨鏡光影一致的契約。
 */
import { describe, expect, it } from "vitest";
import {
  CARD_FIELD_MAX,
  PRESET_KNOWLEDGE_INJECT_MAX,
  PROP_KNOWLEDGE_INJECT_MAX,
  clipCardField,
  formatCharacterAnchor,
  formatCharacterKnowledgeBlock,
  formatPropAnchor,
  formatPropKnowledgeBlock,
  formatSceneAnchor,
  formatSceneKnowledgeBlock,
  orderRowsByIds,
  pickFirstReference,
} from "./cardAnchors";

const S_ZEN = { id: "s1", name: "禪堂", palette: "米金、木色", lighting: "柔側光、晨曦" };
const S_RAIN = { id: "s2", name: "雨巷", palette: "青灰", lighting: null as string | null };
const S_LONG = {
  id: "s3",
  name: "長色板",
  palette: "色".repeat(CARD_FIELD_MAX + 50),
  lighting: "光".repeat(CARD_FIELD_MAX + 10),
};

describe("formatSceneAnchor（視覺生成・場景設定）", () => {
  it("依選取順序串接色板＋光線", () => {
    // DB 可能以 s1 在前；使用者先勾雨巷
    expect(formatSceneAnchor([S_ZEN, S_RAIN], ["s2", "s1"])).toBe(
      "光影鎖定 雨巷：色板 青灰；光影鎖定 禪堂：色板 米金、木色、光線 柔側光、晨曦",
    );
  });

  it("無光線時只出色板", () => {
    expect(formatSceneAnchor([S_RAIN], ["s2"])).toBe("光影鎖定 雨巷：色板 青灰");
  });

  it("色板／光線超過上限被截短", () => {
    const out = formatSceneAnchor([S_LONG], ["s3"]);
    expect(out).toContain("長色板：色板 ");
    expect(out).toContain("、光線 ");
    // 截短後總長度有界
    const palettePart = out.split("色板 ")[1]?.split("、光線")[0] ?? "";
    expect(palettePart.length).toBe(CARD_FIELD_MAX);
  });

  it("空／全 miss → 空字串", () => {
    expect(formatSceneAnchor([S_ZEN], [])).toBe("");
    expect(formatSceneAnchor([S_ZEN], ["nope"])).toBe("");
  });

  it("重複 id 去重且保序", () => {
    expect(formatSceneAnchor([S_ZEN, S_RAIN], ["s1", "s1", "s2"])).toBe(
      "光影鎖定 禪堂：色板 米金、木色、光線 柔側光、晨曦；光影鎖定 雨巷：色板 青灰",
    );
  });
});

describe("formatSceneKnowledgeBlock（導演／助手・場景設定）", () => {
  it("輸出【場景設定卡】含色板與光線", () => {
    const block = formatSceneKnowledgeBlock([S_ZEN, S_RAIN]);
    expect(block).toContain("【場景設定卡】");
    expect(block).toContain("- 禪堂：色板 米金、木色｜光線 柔側光、晨曦");
    expect(block).toContain("- 雨巷：色板 青灰");
    expect(block).not.toContain("雨巷：色板 青灰｜光線");
  });

  it("超過上限附「另有 N 張」", () => {
    const many = Array.from({ length: PRESET_KNOWLEDGE_INJECT_MAX + 3 }, (_, i) => ({
      id: `p${i}`,
      name: `場${i}`,
      palette: "色",
      lighting: "光",
    }));
    const block = formatSceneKnowledgeBlock(many);
    expect(block.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(PRESET_KNOWLEDGE_INJECT_MAX);
    expect(block).toContain("另有 3 張場景卡未注入");
  });

  it("空列表 → 空字串", () => {
    expect(formatSceneKnowledgeBlock([])).toBe("");
  });
});

describe("formatCharacterAnchor 仍可用（與場景並存）", () => {
  it("只拼外觀不拼個性", () => {
    const c = { id: "c1", name: "安倢", appearance: "紅傘", notes: "溫柔" };
    expect(formatCharacterAnchor([c], ["c1"])).toBe("外觀鎖定 安倢：紅傘");
    expect(formatCharacterKnowledgeBlock([c])).toContain("個性：溫柔");
  });
});

describe("orderRowsByIds / clipCardField", () => {
  it("順序與截短", () => {
    expect(orderRowsByIds([S_RAIN, S_ZEN], ["s1", "s2"])).toEqual([S_ZEN, S_RAIN]);
    expect(clipCardField("  a\n\nb  ")).toBe("a b");
  });
});

describe("pickFirstReference（卡片參考圖 → 生成來源）", () => {
  const rows = [
    { id: "c1", referenceAssetId: null },
    { id: "c2", referenceAssetId: "asset-2" },
    { id: "c3", referenceAssetId: "asset-3" },
  ];

  it("依勾選順序取第一張綁得到的圖（DB 回傳順序不算數）", () => {
    expect(pickFirstReference(rows, ["c3", "c2"])).toBe("asset-3");
    expect(pickFirstReference(rows, ["c2", "c3"])).toBe("asset-2");
  });

  it("跳過沒綁圖的卡，而不是直接放棄", () => {
    expect(pickFirstReference(rows, ["c1", "c3"])).toBe("asset-3");
  });

  it("都沒綁圖時回 null（呼叫端才好退回原本的「請挑來源」訊息）", () => {
    expect(pickFirstReference([{ id: "c1", referenceAssetId: null }], ["c1"])).toBeNull();
    expect(pickFirstReference(rows, [])).toBeNull();
    // 勾了不存在的卡（stale 畫面）也不能爆
    expect(pickFirstReference(rows, ["ghost"])).toBeNull();
  });
});

const P_UMBRELLA = { id: "p1", name: "紅傘", appearance: "正紅長柄傘、霧面傘布、木質握把", notes: "安倢每次出場都帶著" };
const P_BEADS = { id: "p2", name: "佛珠", appearance: "深褐木珠、108 顆", notes: null as string | null };

describe("formatPropAnchor（視覺生成・素材設定）", () => {
  it("依選取順序串接外觀，備註不進畫面", () => {
    expect(formatPropAnchor([P_UMBRELLA, P_BEADS], ["p2", "p1"])).toBe(
      "材質鎖定 佛珠：深褐木珠、108 顆；材質鎖定 紅傘：正紅長柄傘、霧面傘布、木質握把",
    );
  });

  it("外觀超過上限被截短（不加省略號，避免被畫成文字）", () => {
    const long = { id: "p3", name: "長傘", appearance: "傘".repeat(CARD_FIELD_MAX + 40) };
    const out = formatPropAnchor([long], ["p3"]);
    expect(out).toBe(`材質鎖定 長傘：${"傘".repeat(CARD_FIELD_MAX)}`);
    expect(out).not.toContain("…");
  });

  it("沒勾任何素材時回空字串（呼叫端據此不注入 [素材設定] 段）", () => {
    expect(formatPropAnchor([P_UMBRELLA], [])).toBe("");
    expect(formatPropAnchor([], ["p1"])).toBe("");
  });
});

describe("formatPropKnowledgeBlock（知識庫／導演・素材設定卡）", () => {
  it("含用途備註；沒有備註就只有外觀", () => {
    expect(formatPropKnowledgeBlock([P_UMBRELLA, P_BEADS])).toBe(
      "【素材設定卡】\n" +
        "- 紅傘：正紅長柄傘、霧面傘布、木質握把｜用途：安倢每次出場都帶著\n" +
        "- 佛珠：深褐木珠、108 顆",
    );
  });

  it("超過注入張數上限只列前 N 張並標註其餘", () => {
    const many = Array.from({ length: PROP_KNOWLEDGE_INJECT_MAX + 3 }, (_, i) => ({
      id: `p${i}`,
      name: `道具${i}`,
      appearance: "外觀",
    }));
    const out = formatPropKnowledgeBlock(many);
    expect(out.split("\n- ")).toHaveLength(PROP_KNOWLEDGE_INJECT_MAX + 1);
    expect(out).toContain("…另有 3 張素材卡未注入");
  });

  it("沒有素材卡時回空字串（不塞空標題進知識預算）", () => {
    expect(formatPropKnowledgeBlock([])).toBe("");
  });
});
