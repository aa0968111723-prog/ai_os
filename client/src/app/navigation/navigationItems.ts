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

/**
 * 全站「去處」單一真相表。
 *
 * 為什麼要有這張表——同一個頁面在三個選單裡出現過，而且被叫過三個不同名字：
 * `/help` 是頂欄「說明」、使用者選單「怎麼用」、手機更多面板「使用說明」；
 * `/integrations` 是「連接的資料來源」又是「外部資料」；`/downloads` 是
 * 「共用文件下載」又是「共用下載」。使用者回報「選單好像真的有點亂」，
 * 亂的來源就是這個：同一個地方三個名字，看起來像三個不同功能。
 *
 * 現在名稱、說明與圖示一律以本表為準，各選單只決定「露出哪幾個 key」，
 * 不再自己寫字。改名只改這裡一處，三個選單同時跟上。
 */
export type DestinationKey =
  | "dashboard"
  | "planner"
  | "databases"
  | "studio"
  | "community"
  | "chat"
  | "help"
  | "models"
  | "mcp"
  | "integrations"
  | "downloads";

export type Destination = {
  key: DestinationKey;
  /** 全站唯一的顯示名稱——與該頁自己的標題一致 */
  label: string;
  /** 一句話說明「進去可以做什麼」：手機面板的第二行、頂欄的 title */
  description: string;
  href: string;
  icon: IconName;
  /** 判斷「目前就在這裡」的路徑前綴；預設就是 href 本身 */
  match?: string[];
};

export const DESTINATIONS: Record<DestinationKey, Destination> = {
  dashboard: {
    key: "dashboard",
    label: "今日",
    description: "待處理、AI 進度與最近專案",
    href: "/dashboard",
    icon: "CheckCircle2",
  },
  planner: {
    key: "planner",
    label: "筆記排程",
    description: "把筆記排進待辦與行程",
    href: "/planner",
    icon: "Clock",
  },
  databases: {
    key: "databases",
    // 站內以前同時叫過「資料庫」「知識與資料」「資料中心」三個名字（見本表開頭的註解）。
    // 統一為「資料中心」——route 與 internal key 維持 databases，深連結不受影響。
    label: "資料中心",
    description: "所有文件、素材與團隊資料",
    href: "/databases",
    icon: "Database",
  },
  studio: {
    key: "studio",
    label: "動畫創作室",
    description: "手繪白板與順序分鏡表",
    href: "/studio",
    icon: "Brush",
  },
  community: {
    key: "community",
    label: "靈感頻道",
    description: "全站共用提示詞與素材",
    href: "/community",
    icon: "Sparkles",
  },
  chat: {
    key: "chat",
    label: "私訊",
    description: "與夥伴和 AI 協作",
    href: "/chat",
    icon: "MessageCircle",
  },
  help: {
    key: "help",
    label: "怎麼用",
    description: "白話說明與常見問題",
    href: "/help",
    icon: "HelpCircle",
  },
  models: {
    key: "models",
    label: "模型指南",
    description: "每個模型擅長什麼、要花多少點",
    href: "/models",
    icon: "Info",
  },
  mcp: {
    key: "mcp",
    label: "接上外部 AI",
    description: "金鑰、客戶端設定與連線測試",
    href: "/mcp",
    icon: "Bot",
  },
  integrations: {
    key: "integrations",
    // 這一頁不只放資料來源（還有 Adobe、BYOK 等服務），所以定位是「連接與服務」；
    // 日常加入資料不必來這裡——主要工作在資料中心與專案內的「＋加入資料」。
    label: "連接與服務",
    description: "Google、Notion、外部 API 與創作服務",
    href: "/integrations",
    icon: "Waypoints",
  },
  downloads: {
    key: "downloads",
    label: "共用下載",
    description: "團隊共用文件與電腦版程式",
    href: "/downloads",
    icon: "Download",
  },
};

/** 該去處判斷 active 用的路徑前綴 */
export function destinationMatch(d: Pick<Destination, "href" | "match">): string[] {
  return d.match ?? [d.href];
}

