import { Fragment, useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Link, useLocation } from "wouter";
import { Icon, type IconName } from "../../components/Icon";
import { Button } from "../../components/ui";
import { useSheetSwipeDismiss } from "../../lib/useSheetSwipeDismiss";
import { useAssistantComposeListener, useAssistantOpenListener } from "../../lib/assistantCompose";
import { hasDesktopBridge } from "../../platform/desktopBridge";
import { DESTINATIONS, destinationMatch, mobileMoreGroups, type Destination } from "../navigation/navigationItems";
import { GlobalAssistantSheet } from "./GlobalAssistantSheet";
import { useIsPhone } from "../../lib/viewport";

/**
 * 底欄一級：專案。中央 AI 助手與右側「更多」不在這個陣列裡。
 *
 * 底欄是三格：專案｜AI 助手｜更多——助手因此真的落在正中央那一格（拇指最好按的位置）。
 * 「今日」已從底欄撤下：它與「專案」本來就是同一頁（`/dashboard` 與 `/dashboard#projects`），
 * 兩顆並排等於用兩格講同一個去處。`/dashboard` 的 route 與 deep link 不刪，改由 More 承接
 *（同「筆記排程」的作法，兩者都仍可從 More 與頂欄進入）。
 *
 * 正中央的球是「開啟全站 AI 助手」的按鈕，不是 `/dashboard#ai-work` 捲動錨點。
 */
const ITEMS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/dashboard#projects", label: "專案", icon: "Package", match: ["/p/"] },
];

/** wouter 的 location 不含 hash——底欄「專案」與 More 的「今日」都指向 /dashboard
 *  （帶不同 hash），只比 pathname 會兩處同時亮；這裡自己追 hash 讓兩者互斥。
 *  渲染時直接讀 window.location.hash（pushState 導航靠 useLocation 重繪即拿到新值），
 *  hashchange/popstate 監聽只補「純 hash 變化」不經 wouter 的情況。
 *  回傳的 sync 給「只清掉 hash」的導航用：那種切換不發 hashchange，wouter 的
 *  location 快照（pathname+search）也沒變，沒人叫得動重繪。 */
