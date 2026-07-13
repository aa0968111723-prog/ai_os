/**
 * 每組自訂選項（R23）——單一真相：型別、預設種子、回饋分類與頁面表。
 * 預設種子由現有寫死常數衍生，首次讀取某組某類型時 lazy-seed 進 group_options，之後由組長自行增修。
 */
import { PROJECT_KINDS, PLATFORMS, type ProjectFormat } from "./models";
import { TONE_OPTIONS, THEME_OPTIONS, STYLE_OPTIONS } from "./worldview";

export type OptionType = "kind" | "platform" | "tone" | "theme" | "style";
export const OPTION_TYPES: OptionType[] = ["kind", "platform", "tone", "theme", "style"];

/** 各選項類型的中文抬頭與說明（編輯器與挑選處共用） */
export const OPTION_TYPE_META: Record<OptionType, { label: string; hint: string; hasFormat: boolean }> = {
  kind: { label: "內容類型", hint: "建專案時選的類型（見證故事、開示剪輯…）", hasFormat: false },
  platform: { label: "發布平台", hint: "含畫面比例；生成時自動帶入", hasFormat: true },
  tone: { label: "調性", hint: "世界觀的語氣（莊嚴、溫暖…）；會注入生成", hasFormat: false },
  theme: { label: "主軸 / 敘事弧", hint: "故事走向（苦→修行→轉變→感恩…）；會注入生成", hasFormat: false },
  style: { label: "視覺風格", hint: "畫面風格（日系水彩、水墨禪意…）；會注入生成", hasFormat: false },
};

/** 發布平台合法比例（自訂 platform 時限這三種，生成台才對得上） */
export const PLATFORM_FORMATS: ProjectFormat[] = ["16:9", "9:16", "1:1"];

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

export const FEEDBACK_CATEGORIES = [
  { value: "bug", label: "問題／怪怪的", hint: "壞掉、報錯、跟預期不一樣" },
  { value: "uiux", label: "介面／操作", hint: "不好按、看不懂、位置怪、太小" },
  { value: "feature", label: "希望能有", hint: "想要的新功能或選項" },
  { value: "stuck", label: "卡關／不會用", hint: "找不到、不知道下一步" },
  { value: "other", label: "其他", hint: "" },
] as const;

export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]["value"];
export const FEEDBACK_CATEGORY_VALUES = FEEDBACK_CATEGORIES.map((c) => c.value) as [FeedbackCategory, ...FeedbackCategory[]];

/** 已知頁面代稱（複選涉及頁面用）；路由對應由前端維護，這裡只存人看得懂的名字 */
export const FEEDBACK_PAGES = [
  "登入／邀請",
  "作業台（首頁）",
  "專案頁",
  "團隊管理",
  "模型指南",
  "回饋頁",
] as const;

export const FEEDBACK_STATUS_LABEL: Record<string, string> = {
  open: "待看",
  reviewing: "處理中",
  done: "已處理",
};
