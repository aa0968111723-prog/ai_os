import { useEffect, type RefObject } from "react";

/**
 * 貼底 sheet 的「整面下滑即關」手勢。
 *
 * ## 為什麼不是把手上的 pointer 事件
 *
 * 這個手勢修過兩輪，兩輪都輸給同一件事——瀏覽器的捲動仲裁：
 *
 * 1. 手勢掛在 surface 頂端 32px 帶（無 touch-action）：滑約 16px 就收到
 *    pointercancel，串流被捲動搶走，永遠走不到關閉門檻。實測序列
 *    `down → move → move → CANCEL`。
 * 2. 改成把手真元素 ＋ touch-action:none ＋ setPointerCapture：把手上的下滑
 *    真的能關了——但把手只有 26px 高。實機回報「還是關不掉」：正常人下滑是從
 *    **面板中間任何地方**起手的，那條路徑仍然整條被判成捲動。
 *
 * 通用 bottom-sheet（Google 助手、各家 drawer 函式庫）的做法都是本檔這條路：
 * 手勢掛在**整張 sheet**，touchmove 用非被動監聽，確定要接手時 preventDefault()
 * ——被動監聽不能 preventDefault，而只要沒 preventDefault，瀏覽器一旦把手勢
 * 判成捲動就再也拿不回來。這也是為什麼用 touch 事件而不是 pointer 事件：
 * pointer 串流會被捲動用 pointercancel 沒收，touchmove 只要第一時間
 * preventDefault 就一直是我們的。
 *
 * ## 讓路規則（不與內容捲動打架）
 *
 * - 起手點到 sheet 之間**任何一層已經捲離頂部**（scrollTop > 0）：不接手，
 *   讓它捲——對話 feed 捲到一半時下滑是「回去看上面」，不是「關掉」。
 * - 先往上滑：不接手，讓內容正常往下捲。
 * - 都在頂部且往下滑超過 CLAIM_PX：接手（開始 preventDefault），
 *   累積超過 CLOSE_PX 即關閉。CLAIM_PX 必須小於瀏覽器自己的捲動斷定距離
 *   （Android 約 8–10px），晚一步手勢就歸瀏覽器了。
 */
const CLAIM_PX = 8;
const CLOSE_PX = 48;

export function useSheetSwipeDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    let startY: number | null = null;
    let claimed = false;

    /** 起手點往上到 sheet 為止，是否有任何一層已捲離頂部 */
    const scrolledAncestor = (target: EventTarget | null): boolean => {
      for (let n = target as HTMLElement | null; n; n = n.parentElement) {
        if (n.scrollTop > 0) return true;
        if (n === el) break;
      }
      return false;
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return; // 多指是縮放，不是關閉
      startY = e.touches[0].clientY;
      claimed = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (!claimed) {
        if (dy < -CLAIM_PX) { startY = null; return; } // 往上：讓內容捲
        if (dy < CLAIM_PX) return;                     // 還沒動夠：先觀望
        if (scrolledAncestor(e.target)) { startY = null; return; }
        claimed = true;
      }
      // 接手之後每一步都要擋：漏一步瀏覽器就把剩下的手勢接去捲動
      e.preventDefault();
      if (dy > CLOSE_PX) {
        startY = null;
        claimed = false;
        onClose();
      }
    };
    const onEnd = () => {
      startY = null;
      claimed = false;
    };

    // touchmove 必須 passive: false，preventDefault 才有效
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: true });
    el.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [ref, onClose, enabled]);
}
