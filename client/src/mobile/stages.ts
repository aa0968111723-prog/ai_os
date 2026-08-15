import type { IconName } from "../components/Icon";
import { PHONE_STAGES } from "@shared/phoneStages";

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
 * 「繼續製作」要跳到哪一段。
 *
 * 專案頁的分段錨點是既有契約（桌面版的 `#story`／`#storyboard` 等區塊 id 沒變），
 * 手機沿用同一組——不另外發明一套網址，深連結與通知點進來仍落在同一個地方。
 */
export function continueAnchor(stage: string): string {
  switch (stage) {
    case "story":
      return "story";
    case "storyboard":
      return "storyboard";
    default:
      return "production";
  }
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
