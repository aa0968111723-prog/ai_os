/**
 * Data-driven navigation items for App Shell (TD-06).
 * Optional `capability` is reserved for TD-05b gating — missing capability means always eligible.
 */

import type { IconName } from "../../components/Icon";

export type NavSection = "topbar" | "help" | "work" | "manage" | "account";

export type NavigationItem = {
  key: string;
  label: string;
  href: string;
  /** Future TD-05b: when present, shell may hide item if capability not granted */
  capability?: string;
  section: NavSection;
  /** Icon name matching `Icon` component */
  icon?: IconName;
  /** Extra title/tooltip when rendered as a badge or menu item */
  title?: string;
  /**
   * Soft role gate used today (until capability map lands).
   * - admin: team admin / super admin only
   * - activeLeader: leader/admin of the active group
   * - org: any leader/admin in any group (canSeeOrg)
   */
  require?: "admin" | "activeLeader" | "org";
};

/** High-frequency topbar quick links (excluding special badge components like DM/pending/points). */
export const topbarNavItems: NavigationItem[] = [
  {
    key: "planner",
    label: "筆記排程",
    href: "/planner",
    section: "topbar",
    icon: "Clock",
    title: "筆記排程——把筆記排進待辦與行程",
  },
  {
    key: "databases",
    label: "資料庫",
    href: "/databases",
    section: "topbar",
    icon: "Package",
    title: "資料庫——你的素材與資料集",
  },
  {
    key: "help",
    label: "怎麼用",
    href: "/help",
    section: "topbar",
    icon: "HelpCircle",
    title: "怎麼用——白話說明與常見問題",
  },
];

/** Account menu items, grouped by section. Order within each section is render order. */
export const accountMenuItems: NavigationItem[] = [
  // 說明
  { key: "help", label: "怎麼用", href: "/help", section: "help", icon: "HelpCircle" },
  { key: "models", label: "模型指南", href: "/models", section: "help", icon: "Info" },
  // 工作
  { key: "mcp", label: "接上外部 AI", href: "/mcp", section: "work", icon: "Sparkles" },
  { key: "integrations", label: "連接的資料來源", href: "/integrations", section: "work", icon: "Package" },
  { key: "downloads", label: "共用文件下載", href: "/downloads", section: "work", icon: "FileText" },
  // 管理（require gates mirror previous JSX conditions）
  {
    key: "options",
    label: "選項",
    href: "/options",
    section: "manage",
    icon: "Ellipsis",
    require: "activeLeader",
    capability: "options.edit",
  },
  {
    key: "members",
    label: "通訊錄",
    href: "/members",
    section: "manage",
    icon: "User",
    require: "org",
    capability: "directory.view",
  },
  {
    key: "logs",
    label: "監控與紀錄",
    href: "/logs",
    section: "manage",
    icon: "FileText",
    require: "org",
    capability: "audit.view",
  },
  {
    key: "admin",
    label: "團隊管理",
    href: "/admin",
    section: "manage",
    icon: "SlidersHorizontal",
    require: "admin",
    capability: "admin.manage",
  },
  // 帳號（Link-based only; actions like change-password stay in UserMenu)
  {
    key: "my-reports",
    label: "我的回報",
    href: "/my-reports",
    section: "account",
    icon: "MessageCircle",
  },
];

export function filterNavItems(
  items: NavigationItem[],
  flags: { isAdmin: boolean; activeIsLeader: boolean; canSeeOrg: boolean },
): NavigationItem[] {
  return items.filter((item) => {
    if (!item.require) return true;
    if (item.require === "admin") return flags.isAdmin;
    if (item.require === "activeLeader") return flags.activeIsLeader;
    if (item.require === "org") return flags.canSeeOrg;
    return true;
  });
}
