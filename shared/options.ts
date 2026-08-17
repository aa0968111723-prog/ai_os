/**
 * 每組自訂選項（R23）——單一真相：型別、預設種子、回饋分類與頁面表。
 * 預設種子由現有寫死常數衍生，首次讀取某組某類型時 lazy-seed 進 group_options，之後由組長自行增修。
 */
import { PROJECT_KINDS, PLATFORMS, PROJECT_FORMAT_IDS, pixelsForFormat, type ProjectFormat } from "./models";
import { TONE_OPTIONS, THEME_OPTIONS, STYLE_OPTIONS } from "./worldview";

export type OptionType = "kind" | "platform" | "tone" | "theme" | "style";
export const OPTION_TYPES: OptionType[] = ["kind", "platform", "tone", "theme", "style"];

/** 各選項類型的中文抬頭與說明（編輯器與挑選處共用） */
export const OPTION_TYPE_META: Record<OptionType, { label: string; hint: string; hasFormat: boolean }> = {
  kind: { label: "內容類型", hint: "建專案時選的類型（見證故事、開示剪輯…）", hasFormat: false },
  platform: { label: "發布平台", hint: "含畫面比例；生成時自動帶入", hasFormat: true },
  tone: { label: "調性", hint: "世界觀的語氣（莊嚴、溫暖…）；會注入生成", hasFormat: false },
  theme: { label: "主軸 / 敘事弧", hint: "故事走向（苦→修行→轉變→感恩…）；會注入生成", hasFormat: false },
  style: {
    label: "視覺風格",
    hint: "媒材家族＋主風格（可選質感）；會注入生成",
    hasFormat: false,
  },
};

/**
 * 發布平台合法比例＝模型吃得下的全部比例（見 shared/models 的 PROJECT_FORMATS）。
 * 原本只開 16:9／9:16／1:1，等於把 21:9、4:3、3:2、2:3… 這些模型本來就支援的尺寸鎖在門外。
 */
export const PLATFORM_FORMATS: ProjectFormat[] = PROJECT_FORMAT_IDS;

/**
 * 專案畫面比例 → 交付時間軸／草稿的像素解析度（短邊 1080）。
 * FCPXML／Premiere XML／剪映草稿共用此單一來源，避免各處硬編橫向 1920×1080——
 * 否則 9:16 直式、1:1 方形專案匯入剪輯軟體會建成橫向序列、素材被裝進錯比例框（見審計 jianying/fcpxml 兩項）。
 * 實際表格在 shared/models（比例選單與生成端共用同一份），這裡只轉呼叫、保留既有匯入路徑。
 */
export function resolutionForFormat(format: string | null | undefined): { width: number; height: number } {
  return pixelsForFormat(format);
}

/** 一筆選項（前後端共用；來自 DB group_options 的投影） */
export interface GroupOption {
  id: string;
  type: OptionType;
  value: string;
  label: string;
  format: string | null;
  sortOrder: number;
  active: boolean;
}

/** 預設種子（不含 id/groupId，seed 時補齊） */
export interface DefaultOption {
  type: OptionType;
  value: string;
  label: string;
  format?: ProjectFormat;
}

export const DEFAULT_GROUP_OPTIONS: DefaultOption[] = [
  ...PROJECT_KINDS.map((k) => ({ type: "kind" as const, value: k.id, label: k.label })),
  ...PLATFORMS.map((p) => ({ type: "platform" as const, value: p.id, label: p.label, format: p.format })),
  ...TONE_OPTIONS.map((t) => ({ type: "tone" as const, value: t, label: t })),
  ...THEME_OPTIONS.map((t) => ({ type: "theme" as const, value: t, label: t })),
  ...STYLE_OPTIONS.map((s) => ({ type: "style" as const, value: s, label: s })),
];

export function defaultsFor(type: OptionType): DefaultOption[] {
  return DEFAULT_GROUP_OPTIONS.filter((o) => o.type === type);
}

/* ── 元件級回饋（R23）──────────────────────────── */

/**
 * 回饋選項表已搬到 ./feedbackOptions —— 它們不依賴模型目錄與世界觀，
 * 住在這裡會讓「只要一張分類表」的呼叫端（例如全站常駐的回饋浮標）
 * 連帶下載 shared/models 與 shared/worldview。這裡 re-export，呼叫端不受影響。
 */
export {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_VALUES,
  FEEDBACK_PAGES,
  FEEDBACK_STATUS_LABEL,
  type FeedbackCategory,
} from "./feedbackOptions";
