import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { hasDesktopBridge } from "../../platform/desktopBridge";
import { canOfferInstall, isIosDevice, isStandaloneApp, promptInstall, subscribeInstallUi } from "../../pwa";
import type { MeWithCapabilities } from "../../capabilities";
import { accountMenuItems, filterNavItems } from "../navigation/navigationItems";
import { Hint, Meta, Skeleton } from "../../components/ui";
import { MenuSurface, MENU_SHEET_MQ } from "./MenuSurface";
import { useMatchMedia } from "../../lib/useMatchMedia";

function InstallAppMenuItem({ onDone }: { onDone: () => void }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeInstallUi(() => bump((n) => n + 1)), []);
  // 用 canOfferInstall：關掉橫幅後選單仍要看得到入口
  if (isStandaloneApp() || !canOfferInstall()) return null;
  return (
    <button type="button" className="menu-item" role="menuitem" onClick={() => {
      onDone();
      if (isIosDevice()) {
        // iOS 無法程式觸發安裝；導去說明頁完整步驟（含推播）
        window.location.assign("/help#help-install");
        return;
      }
      void promptInstall();
    }}>
      <Icon name="Download" size={15} />安裝成 App
    </button>
  );
}

/** 簡易用量進度條：quota 為 null＝不限則只顯示已用、不畫上限 */
function QuotaBar({
  label,
  used,
  quota,
}: {
  label: string;
  used: number;
  quota: number | null;
}) {
  const limited = quota != null && quota > 0;
  const pct = limited ? Math.min(100, Math.round((used / quota) * 100)) : 0;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 11 }}>
        <Meta>{label}</Meta>
        <span className="mono" style={{ fontSize: 11 }}>
          {used.toLocaleString()}
          {limited ? ` / ${quota.toLocaleString()}` : "（不限）"}
        </span>
      </div>
      {limited && (
        <div
          aria-hidden
          style={{
            marginTop: 3,
            height: 4,
            borderRadius: 999,
            background: "var(--border-soft)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              borderRadius: 999,
              background: pct >= 90 ? "var(--gold-ink)" : "var(--primary)",
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * 帳號選單內個人點數摘要（強化 quota.my 展示）。
 * 今日已用、本週已用、週／日額度、個人／組預算剩餘——與頂欄徽章互補、單位皆為站內點。
 */
function PersonalQuotaSummary({ groupId, enabled }: { groupId?: string | null; enabled: boolean }) {
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
        <Skeleton style={{ height: 48 }} />
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
    <div
      className="account-menu__quota"
      role="presentation"
      style={{
        padding: "8px 12px 10px",
        borderBottom: "1px solid var(--border-soft)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 12 }}>我的點數</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>
          {tightRemaining == null ? "不限" : `剩 ${tightRemaining.toLocaleString()} 點`}
        </span>
      </div>
      <QuotaBar label="今日已用" used={d.dailyUsed} quota={d.dailyQuota} />
      <QuotaBar label="本週已用" used={d.weeklyUsed} quota={d.weeklyQuota} />
      {(d.memberBudgetRemaining != null || d.groupBudgetRemaining != null) && (
        <Meta as="div" style={{ marginTop: 6, fontSize: 11, lineHeight: 1.4 }}>
          {d.memberBudgetRemaining != null && (
            <div>個人預算剩 {d.memberBudgetRemaining.toLocaleString()} 點</div>
          )}
          {d.groupBudgetRemaining != null && (
            <div>本組預算剩 {d.groupBudgetRemaining.toLocaleString()} 點</div>
          )}
        </Meta>
      )}
      <Hint as="div" style={{ marginTop: 4, fontSize: 10 }}>
        單位為站內點數（非 Fal USD）
      </Hint>
    </div>
  );
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
  onChangePw: () => void;
  onNotifSettings: () => void;
  onLogout: () => void;
  /** 登出全部裝置（他機 session 全撤；本機換發新 cookie） */
  onLogoutAll?: () => void;
  loggingOut: boolean;
};

/** 使用者選單（收斂頂欄）：說明／工作／管理／帳號四組收進單一下拉，管理組僅組長／管理員可見。
 * CSP 下自製（無外部庫）：點外面或 Esc 關閉。
 *
 * 手機（≤820px）少列「說明／工作」兩組——那裡底部分頁列的「更多」面板就是全站頁面總表，
 * 兩邊各列一次同一批頁面（而且曾經各叫各的名字）正是使用者說的「選單有點亂」。
 * 手機上的分工：**下面的「更多」＝去哪裡，右上角頭像＝我與團隊**（點數、管理、帳號設定）。 */
export function AccountMenu({
  userName, avatarUrl, me, activeGroupId, isAdmin, activeIsLeader, canSeeOrg, onChangePw, onNotifSettings, onLogout, onLogoutAll, loggingOut,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // 外點／Esc／方向鍵漫遊／手機貼底 sheet 全收在 MenuSurface（見該檔的三個陷阱說明）
  const close = useCallback(() => setOpen(false), []);

  const filterCtx = { isAdmin, activeIsLeader, canSeeOrg, me, activeGroupId };
  const helpItems = filterNavItems(accountMenuItems.filter((i) => i.section === "help"), filterCtx);
  const workItems = filterNavItems(accountMenuItems.filter((i) => i.section === "work"), filterCtx);
  const manageItems = filterNavItems(accountMenuItems.filter((i) => i.section === "manage"), filterCtx);
  const accountLinkItems = filterNavItems(accountMenuItems.filter((i) => i.section === "account"), filterCtx);
  const desktop = hasDesktopBridge();
  // 與 MenuSurface 同一條斷點：手機時選單本身變 sheet，底部分頁列的「更多」也同時存在
  const compact = useMatchMedia(MENU_SHEET_MQ);

  return (
    <div className="menu-wrap account-menu">
      <button ref={triggerRef} className="badge account-menu__trigger" aria-haspopup="menu" aria-expanded={open} title={userName} onClick={() => setOpen((v) => !v)}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" style={{ width: 16, height: 16, borderRadius: "50%", objectFit: "cover" }} />
        ) : (
          <Icon name="User" size={14} />
        )}
        <span className="account-menu__name">{userName}</span>
        <Icon name="ChevronDown" size={14} className="account-menu__chevron" />
      </button>
      <MenuSurface open={open} onClose={close} label="使用者選單" triggerRef={triggerRef} className="account-menu__menu">
          {/* 身分標頭：手機 sheet 打開先看到「這是誰的選單」；桌機同樣受益 */}
          <div className="account-menu__id" role="presentation">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: "50%", objectFit: "cover", marginRight: 6 }} />
            ) : (
              <span className="account-menu__avatar" aria-hidden><Icon name="User" size={17} /></span>
            )}
            <strong>{userName}</strong>
          </div>
          {/* 個人點數摘要：今日／本週用量與剩餘（quota.my）；與頂欄徽章互補 */}
          <PersonalQuotaSummary groupId={activeGroupId} enabled={open} />
          {/* 分組＋分隔線：說明／工作／管理／帳號——扁平長清單太難掃（回饋 W1）。
           * 筆記排程／資料庫是高頻入口，已升到頂欄常駐，故不再列進「工作」；
           * 權限限定的選項／通訊錄／監控／團隊管理獨立成「管理」組，一般組員整段不顯示。 */}
          {compact ? (
            /* 手機：頁面入口全歸「更多」面板，這裡只留一句指路，免得有人在頭像下面翻找靈感頻道 */
            <div className="menu-note" role="presentation">
              {/* 不再點名「資料庫」：它已改為情境化入口（在專案頁需要時就地出現），
                  不在「更多」面板裡——指路文案必須跟著改，否則就是叫人去找不存在的東西。 */}
              <Hint as="span">要去其他頁面（靈感頻道、動畫創作室、怎麼用…）請按最底下的「更多」</Hint>
            </div>
          ) : (
            <>
              <div className="menu-label" role="presentation">說明</div>
              {helpItems.map((item) => (
                <Link key={item.key} href={item.href} className="menu-item" role="menuitem" onClick={close}>
                  {item.icon && <Icon name={item.icon} size={15} />}{item.label}
                </Link>
              ))}
              <div className="menu-sep" />
              <div className="menu-label" role="presentation">工作</div>
              {desktop ? (
                <Link href="/desktop" className="menu-item" role="menuitem" onClick={close}>
                  <Icon name="Monitor" size={15} />桌面剪輯連接
                </Link>
              ) : (
                <Link href="/downloads#desktop-app" className="menu-item" role="menuitem" onClick={close}>
                  <Icon name="Download" size={15} />下載電腦版應用程式
                </Link>
              )}
              {workItems.map((item) => (
                <Link key={item.key} href={item.href} className="menu-item" role="menuitem" onClick={close}>
                  {item.icon && <Icon name={item.icon} size={15} />}{item.label}
                </Link>
              ))}
            </>
          )}
          {/* 管理組：只要在任一組是組長或管理員（canSeeOrg）就顯示整段；段內各項再依細權限收放，
           * 團隊管理限管理員（isAdmin）、選項限作用組組長（activeIsLeader）。canSeeOrg 為兩者的聯集，
           * 故整段用它當閘門時，段內至少會有通訊錄／監控兩項，不會出現只有標題的空組。 */}
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
          <div className="menu-label" role="presentation">帳號</div>
          <InstallAppMenuItem onDone={close} />
          {accountLinkItems.map((item) => (
            <Link key={item.key} href={item.href} className="menu-item" role="menuitem" onClick={close}>
              {item.icon && <Icon name={item.icon} size={15} />}{item.label}
            </Link>
          ))}
          {/* 個人資料匯出（端點 /api/me/export 由後端提供）：a 標籤直下載，不經前端路由。
           * 文案／圖示刻意與「工作」組的「共用文件下載」明確區隔——前者是團隊共用文件、後者是「你自己的」個資可讀複本，
           * 舊版兩者都叫「資料下載／下載我的資料」又都像下載，非技術創作者分不清（使用者回饋）。 */}
          <a href="/api/me/export" download className="menu-item" role="menuitem" title="下載你的可讀資料備份：帳號、組別、相關專案（世界觀／分鏡／知識／角色／場景）、生成、留言、筆記、排程；不含密碼與媒體二進位檔" onClick={close}><Icon name="Download" size={15} />匯出我的個人資料</a>
          <button className="menu-item" role="menuitem" onClick={() => { close(); onNotifSettings(); }}><Icon name="Bell" size={15} />連結手機與電腦</button>
          <button className="menu-item" role="menuitem" onClick={() => { close(); onChangePw(); }}><Icon name="Lock" size={15} />改密碼</button>
          {onLogoutAll && (
            <button
              className="menu-item danger"
              role="menuitem"
              disabled={loggingOut}
              title="撤銷所有裝置的登入；本裝置會立刻換發新工作階段繼續使用"
              onClick={() => {
                close();
                if (window.confirm("要登出全部裝置嗎？其他手機／電腦需重新登入；本裝置會繼續保持登入。")) {
                  onLogoutAll();
                }
              }}
            >
              <Icon name="Smartphone" size={15} />{loggingOut ? "處理中…" : "登出全部裝置"}
            </button>
          )}
          <button className="menu-item danger" role="menuitem" disabled={loggingOut} onClick={() => { close(); onLogout(); }}>
            <Icon name="Undo2" size={15} />{loggingOut ? "登出中…" : "登出"}
          </button>
      </MenuSurface>
    </div>
  );
}
