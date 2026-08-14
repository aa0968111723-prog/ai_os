import { useCallback, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import type { MeWithCapabilities } from "../../capabilities";
import { accountMenuItems, filterNavItems } from "../navigation/navigationItems";
import { Hint, Meta, Skeleton } from "../../components/ui";
import { MenuSurface } from "./MenuSurface";

/**
 * 帳號第一層只留一行點數摘要；完整用量條在 /settings#quota。
 */
function PointsLine({ groupId, enabled, onDone }: { groupId?: string | null; enabled: boolean; onDone: () => void }) {
  const my = trpc.quota.my.useQuery(
    { groupId: groupId || undefined },
    { enabled: enabled && !!groupId, staleTime: 30_000 },
  );
  if (!enabled) return null;
  if (!groupId) {
    return (
      <div className="account-menu__quota" role="presentation" style={{ padding: "8px 12px", fontSize: 12 }}>
        <Hint as="div">選好作用組別後可看個人點數用量</Hint>
      </div>
    );
  }
  if (my.isLoading) {
    return (
      <div className="account-menu__quota" role="presentation" style={{ padding: "8px 12px" }}>
        <Skeleton style={{ height: 28 }} />
      </div>
    );
  }
  if (my.error || !my.data) {
    return (
      <div className="account-menu__quota" role="presentation" style={{ padding: "8px 12px", fontSize: 12 }}>
        <Meta>點數暫時讀不到</Meta>
      </div>
    );
  }
  const d = my.data;
  const caps = [d.memberBudgetRemaining, d.groupBudgetRemaining, d.totalRemaining].filter(
    (v): v is number => v != null,
  );
  const tightRemaining = caps.length > 0 ? Math.min(...caps) : null;
  return (
    <Link
      href="/settings#quota"
      className="menu-item"
      role="menuitem"
      title="查看點數明細"
      onClick={onDone}
    >
      <Icon name="Gem" size={15} />
      <span style={{ display: "grid", gap: 2 }}>
        <span>點數 {tightRemaining == null ? "不限" : `剩 ${tightRemaining.toLocaleString()}`}</span>
        <Meta as="span" style={{ fontSize: 11 }}>查看明細</Meta>
      </span>
    </Link>
  );
}

function roleLabel(isAdmin: boolean, activeIsLeader: boolean): string {
  if (isAdmin) return "管理員";
  if (activeIsLeader) return "組長";
  return "組員";
}

export type AccountMenuProps = {
  userName: string;
  avatarUrl?: string | null;
  /** auth.me — TD-05b capability 閘門 */
  me?: MeWithCapabilities;
  activeGroupId?: string | null;
  isAdmin: boolean;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
  onLogout: () => void;
  loggingOut: boolean;
};

/**
 * 帳號選單第一層（全站導覽去重 PR 3）：
 * 身份與角色、點數一行、個人設定、有權限才出現的管理、登出。
 *
 * 改密碼／通知／裝置／匯出／登出全部裝置已移入 /settings，避免頭像第一層長距離捲動。
 * 去處（怎麼用、靈感頻道、下載…）不再重複列在這裡——桌機走頂欄，手機走「更多」。
 */
export function AccountMenu({
  userName, avatarUrl, me, activeGroupId, isAdmin, activeIsLeader, canSeeOrg, onLogout, loggingOut,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const filterCtx = { isAdmin, activeIsLeader, canSeeOrg, me, activeGroupId };
  const manageItems = filterNavItems(accountMenuItems.filter((i) => i.section === "manage"), filterCtx);
  const accountLinkItems = filterNavItems(
    accountMenuItems.filter((i) => i.section === "account" && i.key === "settings"),
    filterCtx,
  );

  return (
    <div className="menu-wrap account-menu">
      <button
        ref={triggerRef}
        className="badge account-menu__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${userName}的帳號選單`}
        title={userName}
        onClick={() => setOpen((v) => !v)}
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <Icon name="User" size={14} />
        )}
        <span className="account-menu__name">{userName}</span>
        <Icon name="ChevronDown" size={14} className="account-menu__chevron" />
      </button>
      <MenuSurface open={open} onClose={close} label="使用者選單" triggerRef={triggerRef} className="account-menu__menu">
          <div className="account-menu__id" role="presentation">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", marginRight: 6 }} />
            ) : (
              <span className="account-menu__avatar" aria-hidden><Icon name="User" size={17} /></span>
            )}
            <span style={{ display: "grid", minWidth: 0 }}>
              <strong>{userName}</strong>
              <Meta as="span" style={{ fontSize: 11 }}>{roleLabel(isAdmin, activeIsLeader)}</Meta>
            </span>
          </div>
          <PointsLine groupId={activeGroupId} enabled={open} onDone={close} />
          {canSeeOrg && manageItems.length > 0 && (
            <>
              <div className="menu-sep" />
              <div className="menu-label" role="presentation">管理</div>
              {manageItems.map((item) => (
                <Link key={item.key} href={item.href} className="menu-item" role="menuitem" onClick={close}>
                  {item.icon && <Icon name={item.icon} size={15} />}{item.label}
                </Link>
              ))}
            </>
          )}
          <div className="menu-sep" />
          {accountLinkItems.map((item) => (
            <Link key={item.key} href={item.href} className="menu-item" role="menuitem" onClick={close}>
              {item.icon && <Icon name={item.icon} size={15} />}{item.label}
            </Link>
          ))}
          <button className="menu-item danger" role="menuitem" disabled={loggingOut} onClick={() => { close(); onLogout(); }}>
            <Icon name="Undo2" size={15} />{loggingOut ? "登出中…" : "登出"}
          </button>
      </MenuSurface>
    </div>
  );
}
