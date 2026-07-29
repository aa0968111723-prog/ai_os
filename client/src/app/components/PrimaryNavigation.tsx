import { Link, useLocation } from "wouter";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { topbarNavItems } from "../navigation/navigationItems";

/** 頂欄私訊入口：常駐圖示＋未讀數輪詢（30 秒）；0 未讀只顯示入口不顯示數字 */
function DmNavBadge() {
  const [location] = useLocation();
  const unread = trpc.dm.unread.useQuery(undefined, { refetchInterval: 30_000 });
  const n = unread.data?.total ?? 0;
  return (
    <Link href="/chat" className={`badge topbar-nav-link ${location.startsWith("/chat") ? "active" : ""}`} title="私訊——與同組夥伴一對一聊天" aria-current={location.startsWith("/chat") ? "page" : undefined}>
      <Icon name="MessageCircle" size={14} />
      <span className="topbar-quick-label">私訊</span>
      {n > 0 && <span className="dm-nav-unread" aria-label={`${n} 則未讀私訊`}>{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}

/**
 * High-frequency topbar navigation: DM entry + data-driven quick links
 * (筆記排程／資料庫／怎麼用). Special badges (pending / points / account) stay outside.
 */
export function PrimaryNavigation() {
  const [location] = useLocation();
  return (
    <>
      <DmNavBadge />
      {/* 高頻入口常駐頂欄：筆記排程／資料庫是天天用的工具，從使用者選單升上來一鍵可達；
       * 手機空間吃緊時標籤收成純圖示（topbar-quick-label），title/aria 仍保留 */}
      {topbarNavItems.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className={`badge topbar-nav-link ${location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href)) ? "active" : ""}`}
          title={item.title}
          aria-current={location === item.href || (item.href !== "/dashboard" && location.startsWith(item.href)) ? "page" : undefined}
        >
          {item.icon && <Icon name={item.icon} size={14} />}
          <span className={item.key === "help" ? "topbar-help-label" : "topbar-quick-label"}>{item.label}</span>
        </Link>
      ))}
    </>
  );
}
