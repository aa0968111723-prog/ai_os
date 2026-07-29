import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Icon, type IconName } from "../../components/Icon";

const ITEMS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/dashboard", label: "今日", icon: "CheckCircle2", match: ["/dashboard"] },
  { href: "/dashboard#projects", label: "專案", icon: "Package", match: ["/p/"] },
  { href: "/dashboard#ai-work", label: "AI 工作", icon: "Sparkles", match: [] },
  { href: "/planner", label: "排程", icon: "Clock", match: ["/planner"] },
];

const MORE_ITEMS: { href: string; label: string; description: string; icon: IconName; match: string[] }[] = [
  { href: "/databases", label: "資料庫", description: "清單、文件與批次匯入", icon: "Database", match: ["/databases"] },
  { href: "/chat", label: "私訊", description: "與夥伴和 AI 協作", icon: "MessageCircle", match: ["/chat"] },
  { href: "/help", label: "使用說明", description: "快速找到下一步", icon: "HelpCircle", match: ["/help"] },
  { href: "/integrations", label: "外部資料", description: "Google、Notion 與 API", icon: "ArrowRight", match: ["/integrations"] },
  { href: "/downloads", label: "共用下載", description: "取得團隊共用文件", icon: "Download", match: ["/downloads"] },
];

export function MobileNavigation() {
  const [location] = useLocation();
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
            <div className="mobile-more-sheet__head">
              <span>
                <strong>更多日常工具</strong>
                <small>資料、溝通與外部連接都保留在這裡</small>
              </span>
              <button type="button" className="btn-ghost btn-sm" onClick={() => setMoreOpen(false)} aria-label="關閉更多功能">
                <Icon name="X" size={16} />
              </button>
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
          const pathname = item.href.split("#")[0];
          const active = location === pathname || item.match.some((prefix) => location.startsWith(prefix));
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
