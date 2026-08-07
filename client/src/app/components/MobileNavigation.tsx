import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useLocation } from "wouter";
import { Icon, type IconName } from "../../components/Icon";
import { Button } from "../../components/ui";

const ITEMS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/dashboard", label: "今日", icon: "CheckCircle2", match: [] },
  { href: "/dashboard#projects", label: "專案", icon: "Package", match: ["/p/"] },
  { href: "/dashboard#ai-work", label: "AI 工作", icon: "Sparkles", match: [] },
  { href: "/planner", label: "排程", icon: "Clock", match: ["/planner"] },
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

const MORE_ITEMS: { href: string; label: string; description: string; icon: IconName; match: string[] }[] = [
  { href: "/studio", label: "動畫創作室", description: "手繪白板與順序分鏡表", icon: "Brush", match: ["/studio"] },
  { href: "/community", label: "靈感頻道", description: "全站共用提示詞與素材", icon: "Sparkles", match: ["/community"] },
  { href: "/databases", label: "資料庫", description: "清單、文件與批次匯入", icon: "Database", match: ["/databases"] },
  { href: "/chat", label: "私訊", description: "與夥伴和 AI 協作", icon: "MessageCircle", match: ["/chat"] },
  { href: "/help", label: "使用說明", description: "快速找到下一步", icon: "HelpCircle", match: ["/help"] },
  { href: "/integrations", label: "外部資料", description: "Google、Notion 與 API", icon: "ArrowRight", match: ["/integrations"] },
  { href: "/downloads", label: "共用下載", description: "取得團隊共用文件", icon: "Download", match: ["/downloads"] },
];

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

export function MobileNavigation({ dmUnread = 0 }: { dmUnread?: number }) {
  const [location, navigate] = useLocation();
  const [hash, syncHash] = useHash();
  const [moreOpen, setMoreOpen] = useState(false);
  // 把手（grip）畫在那裡就是在承諾「可以下滑關閉」——補上最小手勢：
  // 只在把手／標頭列起手（避免與內容捲動打架），下滑超過閾值即關閉
  const sheetDragY = useRef<number | null>(null);
  const sheetDragProps = {
    onPointerDown: (e: ReactPointerEvent) => {
      if (e.pointerType === "mouse") return;
      sheetDragY.current = e.clientY;
    },
    onPointerMove: (e: ReactPointerEvent) => {
      if (sheetDragY.current != null && e.clientY - sheetDragY.current > 48) {
        sheetDragY.current = null;
        setMoreOpen(false);
      }
    },
    onPointerUp: () => { sheetDragY.current = null; },
    onPointerCancel: () => { sheetDragY.current = null; },
  };
  const moreActive = MORE_ITEMS.some((item) => item.match.some((prefix) => location.startsWith(prefix)));

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
          <aside id="mobile-more-tools" className="mobile-more-sheet" aria-label="更多功能">
            <div className="mobile-more-sheet__grip" aria-hidden="true" {...sheetDragProps} />
            <div className="mobile-more-sheet__head" {...sheetDragProps}>
              <span>
                <strong>更多日常工具</strong>
                <small>資料、溝通與外部連接都保留在這裡</small>
              </span>
              <Button variant="ghost" size="sm" type="button" onClick={() => setMoreOpen(false)} aria-label="關閉更多功能">
                <Icon name="X" size={16} />
              </Button>
            </div>
            <div className="mobile-more-sheet__grid">
              {MORE_ITEMS.map((item) => (
                <Link key={item.href} href={item.href} className={item.match.some((prefix) => location.startsWith(prefix)) ? "active" : ""}>
                  <span className="mobile-more-sheet__icon"><Icon name={item.icon} size={19} /></span>
                  <span><strong>{item.label}{item.href === "/chat" && dmUnread > 0 && (
                    <span className="dm-nav-unread" aria-label={`${dmUnread} 則未讀私訊`}>{dmUnread > 99 ? "99+" : dmUnread}</span>
                  )}</strong><small>{item.description}</small></span>
                  <Icon name="ChevronRight" size={16} />
                </Link>
              ))}
            </div>
          </aside>
        </>
      )}
      <nav className="mobile-nav" aria-label="主要功能">
        {ITEMS.map((item) => {
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
