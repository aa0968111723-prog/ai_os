import { useEffect, useState } from "react";
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
 *  hashchange/popstate 監聽只補「純 hash 變化」不經 wouter 的情況。 */
function useHash(): string {
  const [, bump] = useState(0);
  useEffect(() => {
    const sync = () => bump((n) => n + 1);
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  return typeof window === "undefined" ? "" : window.location.hash;
}

const MORE_ITEMS: { href: string; label: string; description: string; icon: IconName; match: string[] }[] = [
  { href: "/databases", label: "資料庫", description: "清單、文件與批次匯入", icon: "Database", match: ["/databases"] },
  { href: "/chat", label: "私訊", description: "與夥伴和 AI 協作", icon: "MessageCircle", match: ["/chat"] },
  { href: "/help", label: "使用說明", description: "快速找到下一步", icon: "HelpCircle", match: ["/help"] },
  { href: "/integrations", label: "外部資料", description: "Google、Notion 與 API", icon: "ArrowRight", match: ["/integrations"] },
  { href: "/downloads", label: "共用下載", description: "取得團隊共用文件", icon: "Download", match: ["/downloads"] },
];

export function MobileNavigation() {
  const [location] = useLocation();
  const hash = useHash();
  const [moreOpen, setMoreOpen] = useState(false);
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
            <div className="mobile-more-sheet__grip" aria-hidden="true" />
            <div className="mobile-more-sheet__head">
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
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
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
            <a key={item.label} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
              {content}
            </a>
          ) : (
            <Link key={item.label} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
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
          <Icon name="Ellipsis" size={20} />
          <span>更多</span>
        </button>
      </nav>
    </>
  );
}
