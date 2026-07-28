import { Suspense, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { trpc } from "../api";
import { FeedbackWidget } from "../feedback/FeedbackWidget";
import { NotificationSettingsDialog, PushSubscriptionSync } from "../components/NotificationSettings";
import { unsubscribeThisDevice } from "../push";
import { Icon } from "../components/Icon";
import { BrandLogo } from "../components/BrandLogo";
import { SplashScreen } from "../components/SplashScreen";
import { canShowInstallUi, isIosDevice, isStandaloneApp, promptInstall, subscribeInstallUi } from "../pwa";
import { ChangePasswordDialog } from "./session/ChangePasswordDialog";
import { SessionGate } from "./SessionGate";
import { accountMenuItems, filterNavItems, topbarNavItems } from "./navigation/navigationItems";

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

/**
 * 頂欄待辦徽章（UX 高：頂欄完全不顯示待審/待核→多專案組長必然漏審）：
 * 作用組的「分鏡待審＋生成待核」總數。點鈴鐺展開通知清單，逐案列出是哪個專案、
 * 各差幾筆，點某一列直接跳到該專案；也保留「回作業台看全部」。0 筆不佔版面。
 * CSP 下自製下拉（無外部庫）：點外面或 Esc 關閉，比照 UserMenu。
 */
function PendingBadge({ groupId }: { groupId: string }) {
  const summary = trpc.approvals.pendingSummary.useQuery({ groupId }, { refetchInterval: 60_000, enabled: !!groupId });
  // 專案名稱查詢（pendingSummary 只回 projectId）：與 Launchpad 同一條 query，react-query 會去重快取
  const projectList = trpc.projects.list.useQuery({ groupId: groupId || undefined }, { enabled: !!groupId });
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  // Hooks 必須無條件呼叫——關閉/外點/Esc 的副作用放在任何 return 之前，之後才依資料條件決定要不要渲染
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const summ = summary.data;
  const total = summ ? summ.totalPendingApprovals + summ.totalAwaitingGenerations : 0;
  // 0 筆（或還沒載到）不佔版面——所有 hook 已在上方無條件呼叫，這裡提早 return 安全
  if (!summ || total === 0) return null;
  const close = () => setOpen(false);
  const titleOf = (pid: string) => projectList.data?.find((p) => p.id === pid)?.title ?? "專案";
  // 逐案列（各專案至少一筆待辦）：待辦多的排前面，讓最該處理的浮到頂
  const rows = summ.projects
    .filter((p) => p.pendingApprovals + p.awaitingGenerations > 0)
    .sort((a, b) => (b.pendingApprovals + b.awaitingGenerations) - (a.pendingApprovals + a.awaitingGenerations));
  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        className="status-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ color: "var(--gold-ink)", cursor: "pointer" }}
        title={`分鏡待審 ${summ.totalPendingApprovals}・生成待核准 ${summ.totalAwaitingGenerations}——點開看是哪些專案`}
      >
        <Icon name="Bell" size={14} />
        <span className="mono">{total}</span>
      </button>
      {open && (
        <div className="menu" role="menu" style={{ minWidth: 248 }}>
          <div className="menu-label" role="presentation">待辦通知</div>
          {rows.map((p) => (
            <Link
              key={p.projectId}
              href={`/p/${p.projectId}`}
              className="menu-item"
              role="menuitem"
              onClick={close}
              style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }}
            >
              <span style={{ fontWeight: 600, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {titleOf(p.projectId)}
              </span>
              <span className="meta">
                {[
                  p.pendingApprovals > 0 ? `分鏡待審 ${p.pendingApprovals}` : null,
                  p.awaitingGenerations > 0 ? `生成待核 ${p.awaitingGenerations}` : null,
                ].filter(Boolean).join("・")}
              </span>
            </Link>
          ))}
          <div className="menu-sep" />
          <Link href="/" className="menu-item" role="menuitem" onClick={close} style={{ color: "var(--fg-secondary)" }}>
            <Icon name="ArrowRight" size={15} />回作業台看全部
          </Link>
        </div>
      )}
    </div>
  );
}

