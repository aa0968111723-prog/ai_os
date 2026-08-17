/**
 * 元件級回饋（R23）的選項表：分類、涉及頁面、狀態字。
 *
 * ## 為什麼從 shared/options.ts 拆出來
 *
 * 這幾張表跟選項系統其實毫無關係——它們不需要 `PROJECT_KINDS`、`PLATFORMS`，
 * 也不需要世界觀的 `TONE_OPTIONS`。但只要跟它們住在同一個檔案，任何 import
 * 就會把 `shared/models`（145KB）與 `shared/worldview`（43KB）一起拖進來。
 *
 * 實測後果：登入後全站常駐的回饋浮標（FeedbackWidget）只用了這裡的兩張表，
 * 卻讓每一支手機都下載整份模型目錄 ＋ 整份世界觀選項——約 190KB 原始碼，
 * 只為了畫一顆右下角的小按鈕。
 *
 * shared/options.ts 仍原樣 re-export，既有 import 一行都不用改。
 */

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

