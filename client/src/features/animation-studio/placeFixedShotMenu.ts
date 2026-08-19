/**
 * Place the 動畫創作室 timeline shot menu in the viewport.
 * Live 1280×800: #790 scrim <button> ate 複製 — global `button` is cream
 * (`--card`) + `border-radius: 999px` + `inset: 0` = giant blank circle.
 * Portal must paint a *small* menu; 複製's box stays on-screen.
 */
export const LAPTOP_VIEWPORT = { vw: 1280, vh: 800 } as const;
export const SHOT_MENU_MAX = { w: 240, h: 240 } as const;

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

export function menuBoxCoversPoint(
  box: { top: number; left: number; width: number; height: number },
  point: { x: number; y: number },
): boolean {
  return point.x >= box.left && point.x <= box.left + box.width
    && point.y >= box.top && point.y <= box.top + box.height;
}
