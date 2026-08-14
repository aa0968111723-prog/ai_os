import { Link, useLocation } from "wouter";
import { trpc } from "../../api";
import type { MeWithCapabilities } from "../../capabilities";
import { BrandLogo } from "../../components/BrandLogo";
import { Icon } from "../../components/Icon";
import { AccountMenu } from "./AccountMenu";
import { AssistantLauncher } from "./AssistantLauncher";
import { OnlinePresenceMenu } from "./OnlinePresenceMenu";
import { PendingApprovalsBadge } from "./PendingApprovalsBadge";
import { NotifyBell } from "./NotifyBell";
import { PrimaryNavigation } from "./PrimaryNavigation";
import { Badge } from "../../components/ui";

/** 彈性點數徽章：剩餘 or 不限（管理員可在團隊管理調整）
 *  強化展示：週／日已用與額度寫入 title；無週額時仍顯示本週已用（站內點，非 Fal USD）。 */
function PointsBadge({ groupId }: { groupId: string }) {
  // enabled 等組別就緒才查——避免首載以 undefined 先打一輪造成「週額度閃爍」
  const my = trpc.quota.my.useQuery({ groupId: groupId || undefined }, { refetchInterval: 60_000, enabled: !!groupId });
  if (my.error) {
    return (
      <Link href="/settings#quota" className="status-chip" title="點數暫時讀不到，稍後會自動重試" aria-label="點數暫時讀不到，查看明細">
        <Icon name="Gem" size={14} /><span className="mono">—</span>
      </Link>
    );
  }
  if (!my.data) return null;
  const { totalRemaining, weeklyQuota, weeklyUsed, dailyQuota, dailyUsed, memberBudgetRemaining, groupBudgetRemaining } = my.data;
  // 徽章主數字＝最緊的「累計剩餘」：個人分配 → 組預算 → 全域總預算（任一為 null 即該層不限）
  const caps = [memberBudgetRemaining, groupBudgetRemaining, totalRemaining].filter((v): v is number => v != null);
  const label = caps.length > 0 ? `剩 ${Math.min(...caps).toLocaleString()}` : "不限";
  // 有額度顯示 used/quota；無週額仍顯示「週已用 N」讓用量可見
  const weekly =
    weeklyQuota != null
      ? `・週 ${weeklyUsed}/${weeklyQuota}`
      : weeklyUsed > 0
        ? `・週已用 ${weeklyUsed}`
        : "";
  const daily =
    dailyQuota != null
      ? `・日 ${dailyUsed}/${dailyQuota}`
      : dailyUsed > 0
        ? `・日已用 ${dailyUsed}`
        : "";
  // 標題點明「剩」指的是哪一層，避免組長/組員把個人分配誤讀成全系統剩餘
  const source = memberBudgetRemaining != null && memberBudgetRemaining === Math.min(...(caps.length ? caps : [Infinity]))
    ? "你的個人分配"
    : groupBudgetRemaining != null && groupBudgetRemaining === Math.min(...(caps.length ? caps : [Infinity]))
    ? "本組組預算"
    : "全系統總預算";
  const detailParts = [
    caps.length > 0 ? `最緊剩餘（${source}）` : "累計不限",
    `今日已用 ${dailyUsed}${dailyQuota != null ? `／日額 ${dailyQuota}` : ""}`,
    `本週已用 ${weeklyUsed}${weeklyQuota != null ? `／週額 ${weeklyQuota}` : ""}`,
    memberBudgetRemaining != null ? `個人預算剩 ${memberBudgetRemaining}` : null,
    groupBudgetRemaining != null ? `組預算剩 ${groupBudgetRemaining}` : null,
    "單位：站內點數",
  ].filter(Boolean);
  return (
    <Link
      href="/settings#quota"
      className="status-chip points-badge"
      title={detailParts.join("；")}
      aria-label={`點數${label}${weekly}${daily}。查看明細`}
    >
      <Icon name="Gem" size={14} />
      <span className="mono"><span>{label}</span><span className="points-badge__cadence">{weekly}{daily}</span></span>
    </Link>
  );
}