/** 由去處表產生選單項目——名稱／圖示／說明都不在呼叫端重寫 */
function fromDestination(key: DestinationKey, section: NavSection): NavigationItem {
  const d = DESTINATIONS[key];
  return {
    key: d.key,
    label: d.label,
    href: d.href,
    section,
    icon: d.icon,
    title: `${d.label}——${d.description}`,
  };
}

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
  fromDestination("dashboard", "topbar"),
  fromDestination("planner", "topbar"),
  fromDestination("databases", "topbar"),
  fromDestination("studio", "topbar"),
  fromDestination("community", "topbar"),
  fromDestination("help", "topbar"),
];

/**
 * 手機底欄一級入口契約（全站導覽去重 PR 1）。
 *
 * 底欄只保留四項：今日、專案、AI 助手、更多。
 * 「筆記排程」不再是底欄一級——`/planner` 的 route、query、hash 與 deep link
 * 全部保留，改由 More 承接，避免與今日頁「安排今天」重複。
 *
 * 所有權（誰是主要入口；舊路徑仍可達）：
 * - dashboard → 底欄「今日」
 * - /dashboard#projects、/p/:id → 底欄「專案」
 * - Global Assistant → 底欄中央 AI 助手（不是 route）
 * - databases / chat → More 第一層
 * - help / models → More「說明中心」
 * - planner / studio / community / integrations / mcp / downloads → More「進階工具」
 */
export const MOBILE_PRIMARY_NAV = ["today", "projects", "assistant", "more"] as const;

/**
 * 手機「更多」第一層（全站導覽去重 PR 3）。
 *
 * 第一層只留四個可理解的目的地／資料夾，不再把底欄塞不下的頁面全部平鋪：
 * 資料中心、私訊、說明中心、進階工具。
 *
 * 資料夾內仍是既有 DESTINATIONS——不刪 route、不造第二套名字。
 * planner 改由今天頁摘要＋進階工具進入；mcp／integrations 依規格回到進階工具
 * （路由與深連結本來就在，只是入口歸位）。
 */
export type MobileMoreFolderId = "help" | "tools";

export type MobileMoreRootItem =
  | { kind: "link"; key: DestinationKey }
  | {
      kind: "folder";
      id: MobileMoreFolderId;
      label: string;
      description: string;
      icon: IconName;
      keys: DestinationKey[];
    };

export const mobileMoreRoot: MobileMoreRootItem[] = [
  { kind: "link", key: "databases" },
  { kind: "link", key: "chat" },
  {
    kind: "folder",
    id: "help",
    label: "說明中心",
    description: "白話說明、常見問題與模型指南",
    icon: "HelpCircle",
    keys: ["help", "models"],
  },
  {
    kind: "folder",
    id: "tools",
    label: "進階工具",
    description: "排程、創作室、整合與下載",
    icon: "SlidersHorizontal",
    keys: ["planner", "studio", "community", "integrations", "mcp", "downloads"],
  },
];

/** 由第一層展開的扁平分組——給測試與「仍可達」契約用，UI 走兩層 sheet。 */
export type MobileMoreGroup = { label: string; keys: DestinationKey[] };

export const mobileMoreGroups: MobileMoreGroup[] = mobileMoreRoot.map((item) =>
  item.kind === "link"
    ? { label: DESTINATIONS[item.key].label, keys: [item.key] }
    : { label: item.label, keys: item.keys },
);

export function mobileMoreReachableKeys(): DestinationKey[] {
  return mobileMoreRoot.flatMap((item) => (item.kind === "link" ? [item.key] : item.keys));
}

/** Account menu items, grouped by section. Order within each section is render order. */
export const accountMenuItems: NavigationItem[] = [
  // 說明／工作＝去處，名稱一律取自 DESTINATIONS（手機由「更多」面板承接，見 AccountMenu）
  fromDestination("help", "help"),
  fromDestination("models", "help"),
  fromDestination("studio", "work"),
  fromDestination("community", "work"),
  fromDestination("mcp", "work"),
  fromDestination("integrations", "work"),
  fromDestination("downloads", "work"),
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
