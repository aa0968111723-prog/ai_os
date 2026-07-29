import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Icon } from "../../components/Icon";
import { canShowInstallUi, isIosDevice, isStandaloneApp, promptInstall, subscribeInstallUi } from "../../pwa";
import type { MeWithCapabilities } from "../../capabilities";
import { accountMenuItems, filterNavItems } from "../navigation/navigationItems";

function InstallAppMenuItem({ onDone }: { onDone: () => void }) {
  const [, bump] = useState(0);
  useEffect(() => subscribeInstallUi(() => bump((n) => n + 1)), []);
  if (isStandaloneApp() || !canShowInstallUi()) return null;
  return (
    <button type="button" className="menu-item" role="menuitem" onClick={() => {
      onDone();
      if (isIosDevice()) { window.alert("iPhone／iPad：請用 Safari 點分享 →「加入主畫面」，再從主畫面圖示開啟。"); return; }
      void promptInstall();
    }}>
      <Icon name="Download" size={15} />安裝成 App
    </button>
  );
}

export type AccountMenuProps = {
  userName: string;
  /** auth.me — TD-05b capability 閘門 */
  me?: MeWithCapabilities;
  activeGroupId?: string | null;
  isAdmin: boolean;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
  onChangePw: () => void;
  onNotifSettings: () => void;
  onLogout: () => void;
  loggingOut: boolean;
};

/** 使用者選單（收斂頂欄）：說明／工作／管理／帳號四組收進單一下拉，管理組僅組長／管理員可見。
 * CSP 下自製（無外部庫）：點外面或 Esc 關閉。 */
export function AccountMenu({
  userName, me, activeGroupId, isAdmin, activeIsLeader, canSeeOrg, onChangePw, onNotifSettings, onLogout, loggingOut,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const menuItems = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    const focusItem = (index: number) => {
      const items = menuItems();
      if (!items.length) return;
      items[(index + items.length) % items.length]?.focus();
    };
    const frame = requestAnimationFrame(() => focusItem(0));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const items = menuItems();
      const current = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") { e.preventDefault(); focusItem(current + 1); }
      if (e.key === "ArrowUp") { e.preventDefault(); focusItem(current - 1); }
      if (e.key === "Home") { e.preventDefault(); focusItem(0); }
      if (e.key === "End") { e.preventDefault(); focusItem(items.length - 1); }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const close = () => setOpen(false);

  const filterCtx = { isAdmin, activeIsLeader, canSeeOrg, me, activeGroupId };
  const helpItems = filterNavItems(accountMenuItems.filter((i) => i.section === "help"), filterCtx);
  const workItems = filterNavItems(accountMenuItems.filter((i) => i.section === "work"), filterCtx);
  const manageItems = filterNavItems(accountMenuItems.filter((i) => i.section === "manage"), filterCtx);
  const accountLinkItems = filterNavItems(accountMenuItems.filter((i) => i.section === "account"), filterCtx);

  return (
    <div className="menu-wrap account-menu" ref={wrap}>
      <button ref={triggerRef} className="badge account-menu__trigger" aria-haspopup="menu" aria-expanded={open} title={userName} onClick={() => setOpen((v) => !v)}>
        <Icon name="User" size={14} />
        <span className="account-menu__name">{userName}</span>
        <Icon name="ChevronDown" size={14} className="account-menu__chevron" />
      </button>
      {open && (
        <div ref={menuRef} className="menu" role="menu" aria-label="使用者選單">
          {/* 分組＋分隔線：說明／工作／管理／帳號——扁平長清單太難掃（回饋 W1）。
           * 筆記排程／資料庫是高頻入口，已升到頂欄常駐，故不再列進「工作」；
           * 權限限定的選項／通訊錄／監控／團隊管理獨立成「管理」組，一般組員整段不顯示。 */}
          <div className="menu-label" role="presentation">說明</div>
          {helpItems.map((item) => (
            <Link key={item.key} href={item.href} className="menu-item" role="menuitem" onClick={close}>
              {item.icon && <Icon name={item.icon} size={15} />}{item.label}
            </Link>
          ))}
          <div className="menu-sep" />
          <div className="menu-label" role="presentation">工作</div>
          {workItems.map((item) => (
            <Link key={item.key} href={item.href} className="menu-item" role="menuitem" onClick={close}>
              {item.icon && <Icon name={item.icon} size={15} />}{item.label}
            </Link>
          ))}
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
          <a href="/api/me/export" download className="menu-item" role="menuitem" title="下載一份你個人資料的可讀備份（含生成紀錄、留言、筆記、排程；不含密碼）" onClick={close}><Icon name="Download" size={15} />匯出我的個人資料</a>
          <button className="menu-item" role="menuitem" onClick={() => { close(); onNotifSettings(); }}><Icon name="Bell" size={15} />連結手機與電腦</button>
          <button className="menu-item" role="menuitem" onClick={() => { close(); onChangePw(); }}><Icon name="Lock" size={15} />改密碼</button>
          <button className="menu-item danger" role="menuitem" disabled={loggingOut} onClick={() => { close(); onLogout(); }}>
            <Icon name="Undo2" size={15} />{loggingOut ? "登出中…" : "登出"}
          </button>
        </div>
      )}
    </div>
  );
}
