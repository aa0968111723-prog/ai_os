/**
 * Place the 動畫創作室 timeline shot menu in the viewport.
 * Live 1024-high: a bottom-absolute menu inside the 148px strip sat
 * off-screen (needed 1280×1600). Portal + these numbers keep 複製 on-screen.
 */
export function placeFixedShotMenu(input: {
  trigger: { top: number; left: number; bottom: number; right?: number } | null;
  menuH: number;
  menuW: number;
  vw: number;
  vh: number;
  gap?: number;
}): { top: number; left: number } {
  const gap = input.gap ?? 4;
  const { menuH, menuW, vw, vh } = input;
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
