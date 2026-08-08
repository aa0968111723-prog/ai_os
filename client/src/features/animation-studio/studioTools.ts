/**
 * 工具列的定義（純函式，可測）。
 *
 * 專業繪圖工具的左欄是「工具」不是「筆刷清單」：選了工具，二級設定才跟著換
 * （Contextual Tool Options）。先前把六種筆刷永久攤在左欄，於是「換筆」與
 * 「換工作方式」看起來是同一件事，而真正的工作方式（導覽／描圖／AI）反而沒有位置。
 *
 * **只列真的做得到的工具。** 文字、圖形、標註需要 boardDoc 支援新的圖元型別
 * （見 boardDoc.ts 的 Stroke），在那之前放上去只會是點了沒反應的按鈕——
 * 假工具比少一個工具更傷專業感。規劃中的項目由 PLANNED_TOOLS 單獨呈現並停用。
 */
import type { IconName } from "../../components/Icon";

export type StudioTool = "select" | "draw" | "eraser" | "reference" | "ai";

export interface StudioToolSpec {
  id: StudioTool;
  label: string;
  icon: IconName;
  /** 單鍵快捷鍵（顯示用；實際對照表在 studioShortcuts.ts） */
  hint: string;
  /** 一句話說明，進 tooltip 第二行 */
  detail: string;
}

/**
 * 工具順序＝使用頻率由高到低（Figma／Resolve 都是這個排法）：
 * 導覽在最上（隨時要回到「不會畫壞東西」的狀態），AI 在最下（它是協作者不是筆）。
 */
export const STUDIO_TOOLS: readonly StudioToolSpec[] = [
  { id: "select", label: "選取／移動", icon: "MousePointer2", hint: "V", detail: "拖曳平移畫布、滾輪縮放" },
  { id: "draw", label: "畫筆", icon: "PenTool", hint: "B", detail: "手繪線條；下方可換筆與調粗細" },
  { id: "eraser", label: "橡皮擦", icon: "Eraser", hint: "E", detail: "擦掉畫過的筆畫" },
  { id: "reference", label: "描圖底稿", icon: "Layers", hint: "I", detail: "把這一鏡現有的畫面墊在底下描" },
  { id: "ai", label: "AI 協作", icon: "Sparkles", hint: "A", detail: "讓 AI 依描述在白板上構圖" },
];

/** 需要 boardDoc 支援新圖元才能做的工具：列出來讓資訊架構完整，但明確停用不假裝 */
export const PLANNED_TOOLS: ReadonlyArray<{ label: string; icon: IconName }> = [
  { label: "文字", icon: "Pencil" },
  { label: "圖形", icon: "Square" },
  { label: "標註", icon: "MessageCircle" },
];

/**
 * 工具 → 二級設定面板要顯示什麼。
 * "brush"＝筆刷櫃（含橡皮擦，它就是一支筆）；"reference"＝底稿開關；
 * "ai"＝AI 動作捷徑；null＝這個工具沒有二級設定，左欄就只有一條窄軌。
 */
export type ToolOptionsKind = "brush" | "reference" | "ai" | null;

export function optionsKindFor(tool: StudioTool): ToolOptionsKind {
  switch (tool) {
    case "draw":
    case "eraser":
      return "brush";
    case "reference":
      return "reference";
    case "ai":
      return "ai";
    case "select":
    default:
      return null;
  }
}

/** 選了工具之後，白板該進入哪一種指標模式（餵給 WhiteboardCanvas 的 panMode／筆刷） */
export function panModeFor(tool: StudioTool): boolean {
  return tool === "select";
}

/**
 * 工具切換要不要換筆刷？換到橡皮擦要選內建橡皮擦，換回畫筆要回到上一支筆。
 * 回傳 null＝不動筆刷（導覽／底稿／AI 都不該把使用者的筆換掉）。
 */
export function brushIdFor(tool: StudioTool, lastDrawBrushId: string): string | null {
  if (tool === "eraser") return "builtin.eraser";
  if (tool === "draw") return lastDrawBrushId;
  return null;
}

/** 由目前的筆刷反推工具（載入時、或快捷鍵直接換筆時要讓左欄跟著亮） */
export function toolForBrushId(brushId: string): StudioTool {
  return brushId === "builtin.eraser" ? "eraser" : "draw";
}

/* ── 畫面輔助線（Frame Guides）───────────────────────────
 * 分鏡是給拍片用的，不是自由畫布：安全區、三分法、中心線是「這一格能不能用」
 * 的判準。做成可個別開關的集合而不是單一開關——不同階段看的線不一樣。 */

export type GuideKey = "safe" | "thirds" | "center" | "grid";

export interface GuideSpec {
  key: GuideKey;
  label: string;
  detail: string;
}

export const FRAME_GUIDES: readonly GuideSpec[] = [
  { key: "safe", label: "安全區", detail: "字幕與重要主體不要超出這一框" },
  { key: "thirds", label: "三分法", detail: "主體放在交點上比較穩" },
  { key: "center", label: "中心線", detail: "對稱構圖與水平校正" },
  { key: "grid", label: "格線", detail: "細格線，抓比例用" },
];

export type GuideState = Record<GuideKey, boolean>;

/** 預設只開安全區：一次全開會讓白板看起來像方格紙，反而看不到自己畫的東西 */
export const DEFAULT_GUIDES: GuideState = { safe: true, thirds: false, center: false, grid: false };

export function toggleGuide(state: GuideState, key: GuideKey): GuideState {
  return { ...state, [key]: !state[key] };
}

/**
 * 安全區比例（相對畫面邊長）。用電視／串流通用的 title-safe 90%、action-safe 93%——
 * 這兩個數字是產業慣例，不是隨手挑的美感值。
 */
export const SAFE_AREA = { title: 0.9, action: 0.93 } as const;

/* ── 面板收合（P2：空間不足時的降級）──────────────────── */

export interface StudioPanels {
  /** 右側 Inspector 收合（畫布優先） */
  inspector: boolean;
  /** 底部 Timeline 收合 */
  timeline: boolean;
}

export const DEFAULT_PANELS: StudioPanels = { inspector: false, timeline: false };

/** Timeline 高度（px）的合理範圍：低於這個看不到縮圖，高於這個畫布不夠用 */
export const TIMELINE_HEIGHT = { min: 96, max: 260, default: 140 } as const;

export function clampTimelineHeight(px: number): number {
  if (!Number.isFinite(px)) return TIMELINE_HEIGHT.default;
  return Math.min(TIMELINE_HEIGHT.max, Math.max(TIMELINE_HEIGHT.min, Math.round(px)));
}
