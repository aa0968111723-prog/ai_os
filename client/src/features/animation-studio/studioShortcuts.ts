/**
 * 鍵盤快捷鍵對照（純函式）。
 *
 * 專業繪圖工具的手不會離開畫布——換筆、調粗細、復原、全螢幕都在鍵盤上。
 * 沒有快捷鍵時每一個動作都要「看一眼工具列 → 移過去 → 點」，那是三個動作的成本。
 *
 * 抽成純函式的理由跟筆跡數學一樣：對照表寫在 keydown 處理器裡就測不到，
 * 而「在輸入框裡打字時不能觸發快捷鍵」這種事一旦壞掉，使用者會在提示詞裡
 * 打一個 e 就整支筆變成橡皮擦——災情大又難重現。
 */

export type StudioAction =
  | "undo"
  | "redo"
  | "toggleImmersive"
  | "exitImmersive"
  | "brushBigger"
  | "brushSmaller"
  | "eraser"
  | "brush"
  | "pan"
  | "fit"
  | "zoomIn"
  | "zoomOut";

export interface ShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  /** 事件來源；用來判斷「正在輸入框裡打字」 */
  target?: EventTarget | null;
}

/**
 * 焦點在可輸入的東西上時，所有快捷鍵一律讓路。
 * 涵蓋 input／textarea／select／contenteditable——少判一種就是一種災情。
 */
export function isTypingTarget(target: EventTarget | null | undefined): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el !== "object" || !("tagName" in el)) return false;
  const tag = String(el.tagName).toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return el.isContentEditable === true;
}

/**
 * 事件 → 動作；不對應任何動作時回 null（呼叫端就不要 preventDefault）。
 *
 * 修飾鍵的規則刻意保守：只有復原／重做吃 Ctrl／⌘，其餘單鍵動作在按著
 * Ctrl／⌘／Alt 時一律不觸發——否則會搶走瀏覽器與作業系統的快捷鍵。
 */
export function resolveShortcut(event: ShortcutEvent): StudioAction | null {
  if (isTypingTarget(event.target)) return null;
  const key = event.key;
  const mod = !!event.ctrlKey || !!event.metaKey;

  // 復原／重做：Ctrl/⌘+Z、Ctrl/⌘+Shift+Z、Ctrl+Y（Windows 慣例）
  if (mod && (key === "z" || key === "Z")) return event.shiftKey ? "redo" : "undo";
  if (mod && (key === "y" || key === "Y")) return "redo";
  if (mod || event.altKey) return null;

  // Esc 只用來離開全螢幕（原生 Fullscreen API 自己也會處理，這裡管 CSS 沉浸模式）
  if (key === "Escape") return "exitImmersive";

  switch (key) {
    case "f":
    case "F":
      return "toggleImmersive";
    case "[":
      return "brushSmaller";
    case "]":
      return "brushBigger";
    case "e":
    case "E":
      return "eraser";
    case "b":
    case "B":
      return "brush";
    case "h":
    case "H":
      return "pan";
    case "0":
      return "fit";
    case "=":
    case "+":
      return "zoomIn";
    case "-":
    case "_":
      return "zoomOut";
    default:
      return null;
  }
}

/** 顯示用的快捷鍵說明（工具列 title／說明面板共用同一份，不各寫一次） */
export const SHORTCUT_HINTS: Record<string, string> = {
  undo: "Ctrl/⌘ + Z",
  redo: "Ctrl/⌘ + Shift + Z",
  toggleImmersive: "F",
  brushSmaller: "[",
  brushBigger: "]",
  eraser: "E",
  brush: "B",
  pan: "H",
  fit: "0",
  zoomIn: "+",
  zoomOut: "−",
};
