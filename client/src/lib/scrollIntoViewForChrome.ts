/**
 * 手機殼層下的「捲到可見」——預留底欄／safe-area，避免 focus 後欄位仍被裁切（Mobile-First M2）。
 *
 * 為什麼不直接 scrollIntoView：
 * - 固定底欄（mobile-nav）與 --chrome-bottom 會蓋住「畫面底部」；
 *   原生 block:"center" 仍常把輸入列停在底欄正下方。
 * - 鍵盤彈出時 visualViewport 縮小，需要多一截 offset。
 *
 * 讀 CSS 變數 --chrome-bottom／--safe-bottom，與 styles.css 底部留白契約同源；
 * 禁止在此寫死 88／100／140。
 */

function cssPxVar(name: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 可視區底部應預留的 px（底欄 + safe + 小緩衝） */
export function chromeBottomReservePx(): number {
  const chrome = cssPxVar("--chrome-bottom", 48);
  const safe = cssPxVar("--safe-bottom", 0);
  // 鍵盤／緩衝：visualViewport 與 layout viewport 的差，下限 12
  let keyboard = 12;
  if (typeof window !== "undefined" && window.visualViewport) {
    const gap = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
    keyboard = Math.max(12, Math.min(gap, 320));
  }
  return chrome + safe + keyboard;
}

/**
 * 把 el 捲進「扣掉底欄後」的可視區。
 * 已在安全區內則不動，避免 focus 每下都跳。
 */
export function scrollIntoViewForChrome(
  el: Element | null | undefined,
  opts?: { behavior?: ScrollBehavior },
): void {
  if (!el || typeof window === "undefined") return;
  const rect = el.getBoundingClientRect();
  const topSafe = 8 + (Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0);
  const bottomSafe = window.innerHeight - chromeBottomReservePx();
  if (rect.top >= topSafe && rect.bottom <= bottomSafe) return;

  // 目標：欄位中線落在（頂 safe 與底 chrome 之間）的 40% 處——拇指熱區偏上
  const band = Math.max(80, bottomSafe - topSafe);
  const targetY = topSafe + band * 0.4;
  const delta = rect.top + rect.height / 2 - targetY;
  const behavior = opts?.behavior ?? "smooth";
  window.scrollBy({ top: delta, left: 0, behavior });
}

/**
 * focus + 捲到可見（給 input/textarea/select 用）。
 * 延遲一幀：等鍵盤／layout 穩定後再量 rect。
 */
export function focusAndReveal(
  el: HTMLElement | null | undefined,
  opts?: { preventScroll?: boolean; behavior?: ScrollBehavior },
): void {
  if (!el) return;
  try {
    el.focus({ preventScroll: opts?.preventScroll ?? true });
  } catch {
    el.focus();
  }
  requestAnimationFrame(() => {
    scrollIntoViewForChrome(el, { behavior: opts?.behavior ?? "smooth" });
  });
}