export type AppHeaderGroup = {
  groupId: string;
  teamName: string;
  groupName: string;
  role: string;
};

export type AppHeaderProps = {
  /** When null/undefined, only brand is shown (pre-auth / loading). */
  userName?: string;
  avatarUrl?: string | null;
  /** auth.me for TD-05b capability-gated account menu */
  me?: MeWithCapabilities;
  groups: AppHeaderGroup[];
  activeGroupId: string;
  onActiveGroupIdChange: (groupId: string) => void;
  isAdmin: boolean;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
  mockMode?: boolean;
  onLogout: () => void;
  loggingOut: boolean;
};

/**
 * Top chrome: brand, group switcher, primary nav, pending/points badges, account menu.
 * Owns no session queries beyond status chips — shell passes auth-derived props.
 */
export function AppHeader({
  userName,
  avatarUrl,
  me,
  groups,
  activeGroupId,
  onActiveGroupIdChange,
  isAdmin,
  activeIsLeader,
  canSeeOrg,
  mockMode,
  onLogout,
  loggingOut,
}: AppHeaderProps) {
  const [location, navigate] = useLocation();
  // `userName !== undefined` mirrors prior `me.data` gating (empty name still shows chrome)
  const signedIn = userName !== undefined;

  return (
    <header className="topbar">
      <Link href="/dashboard" className="brand" aria-label="Aios 今日工作台">
        <BrandLogo variant="full" size="sm" responsive priority />
      </Link>
      {signedIn && groups.length > 0 && (
        <select
          className="group-select"
          aria-label="切換作用中的組別"
          style={{ width: "auto" }}
          value={activeGroupId}
          onChange={(e) => {
            onActiveGroupIdChange(e.target.value);
            // 在專案頁切組：專案屬於前一組，留在原地會出現「頂欄是 B 組、內容是 A 組」的矛盾——導回作業台對齊情境
            if (location.startsWith("/p/")) navigate("/dashboard");
          }}
        >
          {groups.map((g) => (
            <option key={g.groupId} value={g.groupId}>
              {g.teamName}・{g.groupName}
              {g.role === "leader" ? "（組長）" : g.role === "admin" ? "（管理）" : ""}
            </option>
          ))}
        </select>
      )}
      <span className="spacer" />
      <div className="topbar-actions">
      {/* 只在 E2E_MOCK=1（自動化測試）下出現；正式部署一律真實模式，不會再看到這顆徽章 */}
      {signedIn && mockMode && <Badge tone="mock">測試模式</Badge>}
      {/* 桌機唯一的助手入口：底部導覽那顆 orb 在 >820 是 display:none，
          在這顆按鈕出現之前，桌機使用者完全叫不出助手（自己只在 >820 渲染） */}
      {signedIn && <AssistantLauncher groupId={activeGroupId} />}
      {/* 誰在線：常駐頂欄，不必進私訊；與私訊入口分開，避免「要聊天才看得到人在不在」 */}
      {signedIn && <OnlinePresenceMenu />}
      {signedIn && <PrimaryNavigation />}
      {/* 收件匣在待核徽章之前：待核只給組長看，收件匣是每個人都會用的入口 */}
      {signedIn && <NotifyBell />}
      {signedIn && <PendingApprovalsBadge groupId={activeGroupId} />}
      {signedIn && <PointsBadge groupId={activeGroupId} />}
      {signedIn && (
        <AccountMenu
          userName={userName}
          avatarUrl={avatarUrl}
          me={me}
          activeGroupId={activeGroupId}
          isAdmin={isAdmin}
          activeIsLeader={activeIsLeader}
          canSeeOrg={canSeeOrg}
          onLogout={onLogout}
          loggingOut={loggingOut}
        />
      )}
      </div>
    </header>
  );
}
