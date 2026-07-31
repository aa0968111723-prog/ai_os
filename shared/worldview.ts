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

/**
 * AI 消費端格式模式（單一真相，避免 agent/director/assistant 各寫一行摘要而分岔）：
 * - brief：單行摘要（代理規劃／專案助手／留言助手）
 * - director：導演建議與拆分鏡（含觀眾、三幕、敘事人物）
 * - export：交付鏡頭表人話段落
 * - generation-llm：生成台 LLM 正向附加（themes 進敘事；logline 截斷）
 */
export type WorldviewFormatMode = "brief" | "director" | "export" | "generation-llm";

/** 視覺生成注入 logline 上限（全長塞每鏡會爆 token；截斷後加省略） */
export const LOGLINE_INJECT_MAX = 80;

/** 三幕有任一欄非空才算「已設」 */
export function hasActs(wv: Pick<Worldview, "acts">): boolean {
  const a = wv.acts;
  return !!(a.hook.trim() || a.turn.trim() || a.cta.trim());
}

/**
 * 基調就緒：一句話或關鍵訊息，且至少一項調性或視覺風格。
 * 只用 logline/message 會顯示「✓」卻沒有可注入畫風——摘要條與 onboarding 共用此判定。
 */
export function isWorldviewReady(wv: Pick<Worldview, "logline" | "message" | "tones" | "styles">): boolean {
  const narrative = !!(wv.logline.trim() || wv.message.trim());
  const style = wv.tones.length > 0 || wv.styles.length > 0;
  return narrative && style;
}

/** 三幕結構單行（空欄省略） */
export function formatActsLine(acts: Worldview["acts"]): string {
  const parts: string[] = [];
  if (acts.hook.trim()) parts.push(`鉤子：${acts.hook.trim()}`);
  if (acts.turn.trim()) parts.push(`轉折：${acts.turn.trim()}`);
  if (acts.cta.trim()) parts.push(`行動呼籲：${acts.cta.trim()}`);
  return parts.join(" → ");
}

/**
 * 世界觀 → AI／交付用文字（前後端共用）。
 * references 刻意不進模型（URL 對擴散／LLM 敘事弱、且易膨脹）；僅 export 可列備註。
 */
export function formatWorldviewForAi(wv: Worldview, mode: WorldviewFormatMode): string {
  if (mode === "export") return formatWorldviewExport(wv);
  if (mode === "director") return formatWorldviewDirector(wv);
  if (mode === "generation-llm") return formatWorldviewGenerationLlm(wv);
  return formatWorldviewBrief(wv);
}

function joinPipe(parts: string[]): string {
  return parts.filter(Boolean).join("｜");
}

/** 代理／助手：必含 message 與 taboos，避免規劃偏離一片一訊息或合規 */
function formatWorldviewBrief(wv: Worldview): string {
  return joinPipe([
    `一句話：${wv.logline.trim() || "—"}`,
    `核心訊息：${wv.message.trim() || "—"}`,
    wv.themes.length ? `訊息主軸：${wv.themes.join("、")}` : "",
    `調性：${wv.tones.join("、") || "—"}`,
    `視覺風格：${wv.styles.join("、") || "—"}`,
    wv.taboos.length ? `禁忌：${wv.taboos.join("；")}` : "",
  ]);
}

/** 導演建議／拆分鏡：敘事決策完整上下文（含觀眾、三幕、敘事人物） */
function formatWorldviewDirector(wv: Worldview): string {
  const lines: string[] = [
    joinPipe([
      `一句話故事：${wv.logline.trim() || "—"}`,
      `關鍵訊息：${wv.message.trim() || "—"}`,
      wv.audience.trim() ? `目標觀眾：${wv.audience.trim()}` : "",
      wv.themes.length ? `訊息主軸（敘事弧）：${wv.themes.join("、")}` : "",
      `調性：${wv.tones.join("、") || "—"}`,
      `視覺風格：${wv.styles.join("、") || "—"}`,
    ]),
  ];
  const acts = formatActsLine(wv.acts);
  if (acts) lines.push(`三幕結構：${acts}`);
  if (wv.people.length) {
    lines.push(
      `敘事人物（非畫面定裝；畫面一致請用角色卡）：${wv.people.join("；")}`,
    );
  }
  if (wv.taboos.length) lines.push(`禁忌：${wv.taboos.join("；")}`);
  return lines.join("\n");
}

