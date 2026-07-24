import { z } from "zod";

/**
 * 世界觀（專案定盤星）— 業界 brief 驗證過的分層設計：
 * 快速層 5 欄（1 分鐘填完）＋進階層（摺疊，可後補）。
 */
// 上限：字串欄位單值 500 字、陣列最多 30 項且逐項 100 字——世界觀整份會注入付費 LLM，無上限＝可被塞爆與注入
export const worldviewSchema = z.object({
  // 快速層
  logline: z.string().max(500).default(""), // 一句話故事
  message: z.string().max(500).default(""), // 一句關鍵訊息（一片一訊息）
  audience: z.string().max(500).default(""), // 目標觀眾
  themes: z.array(z.string().max(100)).max(30).default([]), // 訊息主軸（苦→修行→轉變→感恩…）
  tones: z.array(z.string().max(100)).max(30).default([]), // 調性 chips
  // 進階層（可後補）
  acts: z
    .object({
      hook: z.string().max(500).default(""),
      turn: z.string().max(500).default(""),
      cta: z.string().max(500).default(""),
    })
    .default({ hook: "", turn: "", cta: "" }),
  people: z.array(z.string().max(100)).max(30).default([]),
  styles: z.array(z.string().max(100)).max(30).default([]),
  references: z.array(z.string().max(100)).max(30).default([]), // 參考影片連結
  taboos: z.array(z.string().max(100)).max(30).default(DEFAULT_TABOOS()), // 禁忌事項（含預設禁語）
});

export type Worldview = z.infer<typeof worldviewSchema>;

/** 預設禁語：醫療宣稱風險（盲點掃描 #4 定案） */
export function DEFAULT_TABOOS(): string[] {
  return ["不得使用「治癒/治療/療效」等醫療宣稱字眼", "不影射真實人物形象", "引用開示僅供建議，須組長審核後才可使用"];
}

export const TONE_OPTIONS = ["莊嚴", "溫暖", "真誠", "療癒", "活潑", "簡約"];
export const THEME_OPTIONS = ["苦→修行→轉變→感恩", "禪修日常", "佛法入門", "活動紀實", "感恩分享"];
/** 視覺風格：注入每次圖像/影片生成與 AI 導演建議，維持整支片畫風一致 */
export const STYLE_OPTIONS = ["日系水彩", "寫實攝影", "3D 動畫", "手繪插畫", "極簡線條", "膠片質感", "水墨禪意"];

/**
 * 內建 chips 的英文錨點：FLUX/SDXL 等圖像影片模型以英文語彙訓練為主，純中文風格詞
 * 常被當雜訊忽略——視覺類別注入時附上英文對應，畫風才真正錨得住。
 * 只映射內建選項；組長自訂的 chips 沒有對應就維持原文注入（不猜翻譯）。
 */
export const STYLE_EN: Record<string, string> = {
  "日系水彩": "Japanese watercolor illustration",
  "寫實攝影": "photorealistic photography",
  "3D 動畫": "3D animated render",
  "手繪插畫": "hand-drawn illustration",
  "極簡線條": "minimalist line art",
  "膠片質感": "analog film grain",
  "水墨禪意": "Chinese ink wash painting, zen minimalism",
};
export const TONE_EN: Record<string, string> = {
  "莊嚴": "solemn, majestic",
  "溫暖": "warm, gentle",
  "真誠": "sincere, heartfelt",
  "療癒": "soothing, healing",
  "活潑": "lively, vibrant",
  "簡約": "clean, minimal",
};

/** 把 chips 轉成「中文(英文)」雙語注入形；無對應者原樣保留 */
export function bilingualChips(values: string[], map: Record<string, string>): string[] {
  return values.map((v) => (map[v] ? `${v}(${map[v]})` : v));
}
