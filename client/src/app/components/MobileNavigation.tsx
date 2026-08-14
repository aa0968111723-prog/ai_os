import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Icon, type IconName } from "../../components/Icon";
import { Button } from "../../components/ui";
import { useFocusTrap } from "../../components/interactions";
import { useSheetSwipeDismiss } from "../../lib/useSheetSwipeDismiss";
import { useAssistantComposeListener } from "../../lib/assistantCompose";
import { hasDesktopBridge } from "../../platform/desktopBridge";
import {
  DESTINATIONS,
  destinationMatch,
  mobileMoreRoot,
  type Destination,
  type DestinationKey,
  type MobileMoreFolderId,
} from "../navigation/navigationItems";
import { GlobalAssistantSheet } from "./GlobalAssistantSheet";

/**
 * 底欄一級：今日、專案。中央 AI 助手與「更多」不在這個陣列裡。
 *
 * 「筆記排程」已從底欄撤下——`/planner` 仍由今天頁摘要與 More「進階工具」進入，route 不刪。
 * 正中央的球是「開啟全站 AI 助手」的按鈕，不是 `/dashboard#ai-work` 捲動錨點。
 */
const ITEMS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/dashboard", label: DESTINATIONS.dashboard.label, icon: DESTINATIONS.dashboard.icon, match: [] },
  { href: "/dashboard#projects", label: "專案", icon: "Package", match: ["/p/"] },
];

