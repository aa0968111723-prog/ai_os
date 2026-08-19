import type { IconName } from "../components/Icon";
import { PHONE_STAGES } from "@shared/phoneStages";
// 錨點的單一出處：桌面 hash 路由（sectionFromHash）也是讀這一份
import { STORY_INLINE_SECTIONS, isStoryHomeHash } from "../features/story-workspace/storyInlineNav";

/**
 * 手機版的五段製作階段：故事 → 分鏡 → 視覺 → 生成 → 交付。
 *
 * 桌面版的進度用 `components/ProgressStepper` 的五步（靈感／腳本／分鏡／生成／發布），
 * 那是一條 SVG 節點軌道，360px 寬放不下也讀不清。手機這條是同一件事的另一種呈現：
 * 五個純文字格子、目前那格加深，一眼看得出「做到哪裡」。
 *
 * 階段字面值直接取自 `@shared/phoneStages`——伺服器推導用的是同一份，
 * 兩邊各寫一組字的話，伺服器推的階段會對不上畫面上亮起來的格子（而且不會報錯）。
 */
export const MOBILE_STAGES = [
  { id: "story", label: "故事", icon: "FileText" },
  { id: "storyboard", label: "分鏡", icon: "Clapperboard" },
  { id: "visual", label: "視覺", icon: "Image" },
  { id: "generate", label: "生成", icon: "Sparkles" },
  { id: "deliver", label: "交付", icon: "Package" },
] as const satisfies ReadonlyArray<{ id: string; label: string; icon: IconName }>;

export type MobileStageId = (typeof MOBILE_STAGES)[number]["id"];

export function stageIndex(stage: string): number {
  const at = MOBILE_STAGES.findIndex((s) => s.id === stage);
  return at < 0 ? 0 : at;
}

export function stageLabel(stage: string): string {
  return MOBILE_STAGES[stageIndex(stage)].label;
}

/**
 * 「目前做到哪裡」的一句話。首屏最重要的一行字——使用者打開 App 想知道的
 * 就是這個，而不是一張專案卡的封面色塊。
 */
export function stageSentence(input: {
  stage: string;
  shots: number;
  shotsWithVisual: number;
  awaitingGenerations: number;
}): string {
  if (input.awaitingGenerations > 0) return `${input.awaitingGenerations} 筆生成等你裁決`;
  switch (input.stage) {
    case "story":
      return "還沒有故事——先把想法寫下來";
    case "storyboard":
      return input.shots > 0 ? `分鏡 ${input.shots} 鏡，還在排` : "故事有了，接下來拆分鏡";
    case "visual":
      return `${input.shots} 鏡都還沒有畫面`;
    case "generate":
      return `畫面 ${input.shotsWithVisual}／${input.shots} 鏡`;
    case "deliver":
      return input.shots > 0 ? `${input.shots} 鏡都有畫面了，可以收尾` : "可以收尾了";
    default:
      return "";
  }
}

/**
 * 專案頁「故事本體」的錨點。
 *
 * 它不在 `STORY_INLINE_SECTIONS` 裡——故事是主表面，不是可收合的區段
 *（見 storyInlineNav.ts 的 `STORY_HOME_ALIASES`），所以只能寫死這一個。
 */
const STORY_HOME_ANCHOR = "stage-story";

/** section id → 真正渲染在 DOM 上的 anchorId（storyboard→stage-board、production→stage-create） */
const ANCHOR_BY_SECTION = new Map<string, string>(STORY_INLINE_SECTIONS.map((s) => [s.id, s.anchorId]));

/**
 * 「繼續製作」要跳到哪一段。
 *
 * 回傳的是**真正渲染在 DOM 上的 anchorId**，不是 section id。這兩者不一樣，
 * 而且踩過：`storyboard` 是 section id，它的 anchorId 其實是 `stage-board`。
 * 直接把 section id 當錨點用的話，`document.getElementById()` 永遠找不到元素——
 * 症狀是「繼續製作」把工作台打開了，但停在頁面最上方沒有捲到那一段，
 * 而且完全不會報錯（呼叫端輪詢三秒後靜靜放棄）。
 *
 * 所以這裡從 `STORY_INLINE_SECTIONS` 推導，不自己寫字串——那份清單同時是
 * 桌面版 hash 路由（`sectionFromHash`）的來源，兩邊因此不可能再對不上。
 */
export function continueAnchor(stage: string): string {
  switch (stage) {
    case "story":
      return STORY_HOME_ANCHOR;
    case "storyboard":
      return ANCHOR_BY_SECTION.get("storyboard") ?? STORY_HOME_ANCHOR;
    default:
      return ANCHOR_BY_SECTION.get("production") ?? STORY_HOME_ANCHOR;
  }
}

/**
 * 某個 section 在專案頁實際渲染的錨點 id。
 *
 * 次級入口（分鏡／角色／場景）要跳的段落用這個取，不要直接把 section id 當錨點——
 * 那正是 `continueAnchor` 上面那段記載的坑。
 */
export function anchorForSection(section: string): string {
  return ANCHOR_BY_SECTION.get(section) ?? STORY_HOME_ANCHOR;
}

/** 這個 hash 是不是專案頁認得的錨點（深連結進來時用來判斷要不要直接開工作台） */
export function isProjectAnchor(hash: string): boolean {
  const id = hash.replace(/^#/, "").trim();
  if (!id) return false;
  return id === STORY_HOME_ANCHOR || [...ANCHOR_BY_SECTION.values()].includes(id);
}

/**
 * Auto-open the desktop workbench only for a *section* deep link.
 *
 * `#stage-story` is the desktop home hash (`writeInlineHash(null)`). Treating
 * it as a deep link remounts MobileProjectPage at ≤767.98 and immediately
 * loads the 234KB workbench — at ~600px that page left-clips under
 * `html/body { overflow-x: clip }` instead of staying on the mobile shell.
 * Explicit 「開始寫故事」 still calls `openFull("stage-story")`.
 */
export function isAutoOpenProjectAnchor(hash: string): boolean {
  const id = hash.replace(/^#/, "").trim();
  if (!id) return false;
  if (isStoryHomeHash(`#${id}`)) return false;
  return isProjectAnchor(id);
}

/** 「繼續製作」按鈕上的字：按鈕要講出它會做什麼，不是講一個泛稱 */
export function continueLabel(stage: string): string {
  switch (stage) {
    case "story":
      return "開始寫故事";
    case "storyboard":
      return "繼續排分鏡";
    case "visual":
      return "開始做畫面";
    case "generate":
      return "繼續生成";
    default:
      return "繼續製作";
  }
}