/** 頂欄私訊入口：常駐圖示＋未讀數輪詢（30 秒）；0 未讀只顯示入口不顯示數字 */
function DmNavBadge() {
  const unread = trpc.dm.unread.useQuery(undefined, { refetchInterval: 30_000 });
  const n = unread.data?.total ?? 0;
  return (
    <Link href="/chat" className="badge" style={{ textDecoration: "none", color: "inherit" }} title="私訊——與同組夥伴一對一聊天">
      <Icon name="MessageCircle" size={14} />
      <span className="topbar-quick-label">私訊</span>
      {n > 0 && <span className="dm-nav-unread" aria-label={`${n} 則未讀私訊`}>{n > 99 ? "99+" : n}</span>}
    </Link>
  );
}

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

/** 使用者選單（收斂頂欄）：說明／工作／管理／帳號四組收進單一下拉，管理組僅組長／管理員可見。
 * CSP 下自製（無外部庫）：點外面或 Esc 關閉。 */
function UserMenu({
  userName, isAdmin, activeIsLeader, canSeeOrg, onChangePw, onNotifSettings, onLogout, loggingOut,
}: {
  userName: string; isAdmin: boolean; activeIsLeader: boolean; canSeeOrg: boolean;
  onChangePw: () => void; onNotifSettings: () => void; onLogout: () => void; loggingOut: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const close = () => setOpen(false);

  const flags = { isAdmin, activeIsLeader, canSeeOrg };
  const helpItems = filterNavItems(accountMenuItems.filter((i) => i.section === "help"), flags);
  const workItems = filterNavItems(accountMenuItems.filter((i) => i.section === "work"), flags);
  const manageItems = filterNavItems(accountMenuItems.filter((i) => i.section === "manage"), flags);
  const accountLinkItems = filterNavItems(accountMenuItems.filter((i) => i.section === "account"), flags);

  return (
    <div className="menu-wrap" ref={wrap}>
      <button className="badge" aria-haspopup="menu" aria-expanded={open} title={userName} onClick={() => setOpen((v) => !v)}>
        <Icon name="User" size={14} />
        <span style={{ maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{userName}</span>
        <Icon name="ChevronDown" size={14} />
      </button>
      {open && (
        <div className="menu" role="menu">
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

/**
 * App chrome: header, nav, account menu, pending badges, session gate + routes, dialogs.
 * Owns session/group state previously inlined in App.tsx (TD-06).
 */
export function AppShell() {
  const utils = trpc.useUtils();
  const [location, navigate] = useLocation();
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const pushUnsubscribe = trpc.push.unsubscribe.useMutation();
  // 登出＝連推播一起解除本裝置（共用電腦隱私：登出後這台機器不能再跳你的私訊/審批通知）。
  // 盡力而為：解除失敗不擋登出；要再收通知，下次登入後到「連結手機與電腦」重新啟用。
  const logoutWithPushCleanup = async () => {
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await pushUnsubscribe.mutateAsync({ endpoint });
    } catch { /* 推播清理失敗照樣登出 */ }
    logout.mutate();
  };
  const info = trpc.generation.info.useQuery(undefined, { enabled: !!me.data });

  // Service Worker 點通知後若無法 navigate，會 postMessage 請前端路由
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type === "aios:navigate" && typeof data.url === "string" && data.url.startsWith("/")) {
        navigate(data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [navigate]);

  // 組切換（多組成員）：記住上次選的組
  const groups = me.data?.groups ?? [];
  const [activeGroupId, setActiveGroupId] = useState<string>(() => localStorage.getItem("aidos_group") ?? "");
  useEffect(() => {
    if (groups.length && !groups.some((g) => g.groupId === activeGroupId)) {
      setActiveGroupId(groups[0].groupId);
    }
  }, [groups, activeGroupId]);
  useEffect(() => {
    if (activeGroupId) localStorage.setItem("aidos_group", activeGroupId);
  }, [activeGroupId]);

  const isAdmin = !!me.data && (me.data.user.isSuperAdmin || me.data.adminTeamIds.length > 0);
  // 目前作用組的角色：組長或管理員才看得到「選項」入口（自訂內容類型／平台／世界觀選項）
  const activeGroup = groups.find((g) => g.groupId === activeGroupId);
  const activeIsLeader = activeGroup?.role === "leader" || activeGroup?.role === "admin";
  // 通訊錄／操作紀錄：只要在「任一組」是組長或管理員就能看（跨組彙總）——比照後端 directory/audit 的可見界；
  // 不可只看「作用中的組」的角色，否則多組組長切到自己是純組員的那一組時會被誤擋在外。
  const canSeeOrg = isAdmin || groups.some((g) => g.role !== "member");
  const [showChangePw, setShowChangePw] = useState(false);
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  // 管理員重設密碼後：不論在哪個路由都用強制對話框擋住，改完密碼（auth.me 重查）才放行
  const mustChangePw = !!me.data?.user.mustChangePassword;
  // 進站 splash：auth 就緒後淡出；不阻擋互動路徑以外的預載，僅首次掛載
  const [splashDone, setSplashDone] = useState(false);

  return (
    <div className="app">
      {!splashDone && (
        <SplashScreen ready={!me.isLoading} onDone={() => setSplashDone(true)} />
      )}
      {/* 強制改密碼時整塊背景 inert：對話框遮罩只擋滑鼠，Tab 仍能聚焦到背景，要靠 inert 一起擋 */}
      <div inert={(mustChangePw || showChangePw || showNotifSettings) || undefined}>
        <header className="topbar">
          <Link href="/" className="brand" aria-label="Aios 首頁">
            <BrandLogo variant="full" size="sm" responsive priority />
          </Link>
          {me.data && groups.length > 0 && (
            <select
              className="group-select"
              aria-label="切換作用中的組別"
              style={{ width: "auto" }}
              value={activeGroupId}
              onChange={(e) => {
                setActiveGroupId(e.target.value);
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
          {me.data && info.data?.mockMode && <span className="badge mock">測試模式</span>}
          {/* 高頻入口常駐頂欄：筆記排程／資料庫是天天用的工具，從使用者選單升上來一鍵可達；
           * 手機空間吃緊時標籤收成純圖示（topbar-quick-label），title/aria 仍保留 */}
          {me.data && <DmNavBadge />}
          {me.data && topbarNavItems.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className="badge"
              style={{ textDecoration: "none", color: "inherit" }}
              title={item.title}
            >
              {item.icon && <Icon name={item.icon} size={14} />}
              <span className={item.key === "help" ? "topbar-help-label" : "topbar-quick-label"}>{item.label}</span>
            </Link>
          ))}
          {me.data && <PendingBadge groupId={activeGroupId} />}
          {me.data && <PointsBadge groupId={activeGroupId} />}
          {/* 頂欄收斂：次要入口（模型指南/接上外部 AI/資料下載/管理組/改密碼）＋登出全收進使用者選單 */}
          {me.data && (
            <UserMenu
              userName={me.data.user.name}
              isAdmin={isAdmin}
              activeIsLeader={activeIsLeader}
              canSeeOrg={canSeeOrg}
              onChangePw={() => setShowChangePw(true)}
              onNotifSettings={() => setShowNotifSettings(true)}
              onLogout={() => { void logoutWithPushCleanup(); }}
              loggingOut={logout.isPending}
            />
          )}
        </header>

        {/* lazy 頁面載入中的過場（QA-025 code-splitting）：整個路由樹共用一個 Suspense */}
        <Suspense fallback={<p className="hint">載入中…</p>}>
          <SessionGate
            me={me.data}
            meLoading={me.isLoading}
            meError={!!me.error}
            onRetry={() => { void me.refetch(); }}
            isAdmin={isAdmin}
            activeGroupId={activeGroupId}
            activeIsLeader={activeIsLeader}
            canSeeOrg={canSeeOrg}
          />
        </Suspense>
      </div>

      {mustChangePw ? (
        <ChangePasswordDialog forced onClose={() => setShowChangePw(false)} />
      ) : (
        showChangePw && me.data && <ChangePasswordDialog onClose={() => setShowChangePw(false)} />
      )}

      {!mustChangePw && showNotifSettings && me.data && <NotificationSettingsDialog onClose={() => setShowNotifSettings(false)} />}

      {/* 例行推播訂閱同步（零 UI）：已啟用通知的裝置每次開 App 回報一次，刷新裝置清單的「最近同步」 */}
      {me.data && <PushSubscriptionSync />}

      {/* 元件級回饋浮標：登入後任何路由都掛一次；放在 inert 包裹外、與對話框同層，強制改密碼時不受影響 */}
      {me.data && <FeedbackWidget />}
    </div>
  );
}