function useHash(): [string, () => void] {
  const [, bump] = useState(0);
  const sync = useCallback(() => bump((n) => n + 1), []);
  useEffect(() => {
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [sync]);
  return [typeof window === "undefined" ? "" : window.location.hash, sync];
}

/** 面板列出的一項：DESTINATIONS 的條目，或下面那條只有桌面 App 才有的入口 */
type SheetItem = Omit<Destination, "key">;

/** 桌面版 App 內才有的入口——與使用者選單同一條（窄視窗下選單的「工作」組已收起） */
const DESKTOP_BRIDGE: SheetItem = {
  label: "桌面剪輯連接",
  description: "把生成素材送進本機剪輯軟體",
  href: "/desktop",
  icon: "Monitor",
};

/** 更多面板的分組內容：名稱與說明全部取自 DESTINATIONS，不在這裡另外寫字 */
function moreGroups(): { label: string; items: SheetItem[] }[] {
  const groups: { label: string; items: SheetItem[] }[] = mobileMoreGroups.map((group) => ({
    label: group.label,
    items: group.keys.map((key) => DESTINATIONS[key]),
  }));
  if (hasDesktopBridge()) groups[groups.length - 1]?.items.push(DESKTOP_BRIDGE);
  return groups;
}

/** SPA 導航後等目標區塊掛載完成再捲過去（lazy chunk／資料載入中時 getElementById 還拿不到）。
 *  原生 <a> 整頁重載時是瀏覽器載入完自動捲錨點；這裡補上等價行為，捲動位置同樣吃
 *  既有 scroll-margin CSS。3 秒還等不到就放棄（僅少捲動、不影響導航本身）。 */
function scrollToAnchorWhenReady(anchor: string) {
  const deadline = Date.now() + 3000;
  const tick = () => {
    const el = document.getElementById(anchor);
    if (el) el.scrollIntoView();
    else if (Date.now() < deadline) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function MobileNavigation({ dmUnread = 0, groupId = "" }: { dmUnread?: number; groupId?: string }) {
  const [location, navigate] = useLocation();
  const [hash, syncHash] = useHash();
  const [moreOpen, setMoreOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  /**
   * 助手面板的擁有權：**每個寬度只能有一個主人**。
   *
   * 這個元件在 ≥768px 仍會渲染（`.mobile-nav` 只是 `display: none`），而它掛的
   * `GlobalAssistantSheet` 走 `forceSheet`，portal 到 body——所以它不受 `.mobile-nav`
   * 的 display 影響，照樣看得見。桌機另有 `AssistantLauncher` 掛第二張。
   * 兩邊又都監聽 compose 事件，於是創作台命令列送一句話會**同時開兩張面板**。
   *
   * `AssistantLauncher` 那邊已經用 `if (compact) return null` 讓出手機；
   * 這裡對稱地讓出桌面。兩個條件同源（PHONE_MQ），所以不會有哪個寬度是
   * 兩個都掛、或兩個都不掛。
   */
  const phone = useIsPhone();
  // 創作台的情境命令列把話丟過來時要順手打開助手（桌機那顆球在 AssistantLauncher 同理）
  const openAssistantForCompose = useCallback(() => {
    if (phone) setAssistantOpen(true);
  }, [phone]);
  useAssistantComposeListener(openAssistantForCompose);
  // 手機動作卡的「查看並確認／查看進度」：只開面板，不代使用者再說一句話。
  useAssistantOpenListener(openAssistantForCompose);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  // 把手（grip）畫在那裡就是在承諾「可以下滑關閉」。手勢掛在整張 sheet
  // （不只把手），內容捲動中自動讓路——為什麼必須這樣做（修壞過兩輪的
  // 完整記載）在 useSheetSwipeDismiss 檔頭。
  const moreSheetRef = useRef<HTMLElement | null>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useSheetSwipeDismiss(moreSheetRef, closeMore, moreOpen);
  const groups = moreGroups();
  const isHere = (item: SheetItem) => {
    const matched = destinationMatch(item).some((prefix) => location.startsWith(prefix));
    // 「今日」＝不帶 hash 的 /dashboard。停在 /dashboard#projects 時「這裡」是底欄的
    // 「專案」——若不扣掉 hash，兩顆會一起亮（連帶讓「更多」在專案分頁上恆亮）。
    if (item.href === DESTINATIONS.dashboard.href) return matched && !hash;
    return matched;
  };
  const moreActive = groups.some((group) => group.items.some(isHere));

  /** More 面板裡的導航。除了關掉面板，還要補「只清掉 hash」那一種切換：
   *  從 /dashboard#projects 點「今日」時 wouter 的 pushState 清得掉 hash，卻不發
   *  hashchange，location 快照（pathname+search）也一樣 → React 跳過重繪，面板不關、
   *  畫面不動，看起來就是「按了沒反應」。與底欄「今日」還在時的修法同一條。 */
  const navigateFromSheet = (href: string) => (event: ReactMouseEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.button !== 0) return;
    setMoreOpen(false);
    const [pathname] = href.split("#");
    if (href.includes("#") || location !== pathname || !window.location.hash) return;
    event.preventDefault();
    navigate(href);
    syncHash();
    window.scrollTo({ top: 0 });
  };

  useEffect(() => setMoreOpen(false), [location]);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);

  // 桌機不掛底欄：.mobile-nav 只是 display:none，DOM 仍可被自動化工具點到——
  // click 回成功但快照零變化（P2「更多」假成功）與零尺寸 box（P2 清空鈕）皆源於此。
  // early return 放在全部 hook 之後，hook 順序不受影響。
  if (!phone) return null;

  return (
    <>
      {moreOpen && (
        <>
          <button
            type="button"
            className="mobile-more-scrim"
            aria-label="關閉更多功能"
            onClick={() => setMoreOpen(false)}
          />
          <aside id="mobile-more-tools" className="mobile-more-sheet" aria-label="更多功能" ref={moreSheetRef}>
            <div className="mobile-more-sheet__grip" aria-hidden="true" />
            <div className="mobile-more-sheet__head">
              <span>
                <strong>全部功能</strong>
                <small>底下分頁列放不下的頁面都在這裡</small>
              </span>
              <Button variant="ghost" size="sm" type="button" onClick={() => setMoreOpen(false)} aria-label="關閉更多功能">
                <Icon name="X" size={16} />
              </Button>
            </div>
            <div className="mobile-more-sheet__grid">
              {groups.map((group) => (
                <Fragment key={group.label}>
                  <div className="mobile-more-sheet__label" role="presentation">{group.label}</div>
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={isHere(item) ? "active" : ""}
                      aria-current={isHere(item) ? "page" : undefined}
                      onClick={navigateFromSheet(item.href)}
                    >
                      <span className="mobile-more-sheet__icon"><Icon name={item.icon} size={19} /></span>
                      <span><strong>{item.label}{item.href === "/chat" && dmUnread > 0 && (
                        <span className="dm-nav-unread" aria-label={`${dmUnread} 則未讀私訊`}>{dmUnread > 99 ? "99+" : dmUnread}</span>
                      )}</strong><small>{item.description}</small></span>
                      <Icon name="ChevronRight" size={16} />
                    </Link>
                  ))}
                </Fragment>
              ))}
            </div>
          </aside>
        </>
      )}
      {/* 只有手機掛這張；桌面（含平板）由頂欄 AssistantLauncher 掛（見上方擁有權說明） */}
      {phone && (
        <GlobalAssistantSheet
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          groupId={groupId}
          triggerRef={orbRef}
        />
      )}
      <nav className="mobile-nav" aria-label="主要功能">
        {ITEMS.map((item) => {
          const [pathname, anchor] = item.href.split("#");
          // 同 pathname 的去處以 hash 互斥：/dashboard 無 hash＝More 的「今日」、#projects＝本分頁。
          // 底欄現在只剩帶 hash 的分頁，不帶 hash 的那條走 navigateFromSheet（見上方）。
          const hashMatched = anchor ? hash === `#${anchor}` : !hash;
          const active = (location === pathname && hashMatched) || item.match.some((prefix) => location.startsWith(prefix));
          const content = (
            <>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </>
          );
          return (
            <a
              key={item.label}
              href={item.href}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              onClick={(e) => {
                // 帶 hash 的分頁不能交給原生 <a>：wouter 只攔 Link，跨 pathname 點擊
                // 會整頁重載（重跑 bootstrap、重抓所有 chunk），弱網下切個分頁要等數秒。
                // 同 pathname 的純 hash 跳轉本來就不重載，保留原生錨點捲動；
                // 修飾鍵／中鍵（開新分頁）也交還瀏覽器。
                if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) return;
                if (location === pathname) return;
                e.preventDefault();
                navigate(item.href);
                if (anchor) scrollToAnchorWhenReady(anchor);
              }}
            >
              {content}
            </a>
          );
        })}
        <button
          type="button"
          ref={orbRef}
          className={`mobile-nav__orb${assistantOpen ? " active" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={assistantOpen}
          aria-controls="global-assistant-sheet"
          onClick={() => setAssistantOpen((v) => !v)}
        >
          <Icon name="Sparkles" size={20} />
          <span>AI 助手</span>
        </button>
        <button
          type="button"
          className={moreOpen || moreActive ? "active" : ""}
          aria-expanded={moreOpen}
          aria-controls="mobile-more-tools"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <span className="mobile-nav__icon-wrap">
            <Icon name="Ellipsis" size={20} />
            {/* 私訊未讀紅點：私訊入口在「更多」第二層，錯過推播的人回 App 至少看得到訊號 */}
            {dmUnread > 0 && <span className="mobile-nav__dot" aria-hidden />}
          </span>
          <span>更多{dmUnread > 0 && <span className="sr-only">（有未讀私訊）</span>}</span>
        </button>
      </nav>
    </>
  );
}
