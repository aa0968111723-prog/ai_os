/**
 * Place the 動畫創作室 timeline shot menu in the viewport.
 *
 * Live 10:08: height is NOT the cause. Box is 1280×800 hard cap; tester
 * zoomed to 50% (CSS ~2560×1320, taller than the old 1600 repro) and ⋯
 * on 第6鏡 still painted a giant unlabeled cream ellipse. That surface
 * is the #790 full-viewport scrim <button>: global `button` is cream
 * (`--card`) + `border-radius: 999px` + `inset: 0`. Zoom only makes
 * the pill bigger. Portal must paint a *small* menu; 複製's box stays
 * on-screen. Never stretch via `bottom: 100%` / `inset: 0` / scale.
 */
export const LAPTOP_VIEWPORT = { vw: 1280, vh: 800 } as const;
/** Chrome 50% zoom of a 1280×800 box — live 10:08 repro. */
export const ZOOMED_TALL_VIEWPORT = { vw: 2560, vh: 1320 } as const;
export const SHOT_MENU_MAX = { w: 240, h: 240 } as const;

export function viewportCssSize(): { vw: number; vh: number } {
  if (typeof window === "undefined") return { ...LAPTOP_VIEWPORT };
  const vis = window.visualViewport;
  return {
    vw: vis?.width ?? window.innerWidth,
    vh: vis?.height ?? window.innerHeight,
  };
}

export function placeFixedShotMenu(input: {
  trigger: { top: number; left: number; bottom: number; right?: number } | null;
  menuH: number;
  menuW: number;
  vw: number;
  vh: number;
  gap?: number;
}): { top: number; left: number } {
  const gap = input.gap ?? 4;
  const menuH = Math.min(Math.max(input.menuH, 1), SHOT_MENU_MAX.h, input.vh - 16);
  const menuW = Math.min(Math.max(input.menuW, 1), SHOT_MENU_MAX.w, input.vw - 16);
  const { vw, vh } = input;
  if (!input.trigger) {
    return { top: Math.max(8, vh - menuH - 8), left: 8 };
  }
  const rect = input.trigger;
  const above = rect.top - gap - menuH;
  const below = rect.bottom + gap;
  const top = above >= 8 ? above : Math.min(below, Math.max(8, vh - menuH - 8));
  let left = rect.left;
  if (left + menuW > vw - 8) left = vw - menuW - 8;
  if (left < 8) left = 8;
  return { top, left };
}

/** Inline style that cannot become inset:0 / 999px / scaled full-viewport. */
export function fixedShotMenuStyle(box: { top: number; left: number } | null): {
  position: "fixed";
  top: number;
  left: number;
  right: "auto";
  bottom: "auto";
  width: "max-content";
  height: "auto";
  maxWidth: number;
  maxHeight: number;
  minWidth: number;
  minHeight: number;
  transform: "none";
  transformOrigin: "top left";
  borderRadius: number;
  visibility: "visible" | "hidden";
} {
  return {
    position: "fixed",
    top: box?.top ?? 0,
    left: box?.left ?? 0,
    right: "auto",
    bottom: "auto",
    width: "max-content",
    height: "auto",
    maxWidth: SHOT_MENU_MAX.w,
    maxHeight: SHOT_MENU_MAX.h,
    minWidth: 190,
    minHeight: 0,
    transform: "none",
    transformOrigin: "top left",
    borderRadius: 10,
    visibility: box ? "visible" : "hidden",
  };
}

export function menuBoxCoversPoint(
  box: { top: number; left: number; width: number; height: number },
  point: { x: number; y: number },
): boolean {
  return point.x >= box.left && point.x <= box.left + box.width
    && point.y >= box.top && point.y <= box.top + box.height;
}

/** Live cream ellipse covers the whiteboard center. A real menu must not. */
export function shotMenuCoversWhiteboard(
  menu: { top: number; left: number; width: number; height: number },
  viewport: { vw: number; vh: number },
): boolean {
  if (menu.width > SHOT_MENU_MAX.w || menu.height > SHOT_MENU_MAX.h) return true;
  if (menu.width > viewport.vw * 0.4 || menu.height > viewport.vh * 0.4) return true;
  return menuBoxCoversPoint(menu, {
    x: viewport.vw / 2,
    y: Math.round(viewport.vh * 0.35),
  });
}
