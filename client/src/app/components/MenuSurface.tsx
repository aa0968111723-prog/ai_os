import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useMatchMedia } from "../../lib/useMatchMedia";

/** 選單改為貼底 sheet 的斷點：與 styles.css 的手機殼層 v2（≤820px）同界線 */
export const MENU_SHEET_MQ = "(max-width: 820px)";

/** 下拉與觸發器的間距，與 styles.css `.menu { top: calc(100% + 8px) }` 同值 */
const MENU_ANCHOR_GAP = 8;
/** 下拉底部與視窗下緣至少留白，讓人看得出「到底了」而不是被裁掉 */
const MENU_VIEWPORT_GUTTER = 12;
/**
 * 桌機下拉的最小高度。觸發器離視窗下緣不到這個距離時就不再壓縮——
 * 壓成一條 30px 的縫比略微超出更難用。站內三個選單的觸發器都在頂欄或頁面中段，
 * 實務上碰不到這個下限；它只是防呆。
 */
const MENU_MIN_DESKTOP_H = 160;

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
 * 桌機也有一個對稱的陷阱：下拉沒有高度上限。帳號選單有 17 項（每項 ≥44px 的觸控下限），
 * 展開後約 1100px，1080p 螢幕在頂欄下只剩約 880px，「改密碼／登出全部裝置／登出」整段
 * 被切在視窗外——而且 `.topbar` 是 sticky、下拉又是它的 absolute 後代，捲頁時兩者一起釘住，
 * 被切掉的部分永遠捲不出來。因此開啟時量觸發器到視窗下緣的實際距離，寫進 `--menu-avail-h`，
 * 由 styles.css 的 `.menu` 收成 max-height ＋ 內捲。
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
  surfaceRole = "menu",
  placement = "anchored",
  id,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** 讀屏用的選單名稱（aria-label） */
  label: string;
  /**
   * 載體的 ARIA 角色。`menu` 承諾方向鍵漫遊，子項必須是 role="menuitem"；
   * 內容其實是表單或一堆卡片時要改 `dialog`（並關掉 roving），
   * 否則等於對讀屏承諾了沒實作的鍵盤模型。
   */
  surfaceRole?: "menu" | "listbox" | "dialog";
  /**
   * 桌機幾何。`anchored`＝沿用 .menu 的右對齊下拉；
   * `stretch`＝與觸發器同寬（卡片牆／表單類面板用，184px 的下拉裝不下）。
   * 手機一律是滿寬貼底 sheet，此值不影響。
   */
  placement?: "anchored" | "stretch";
  /** 供觸發器 aria-controls 指向 */
  id?: string;
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
  // 桌機下拉的可用高度（見檔頭第四段）。手機 sheet 自己有 max-height，不套這條。
  // 捲動也要重算：觸發器不在 sticky 頂欄裡時（例如創作台的技能挑選器）會隨頁面移動。
  useLayoutEffect(() => {
    if (!open || compact) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const apply = () => {
      // 沒有 triggerRef 時退而用選單自己的上緣——同樣是「從這裡到視窗下緣」的距離
      const anchorBottom = triggerRef?.current
        ? triggerRef.current.getBoundingClientRect().bottom + MENU_ANCHOR_GAP
        : surface.getBoundingClientRect().top;
      const avail = window.innerHeight - anchorBottom - MENU_VIEWPORT_GUTTER;
      surface.style.setProperty("--menu-avail-h", `${Math.round(Math.max(MENU_MIN_DESKTOP_H, avail))}px`);
    };
    apply();
    window.addEventListener("resize", apply);
    // capture：內層捲動容器的 scroll 不會冒泡，只有捕獲階段抓得到
    window.addEventListener("scroll", apply, true);
    return () => {
      window.removeEventListener("resize", apply);
      window.removeEventListener("scroll", apply, true);
    };
  }, [open, compact, triggerRef]);
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
        id={id}
        role={surfaceRole}
        aria-label={label}
        className={`menu menu-surface${placement === "stretch" ? " menu-surface--stretch" : ""}${compact ? " is-sheet" : ""}${className ? ` ${className}` : ""}`}
        style={!compact && minWidth ? { minWidth } : undefined}
      >
        {children}
      </div>
    </>
  );
  // compact 才 portal：桌機留在 .menu-wrap 內才能用 absolute 錨定觸發器
  return compact && typeof document !== "undefined" ? createPortal(node, document.body) : node;
}