/** wouter 的 location 不含 hash——今日與專案都指向 /dashboard（帶不同 hash），
 *  只比 pathname 會兩顆同時亮；這裡自己追 hash 讓「今日／專案」互斥。
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

function folderOf(id: MobileMoreFolderId) {
  const item = mobileMoreRoot.find((entry) => entry.kind === "folder" && entry.id === id);
  return item?.kind === "folder" ? item : null;
}

function destItems(keys: DestinationKey[]): SheetItem[] {
  const items: SheetItem[] = keys.map((key) => DESTINATIONS[key]);
  if (keys.includes("downloads") && hasDesktopBridge()) items.push(DESKTOP_BRIDGE);
  return items;
}

function allMoreDestinations(): SheetItem[] {
  return mobileMoreRoot.flatMap((entry) =>
    entry.kind === "link" ? [DESTINATIONS[entry.key]] : destItems(entry.keys),
  );
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

function MoreRow({
  item,
  active,
  unread,
  onClick,
}: {
  item: SheetItem;
  active: boolean;
  unread?: number;
  onClick?: () => void;
}) {
  return (
    <Link
      href={item.href}
      className={`mobile-more-sheet__row${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="mobile-more-sheet__icon"><Icon name={item.icon} size={19} /></span>
      <span>
        <strong>
          {item.label}
          {item.href === "/chat" && unread != null && unread > 0 && (
            <span className="dm-nav-unread" aria-label={`${unread} 則未讀私訊`}>{unread > 99 ? "99+" : unread}</span>
          )}
        </strong>
        <small>{item.description}</small>
      </span>
      <Icon name="ChevronRight" size={16} />
    </Link>
  );
}

export function MobileNavigation({ dmUnread = 0, groupId = "" }: { dmUnread?: number; groupId?: string }) {
  const [location, navigate] = useLocation();
  const [hash, syncHash] = useHash();
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreView, setMoreView] = useState<"root" | MobileMoreFolderId>("root");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const openAssistantForCompose = useCallback(() => setAssistantOpen(true), []);
  useAssistantComposeListener(openAssistantForCompose);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  // 把手（grip）畫在那裡就是在承諾「可以下滑關閉」。手勢掛在整張 sheet
  // （不只把手），內容捲動中自動讓路——為什麼必須這樣做（修壞過兩輪的
  // 完整記載）在 useSheetSwipeDismiss 檔頭。
  const moreSheetRef = useRef<HTMLElement | null>(null);
  const historyPushedRef = useRef(false);

  const closeMore = useCallback(() => {
    setMoreOpen(false);
    setMoreView("root");
    if (historyPushedRef.current) {
      historyPushedRef.current = false;
      if (window.history.state?.aiosMore) window.history.back();
    }
  }, []);

  const openMore = useCallback(() => {
    setMoreView("root");
    setMoreOpen(true);
    if (!historyPushedRef.current) {
      window.history.pushState({ ...(window.history.state ?? {}), aiosMore: true }, "");
      historyPushedRef.current = true;
    }
  }, []);

  const dismissMore = useCallback(() => {
    if (moreView !== "root") {
      setMoreView("root");
      return;
    }
    closeMore();
  }, [moreView, closeMore]);

  useSheetSwipeDismiss(moreSheetRef, closeMore, moreOpen);
  useFocusTrap(moreSheetRef, moreOpen, dismissMore);

  const isHere = (item: SheetItem) => destinationMatch(item).some((prefix) => location.startsWith(prefix));
  const moreActive = allMoreDestinations().some(isHere);
  const folder = moreView === "root" ? null : folderOf(moreView);
  const folderItems = folder ? destItems(folder.keys) : [];

  useEffect(() => {
    setMoreOpen(false);
    setMoreView("root");
    historyPushedRef.current = false;
  }, [location]);

  useEffect(() => {
    if (!moreOpen) return;
    const onPop = () => {
      historyPushedRef.current = false;
      if (moreView !== "root") {
        setMoreView("root");
        return;
      }
      setMoreOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [moreOpen, moreView]);

  return (
    <>
      {moreOpen && (
        <>
          <button
            type="button"
            className="mobile-more-scrim"
            aria-label="關閉更多功能"
            onClick={closeMore}
          />
          <aside
            id="mobile-more-tools"
            className="mobile-more-sheet"
            aria-label={folder ? folder.label : "更多功能"}
            aria-modal="true"
            tabIndex={-1}
            ref={moreSheetRef}
          >
            <div className="mobile-more-sheet__grip" aria-hidden="true" />
            <div className="mobile-more-sheet__head">
              <span>
                {folder ? (
                  <Button variant="ghost" size="sm" type="button" onClick={() => setMoreView("root")} aria-label="返回更多">
                    <Icon name="ChevronRight" size={16} style={{ transform: "rotate(180deg)" }} />
                    返回
                  </Button>
                ) : (
                  <strong>更多</strong>
                )}
                {folder && <strong>{folder.label}</strong>}
              </span>
              <Button variant="ghost" size="sm" type="button" onClick={closeMore} aria-label="關閉更多功能">
                <Icon name="X" size={16} />
              </Button>
            </div>
            <div className="mobile-more-sheet__grid">
              {moreView === "root"
                ? mobileMoreRoot.map((entry) => {
                    if (entry.kind === "link") {
                      const dest = DESTINATIONS[entry.key];
                      return (
                        <MoreRow
                          key={dest.href}
                          item={dest}
                          active={isHere(dest)}
                          unread={entry.key === "chat" ? dmUnread : undefined}
                        />
                      );
                    }
                    const childActive = destItems(entry.keys).some(isHere);
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        className={`mobile-more-sheet__row${childActive ? " active" : ""}`}
                        onClick={() => setMoreView(entry.id)}
                      >
                        <span className="mobile-more-sheet__icon"><Icon name={entry.icon} size={19} /></span>
                        <span>
                          <strong>{entry.label}</strong>
                          <small>{entry.description}</small>
                        </span>
                        <Icon name="ChevronRight" size={16} />
                      </button>
                    );
                  })
                : folderItems.map((item) => (
                    <MoreRow
                      key={item.href}
                      item={item}
                      active={isHere(item)}
                      unread={item.href === "/chat" ? dmUnread : undefined}
                    />
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
        {ITEMS.map((item) => {
          const [pathname, anchor] = item.href.split("#");
          // 同 pathname 的分頁以 hash 互斥：/dashboard 無 hash＝今日、#projects＝專案
          const hashMatched = anchor ? hash === `#${anchor}` : !ITEMS.some((i) => i.href === `${pathname}${hash}` && i.href !== item.href);
          const active = (location === pathname && hashMatched) || item.match.some((prefix) => location.startsWith(prefix));
          const content = (
            <>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
            </>
          );
          return item.href.includes("#") ? (
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
          ) : (
            <Link
              key={item.label}
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
          aria-haspopup="dialog"
          onClick={() => (moreOpen ? closeMore() : openMore())}
        >
          <span className="mobile-nav__icon-wrap">
            <Icon name="Ellipsis" size={20} />
            {dmUnread > 0 && <span className="mobile-nav__dot" aria-hidden />}
          </span>
          <span>更多{dmUnread > 0 && <span className="sr-only">（有未讀私訊）</span>}</span>
        </button>
      </nav>
    </>
  );
}
