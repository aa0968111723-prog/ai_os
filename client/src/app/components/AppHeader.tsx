import { Link, useLocation } from "wouter";
import { trpc } from "../../api";
import type { MeWithCapabilities } from "../../capabilities";
import { BrandLogo } from "../../components/BrandLogo";
import { Icon } from "../../components/Icon";
import { AccountMenu } from "./AccountMenu";
import { PendingApprovalsBadge } from "./PendingApprovalsBadge";
import { PrimaryNavigation } from "./PrimaryNavigation";

/** 彈性點數徽章：剩餘 or 不限（管理員可在團隊管理調整） */
function PointsBadge({ groupId }: { groupId: string }) {
  // enabled 等組別就緒才查——避免首載以 undefined 先打一輪造成「週額度閃爍」
  const my = trpc.quota.my.useQuery({ groupId: groupId || undefined }, { refetchInterval: 60_000, enabled: !!groupId });
  if (my.error) return <span className="status-chip" title="點數暫時讀不到，稍後會自動重試"><Icon name="Gem" size={14} /><span className="mono">—</span></span>;
  if (!my.data) return null;
  const { totalRemaining, weeklyQuota, weeklyUsed, dailyQuota, dailyUsed, memberBudgetRemaining, groupBudgetRemaining } = my.data;
  // 徽章主數字＝最緊的「累計剩餘」：個人分配 → 組預算 → 全域總預算（任一為 null 即該層不限）
  const caps = [memberBudgetRemaining, groupBudgetRemaining, totalRemaining].filter((v): v is number => v != null);
  const label = caps.length > 0 ? `剩 ${Math.min(...caps).toLocaleString()}` : "不限";
  const weekly = weeklyQuota != null ? `・週 ${weeklyUsed}/${weeklyQuota}` : "";
  const daily = dailyQuota != null ? `・日 ${dailyUsed}/${dailyQuota}` : "";
  // 標題點明「剩」指的是哪一層，避免組長/組員把個人分配誤讀成全系統剩餘
  const source = memberBudgetRemaining != null && memberBudgetRemaining === Math.min(...(caps.length ? caps : [Infinity]))
    ? "你的個人分配"
    : groupBudgetRemaining != null && groupBudgetRemaining === Math.min(...(caps.length ? caps : [Infinity]))
    ? "本組組預算"
    : "全系統總預算";
  return (
    <span className="status-chip" title={caps.length > 0 ? `顯示最緊的累計剩餘（${source}）；週/日上限每天/每週重置，由管理員與組長調整` : "點數額度由管理員調整；日上限每天重置"}>
      <Icon name="Gem" size={14} /><span className="mono">{label}{weekly}{daily}</span>
    </span>
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
  /** auth.me for TD-05b capability-gated account menu */
  me?: MeWithCapabilities;
  groups: AppHeaderGroup[];
  activeGroupId: string;
  onActiveGroupIdChange: (groupId: string) => void;
  isAdmin: boolean;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
  mockMode?: boolean;
  onChangePw: () => void;
  onNotifSettings: () => void;
  onLogout: () => void;
  loggingOut: boolean;
};

/**
 * Top chrome: brand, group switcher, primary nav, pending/points badges, account menu.
 * Owns no session queries beyond status chips — shell passes auth-derived props.
 */
export function AppHeader({
  userName,
  me,
  groups,
  activeGroupId,
  onActiveGroupIdChange,
  isAdmin,
  activeIsLeader,
  canSeeOrg,
  mockMode,
  onChangePw,
  onNotifSettings,
  onLogout,
  loggingOut,
}: AppHeaderProps) {
  const [location, navigate] = useLocation();
  // `userName !== undefined` mirrors prior `me.data` gating (empty name still shows chrome)
  const signedIn = userName !== undefined;

  return (
    <header className="topbar">
      <Link href="/" className="brand" aria-label="Aios 首頁">
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
            if (location.startsWith("/p/")) navigate("/");
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
      {/* 只在 E2E_MOCK=1（自動化測試）下出現；正式部署一律真實模式，不會再看到這顆徽章 */}
      {signedIn && mockMode && <span className="badge mock">測試模式</span>}
      {signedIn && <PrimaryNavigation />}
      {signedIn && <PendingApprovalsBadge groupId={activeGroupId} />}
      {signedIn && <PointsBadge groupId={activeGroupId} />}
      {/* 頂欄收斂：次要入口（模型指南/接上外部 AI/資料下載/管理組/改密碼）＋登出全收進使用者選單 */}
      {signedIn && (
        <AccountMenu
          userName={userName}
          me={me}
          activeGroupId={activeGroupId}
          isAdmin={isAdmin}
          activeIsLeader={activeIsLeader}
          canSeeOrg={canSeeOrg}
          onChangePw={onChangePw}
          onNotifSettings={onNotifSettings}
          onLogout={onLogout}
          loggingOut={loggingOut}
        />
      )}
    </header>
  );
}
