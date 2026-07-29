import { Link, useLocation } from "wouter";
import { Icon, type IconName } from "../../components/Icon";

const ITEMS: { href: string; label: string; icon: IconName; match: string[] }[] = [
  { href: "/dashboard", label: "今日", icon: "CheckCircle2", match: ["/dashboard"] },
  { href: "/dashboard#projects", label: "專案", icon: "Package", match: ["/p/"] },
  { href: "/dashboard#ai-work", label: "AI 工作", icon: "Sparkles", match: [] },
  { href: "/planner", label: "排程", icon: "Clock", match: ["/planner"] },
  { href: "/databases", label: "資料", icon: "Database", match: ["/databases"] },
];

export function MobileNavigation() {
  const [location] = useLocation();
  return (
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
    </nav>
  );
}
