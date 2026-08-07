/**
 * Data-driven navigation items for App Shell (TD-06 / TD-05b).
 * Prefer Policy capability gates when auth.me has capabilities data;
 * unknown UI-only capability strings fall back to soft `require` flags.
 */

import type { IconName } from "../../components/Icon";
import {
  hasCap,
  hasCapInAnyGroup,
  isPolicyCapability,
  meHasCapabilitiesData,
  type MeWithCapabilities,
} from "../../capabilities";

export type NavSection = "topbar" | "help" | "work" | "manage" | "account";

export type NavigationItem = {
  key: string;
  label: string;
  href: string;
  /**
   * Capability gate (TD-05b). Prefer PolicyEngine Capability strings when possible.
   * - Known Policy caps: checked via hasCap / hasCapInAnyGroup when me has capability data
   * - UI-only strings (not in Policy set): fall back to `require` flags
   * - Missing capability: always eligible (or only gated by require)
   */
  capability?: string;
  section: NavSection;
  /** Icon name matching `Icon` component */
  icon?: IconName;
  /** Extra title/tooltip when rendered as a badge or menu item */
  title?: string;
  /**
   * Soft role gate — used when capability data is absent, or capability is UI-only.
   * - admin: team admin / super admin only
   * - activeLeader: leader/admin of the active group
   * - org: any leader/admin in any group (canSeeOrg)
   */
  require?: "admin" | "activeLeader" | "org";
};

/** High-frequency topbar quick links (excluding special badge components like DM/pending/points). */
export const topbarNavItems: NavigationItem[] = [
  {
    key: "dashboard",
    label: "今日",
    href: "/dashboard",
    section: "topbar",
    icon: "CheckCircle2",
    title: "今日工作台——待處理、AI 進度與最近專案",
  },
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
    key: "studio",
    label: "創作室",
    href: "/studio",
    section: "topbar",
    icon: "Brush",
    title: "動畫創作室——手繪大白板與順序分鏡表",
  },
  {
    key: "community",
    label: "靈感",
    href: "/community",
    section: "topbar",
    icon: "Sparkles",
    title: "靈感頻道——全站共用提示詞與多模態素材（Flow TV 風格）",
  },
  {
    key: "help",
    label: "說明",
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
  { key: "studio", label: "動畫創作室", href: "/studio", section: "work", icon: "Brush" },
  { key: "community", label: "靈感頻道", href: "/community", section: "work", icon: "Sparkles" },
  { key: "mcp", label: "接上外部 AI", href: "/mcp", section: "work", icon: "Sparkles" },
  { key: "integrations", label: "連接的資料來源", href: "/integrations", section: "work", icon: "Package" },
  { key: "downloads", label: "共用文件下載", href: "/downloads", section: "work", icon: "FileText" },
  // 管理（capability 對齊 PolicyEngine；UI-only 字串保留 require 回退）
  // 註：「選項」不再放進選單——選項改成「在需要的地方就地新增」（建立專案表單、世界觀 chips）。
  // /options 仍是可用路由（改名／停用／排序的整理頁），由那些就地新增處的連結進入。
  {
    key: "members",
    label: "通訊錄",
    href: "/members",
    section: "manage",
    icon: "User",
    require: "org",
    // UI-only：Policy 無 directory.view；有 capability 資料時仍回退 require（team.view 組員也有，不能當閘）
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
    capability: "team.manage",
  },
  // 帳號（Link-based only; actions like change-password stay in UserMenu)
  {
    key: "settings",
    label: "個人設定",
    href: "/settings",
    section: "account",
    icon: "User",
  },
  {
    key: "my-reports",
    label: "我的回報",
    href: "/my-reports",
    section: "account",
    icon: "MessageCircle",
  },
];

/** Soft role flags — also used when capability data is missing or capability is UI-only. */
export type NavFilterFlags = {
  isAdmin: boolean;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
};

export type NavFilterContext = NavFilterFlags & {
  /** auth.me（含 capabilities）；有資料時優先 capability 閘門 */
  me?: MeWithCapabilities;
  /** 作用中組：activeLeader／組級 capability 用 */
  activeGroupId?: string | null;
};

function matchesRequire(item: NavigationItem, flags: NavFilterFlags): boolean {
  if (!item.require) return true;
  if (item.require === "admin") return flags.isAdmin;
  if (item.require === "activeLeader") return flags.activeIsLeader;
  if (item.require === "org") return flags.canSeeOrg;
  return true;
}

/**
 * Filter nav items by capability (preferred) or soft require flags.
 * - Policy capability + require activeLeader → hasCap(me, activeGroupId, cap)
 * - Policy capability + org/admin → hasCapInAnyGroup(me, cap)
 * - UI-only / unknown capability → require flags
 * - No capability data on me → require flags (pre-TD-05a 相容)
 */
export function filterNavItems(
  items: NavigationItem[],
  ctx: NavFilterContext,
): NavigationItem[] {
  return items.filter((item) => {
    if (item.capability && meHasCapabilitiesData(ctx.me) && isPolicyCapability(item.capability)) {
      if (item.require === "activeLeader") {
        return hasCap(ctx.me, ctx.activeGroupId, item.capability);
      }
      // org-wide (members/logs) and admin: any group or global
      return hasCapInAnyGroup(ctx.me, item.capability);
    }
    return matchesRequire(item, ctx);
  });
}
