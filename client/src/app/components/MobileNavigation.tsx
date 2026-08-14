import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Icon, type IconName } from "../../components/Icon";
import { Button } from "../../components/ui";
import { useSheetSwipeDismiss } from "../../lib/useSheetSwipeDismiss";
import { useAssistantComposeListener } from "../../lib/assistantCompose";
import { hasDesktopBridge } from "../../platform/desktopBridge";
import { DESTINATIONS, destinationMatch, mobileMoreGroups, type Destination } from "../navigation/navigationItems";
import { GlobalAssistantSheet } from "./GlobalAssistantSheet";

/**
 * 分頁列的四個導航格。
 *
 * 正中央的「AI 工作」**不在這個陣列裡**——它從導航連結變成了「開啟全站 AI 助手」
 * 的按鈕（見下方 orb）。原本它只是 `/dashboard#ai-work` 的捲動錨點：按下去跳回
 * 今日工作台捲到「繼續創作」那一格，而那一格本來就在 dashboard 上、捲一下就到。
 * 換成助手入口幾乎不犧牲任何既有功能，卻讓那顆球真的有事做。
 */
const ITEMS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/dashboard", label: DESTINATIONS.dashboard.label, icon: DESTINATIONS.dashboard.icon, match: [] },
  { href: "/dashboard#projects", label: "專案", icon: "Package", match: ["/p/"] },
  { href: "/planner", label: DESTINATIONS.planner.label, icon: DESTINATIONS.planner.icon, match: ["/planner"] },
];

/** wouter 的 location 不含 hash——分頁列有三顆都指向 /dashboard（帶不同 hash），
 *  只比 pathname 會三顆同時亮；這裡自己追 hash 讓「今日／專案／AI 工作」互斥。
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
  // 創作台的情境命令列把話丟過來時要順手打開助手（桌機那顆球在 AssistantLauncher 同理）
  const openAssistantForCompose = useCallback(() => setAssistantOpen(true), []);
  useAssistantComposeListener(openAssistantForCompose);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  // 把手（grip）畫在那裡就是在承諾「可以下滑關閉」。手勢掛在整張 sheet
  // （不只把手），內容捲動中自動讓路——為什麼必須這樣做（修壞過兩輪的
  // 完整記載）在 useSheetSwipeDismiss 檔頭。
  const moreSheetRef = useRef<HTMLElement | null>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useSheetSwipeDismiss(moreSheetRef, closeMore, moreOpen);
  const groups = moreGroups();
  const isHere = (item: SheetItem) => destinationMatch(item).some((prefix) => location.startsWith(prefix));
  const moreActive = groups.some((group) => group.items.some(isHere));

  useEffect(() => setMoreOpen(false), [location]);
  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);

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
                    <Link key={item.href} href={item.href} className={isHere(item) ? "active" : ""}>
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
      <GlobalAssistantSheet
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        groupId={groupId}
        triggerRef={orbRef}
      />
      <nav className="mobile-nav" aria-label="主要功能">
        {ITEMS.map((item, index) => {
          // 正中央插入 AI 球（第 2 顆之後）：它不是導航連結，是開啟助手的按鈕
          const orb = index === 2 ? (
            <button
              key="ai-orb"
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
          ) : null;
          const [pathname, anchor] = item.href.split("#");
          // 同 pathname 的分頁以 hash 互斥：/dashboard 無 hash＝今日、#projects＝專案、#ai-work＝AI 工作
          const hashMatched = anchor ? hash === `#${anchor}` : !ITEMS.some((i) => i.href === `${pathname}${hash}` && i.href !== item.href);
          const active = (location === pathname && hashMatched) || item.match.some((prefix) => location.startsWith(prefix));
          const content = (
            <>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </>
          );
          const link = item.href.includes("#") ? (
            <a
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
          ) : (
            <Link
              href={item.href}
              className={active ? "active" : ""}
              aria-current={active ? "page" : undefined}
              onClick={(e) => {
                // 「今日」＝同 pathname 但不帶 hash。從 /dashboard#projects 回來時 wouter
                // 的 pushState 雖然清得掉 hash，卻不會發 hashchange，快照（pathname+search）
                // 也一樣 → React 直接跳過重繪：分頁列還亮在「專案」、畫面停在原處，
                // 使用者看到的就是「按了沒反應」。自己導航後補 syncHash()，再捲回頁首，
                // 讓它跟其他分頁一樣真的換頁。
                if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.button !== 0) return;
                if (location !== pathname || !window.location.hash) return;
                e.preventDefault();
                navigate(item.href);
                syncHash();
                window.scrollTo({ top: 0 });
              }}
            >
              {content}
            </Link>
          );
          // orb 在中央：先渲染前兩顆導航格，插入球，再接後面的
          return (
            <Fragment key={item.label}>
              {orb}
              {link}
            </Fragment>
          );
        })}
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
