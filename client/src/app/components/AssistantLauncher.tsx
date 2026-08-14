import { useCallback, useRef, useState } from "react";
import { Icon } from "../../components/Icon";
import { useMatchMedia } from "../../lib/useMatchMedia";
import { GlobalAssistantSheet } from "./GlobalAssistantSheet";
import { MENU_SHEET_MQ } from "./MenuSurface";
import { useAssistantComposeListener } from "../../lib/assistantCompose";

/**
 * 桌機的 AI 助手入口（頂欄那顆球）。
 *
 * ## 為什麼需要它
 *
 * 助手原本只有一個入口：底部導覽正中央那顆 orb。而 `.mobile-nav` 在 >820px 是
 * `display: none`——球還在 DOM 裡，但看不見也按不到。也就是說**桌機使用者完全
 * 叫不出助手**，後端那 9 個跨專案工具在桌機上等於不存在。這顆按鈕補上那個洞。
 *
 * ## 為什麼用 useMatchMedia 條件渲染，而不是用 CSS 藏起來
 *
 * 兩個原因，第二個才是真正不可退讓的：
 *
 * 1. 手機已經有 orb 了，頂欄再放一顆是重複的入口。
 * 2. `MenuSurface` 用 `triggerRef` 判斷「點到的是不是觸發器」（否則點第二下會
 *    關了又立刻開）與 Esc 之後把焦點還給誰。CSS 藏起來的話兩顆觸發器會同時存在，
 *    而 display:none 的那顆仍然是合法的 DOM 節點——外點判斷與焦點歸還就有兩個
 *    候選。條件渲染讓「當下唯一可按的觸發器」在 DOM 層面就是唯一的。
 *
 * 斷點用 MenuSurface 匯出的同一個 `MENU_SHEET_MQ`，不另外寫死 820——
 * 兩邊各寫一次的話，改斷點時一定會漏掉其中一邊，症狀是某個寬度區間裡
 * 兩顆球同時出現、或兩顆都不見。
 */
export function AssistantLauncher({ groupId }: { groupId: string }) {
  const compact = useMatchMedia(MENU_SHEET_MQ);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  // 別的表面（創作台的情境命令列）把話丟過來時要順手打開面板。
  // 這個 hook 必須排在下面的 early return 之前，否則 compact 切換時 hook 數量會變。
  const openForCompose = useCallback(() => setOpen(true), []);
  useAssistantComposeListener(openForCompose);

  // 手機走底部導覽那顆 orb；這裡連 sheet 都不掛，避免同時存在兩張面板
  if (compact) return null;

  return (
    <div className="menu-wrap">
      <button
        ref={triggerRef}
        type="button"
        className={`assistant-launcher${open ? " active" : ""}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="global-assistant-sheet"
        onClick={() => setOpen((v) => !v)}
        title="AI 助手"
      >
        <Icon name="Sparkles" size={16} />
        <span>AI 助手</span>
      </button>
      <GlobalAssistantSheet open={open} onClose={close} groupId={groupId} triggerRef={triggerRef} />
    </div>
  );
}
