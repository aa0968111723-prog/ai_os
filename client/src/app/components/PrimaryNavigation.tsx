import { Link, useLocation } from "wouter";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { destinationMatch, topbarNavItems, topbarOverflowItems } from "../navigation/navigationItems";

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

function isActive(href: string, match: string[] | undefined, location: string): boolean {
  const prefixes = destinationMatch({ href, match });
  return prefixes.some((prefix) => location === prefix || (prefix !== "/dashboard" && location.startsWith(prefix)));
}

/**
 * 桌機高頻頂欄：今日、排程、資料中心、說明中心、私訊。
 * 創作室／靈感／下載改到「進階」溢位，不再當全站一級。
 */
export function PrimaryNavigation() {
  const [location] = useLocation();
  const overflowActive = topbarOverflowItems.some((item) => isActive(item.href, undefined, location));
  return (
    <>
      <DmNavBadge />
      {topbarNavItems.map((item) => {
        const active = isActive(item.href, item.key === "help" ? ["/help", "/models"] : undefined, location);
        return (
          <Link
            key={item.key}
            href={item.href}
            className={`badge topbar-nav-link ${active ? "active" : ""}`}
            title={item.title}
            aria-current={active ? "page" : undefined}
          >
            {item.icon && <Icon name={item.icon} size={14} />}
            <span className={item.key === "help" ? "topbar-help-label" : "topbar-quick-label"}>{item.label}</span>
          </Link>
        );
      })}
      <details className="topbar-overflow">
        <summary className={`badge topbar-nav-link${overflowActive ? " active" : ""}`}>
          <Icon name="Ellipsis" size={14} />
          <span className="topbar-quick-label">進階</span>
        </summary>
        <div className="topbar-overflow__menu" role="group" aria-label="進階工具">
          {topbarOverflowItems.map((item) => {
            const active = isActive(item.href, undefined, location);
            return (
              <Link
                key={item.key}
                href={item.href}
                className={`menu-item${active ? " active" : ""}`}
                title={item.title}
                aria-current={active ? "page" : undefined}
              >
                {item.icon && <Icon name={item.icon} size={15} />}
                {item.label}
              </Link>
            );
          })}
        </div>
      </details>
    </>
  );
}
