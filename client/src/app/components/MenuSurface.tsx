import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMatchMedia } from "../../lib/useMatchMedia";

/** 選單改為貼底 sheet 的斷點：與 styles.css 的手機殼層 v2（≤820px）同界線 */
export const MENU_SHEET_MQ = "(max-width: 820px)";

/**
 * 選單載體：桌機是錨定觸發器的下拉，手機（≤820px）自動變成貼底 bottom sheet。
 *
 * 為什麼要抽成共用元件——手機版下拉有三個每個選單都會單獨踩一次的陷阱：
 *
 * 1. **包含區塊**：`.topbar` 有 `backdrop-filter`，任何 `position: fixed` 的後代都會
 *    改以頂欄的邊框方框為基準定位，而不是視窗。舊的 `.topbar .menu { position: fixed;
 *    top: 60px }` 因此把選單釘在頂欄下緣、`bottom: 0` 也貼不到螢幕底。解法是 compact
 *    時把整個載體 portal 到 `document.body` 脫離該包含區塊。
 * 2. **疊層**：`.menu` 的 z-index 40 低於底部分頁列的 44，長清單的末項（例如「登出」）
 *    會被分頁列蓋住按不到（真機實測）。sheet 用 46／47 蓋過分頁列。
 * 3. **外點關閉**：選單一旦 portal 出去就不再是觸發器的 DOM 後代，只檢查 wrap 的
 *    外點判斷會把「點選單本身」誤判成點外面，選單一按就關。
 *
 * 鍵盤行為（ARIA menu 契約）一併收在這裡：開啟時聚焦首項、上下鍵漫遊、Home/End、
 * Esc 關閉並把焦點還給觸發器。呼叫端只要保證子項有 `role="menuitem"`。
 */
export function MenuSurface({
  open,
  onClose,
  label,
  triggerRef,
  minWidth,
  className,
  roving = true,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** 讀屏用的選單名稱（aria-label） */
  label: string;
  /** 觸發器：點它不算外點（否則點第二下會關了又立刻開），Esc 後焦點還給它 */
  triggerRef?: RefObject<HTMLElement | null>;
  /** 桌機下拉的最小寬度；手機 sheet 一律滿寬，此值不套用 */
  minWidth?: number;
  className?: string;
  /** 關掉方向鍵漫遊與自動聚焦（子項不是真正的 menuitem 時用） */
  roving?: boolean;
  children: ReactNode;
}) {
  const compact = useMatchMedia(MENU_SHEET_MQ);
  const surfaceRef = useRef<HTMLDivElement>(null);
  // 開啟當下就要能聚焦首項：DOM 在 layout effect 執行時已存在，
  // 用 rAF 會讓焦點落點取決於畫格時機，CI 與慢裝置上會間歇性留在觸發器上
  useLayoutEffect(() => {
    if (!open || !roving) return;
    const items = surfaceRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])');
    items?.[0]?.focus();
  }, [open, roving]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (surfaceRef.current?.contains(t)) return;
      if (triggerRef?.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        triggerRef?.current?.focus();
        return;
      }
      if (!roving) return;
      const items = [...(surfaceRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
      if (!items.length) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const focusItem = (index: number) => items[(index + items.length) % items.length]?.focus();
      if (e.key === "ArrowDown") { e.preventDefault(); focusItem(at + 1); }
      if (e.key === "ArrowUp") { e.preventDefault(); focusItem(at - 1); }
      if (e.key === "Home") { e.preventDefault(); focusItem(0); }
      if (e.key === "End") { e.preventDefault(); focusItem(items.length - 1); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, roving, triggerRef]);

  if (!open) return null;
  const node = (
    <>
      {/* 手機 sheet 的遮罩：點掉即關，同時把底下內容壓暗表示「這層在最上面」。
          aria-hidden＋tabIndex -1：關閉手段鍵盤已有 Esc，遮罩不該再多出一個焦點站 */}
      {compact && (
        <button type="button" className="menu-surface__scrim" aria-hidden tabIndex={-1} onClick={onClose} />
      )}
      <div
        ref={surfaceRef}
        role="menu"
        aria-label={label}
        className={`menu menu-surface${compact ? " is-sheet" : ""}${className ? ` ${className}` : ""}`}
        style={!compact && minWidth ? { minWidth } : undefined}
      >
        {children}
      </div>
    </>
  );
  // compact 才 portal：桌機留在 .menu-wrap 內才能用 absolute 錨定觸發器
  return compact && typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