/** LLM 生成附加片段（接在 [專案背景] 內；themes 只對文字模型有意義） */
function formatWorldviewGenerationLlm(wv: Worldview): string {
  const parts: string[] = [];
  const log = wv.logline.trim();
  if (log) {
    const clipped = log.length > LOGLINE_INJECT_MAX ? `${log.slice(0, LOGLINE_INJECT_MAX)}…` : log;
    parts.push(`故事錨點:${clipped}`);
  }
  if (wv.tones.length) parts.push(`調性:${wv.tones.join("、")}`);
  if (wv.styles.length) parts.push(`視覺風格:${wv.styles.join("、")}`);
  if (wv.message.trim()) parts.push(`核心訊息:${wv.message.trim()}`);
  if (wv.themes.length) parts.push(`訊息主軸:${wv.themes.join("、")}`);
  if (wv.taboos.length) parts.push(`避免:${wv.taboos.join(";")}`);
  return parts.join("|");
}

/** 交付鏡頭表：人話 bullet，含風格／主軸／三幕／人物 */
function formatWorldviewExport(wv: Worldview): string {
  const lines = [
    `- 一句話故事：${wv.logline.trim() || "—"}`,
    `- 關鍵訊息：${wv.message.trim() || "—"}`,
    `- 調性：${wv.tones.join("、") || "—"}`,
    `- 視覺風格：${wv.styles.join("、") || "—"}`,
  ];
  if (wv.themes.length) lines.push(`- 訊息主軸：${wv.themes.join("、")}`);
  if (wv.audience.trim()) lines.push(`- 目標觀眾：${wv.audience.trim()}`);
  const acts = formatActsLine(wv.acts);
  if (acts) lines.push(`- 三幕結構：${acts}`);
  if (wv.people.length) lines.push(`- 敘事人物：${wv.people.join("；")}`);
  lines.push(`- 禁忌事項：${wv.taboos.join("；") || "—"}`);
  if (wv.references.length) lines.push(`- 參考連結（備註）：${wv.references.join("；")}`);
  return lines.join("\n");
}

/**
 * 視覺類別正向注入片段（中英雙語 tones/styles + 短 logline + message）。
 * 禁忌不放正向——由 generationCore 走 negative_prompt。
 */
export function formatWorldviewVisualPositive(wv: Worldview): string {
  const parts: string[] = [];
  const tones = bilingualChips(wv.tones, TONE_EN);
  const styles = bilingualChips(wv.styles, STYLE_EN);
  if (tones.length) parts.push(`調性:${tones.join("、")}`);
  if (styles.length) parts.push(`視覺風格:${styles.join("、")}`);
  const log = wv.logline.trim();
  if (log) {
    const clipped = log.length > LOGLINE_INJECT_MAX ? `${log.slice(0, LOGLINE_INJECT_MAX)}…` : log;
    parts.push(`故事錨點:${clipped}`);
  }
  if (wv.message.trim()) parts.push(`核心訊息:${wv.message.trim()}`);
  return parts.join("|");
}

/** 是否正要移除預設弘法禁語（清空或刪掉 DEFAULT 其中一條）——UI 確認用 */
export function removesDefaultTaboos(prev: string[], next: string[]): boolean {
  const defaults = DEFAULT_TABOOS();
  const nextSet = new Set(next);
  return defaults.some((d) => prev.includes(d) && !nextSet.has(d));
}
