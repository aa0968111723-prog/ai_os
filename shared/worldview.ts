import { z } from "zod";

/**
 * 世界觀（專案定盤星）— 業界 brief 驗證過的分層設計：
 * 快速層 5 欄（1 分鐘填完）＋進階層（摺疊，可後補）。
 */
export const worldviewSchema = z.object({
  // 快速層
  logline: z.string().default(""), // 一句話故事
  message: z.string().default(""), // 一句關鍵訊息（一片一訊息）
  audience: z.string().default(""), // 目標觀眾
  themes: z.array(z.string()).default([]), // 訊息主軸（苦→修行→轉變→感恩…）
  tones: z.array(z.string()).default([]), // 調性 chips
  // 進階層（可後補）
  acts: z
    .object({ hook: z.string().default(""), turn: z.string().default(""), cta: z.string().default("") })
    .default({ hook: "", turn: "", cta: "" }),
  people: z.array(z.string()).default([]),
  styles: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]), // 參考影片連結
  taboos: z.array(z.string()).default(DEFAULT_TABOOS()), // 禁忌事項（含預設禁語）
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
