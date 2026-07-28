import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Route, Switch, Link, useLocation } from "wouter";
import { trpc } from "./api";
import { Launchpad } from "./pages/Launchpad";
import { ProjectPage } from "./pages/ProjectPage";
import { LoginPage } from "./pages/LoginPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
// 路由層級 code-splitting（QA-025）：管理/資料庫/排程等重頁面延遲載入——
// 首屏（作業台/專案頁/登入）不揹整個 App 的 JS。lazy 需要 default export，用 then 轉接具名匯出。
const AdminPage = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const AuditLogCard = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.AuditLogCard })));
const ConsumptionMonitorCard = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.ConsumptionMonitorCard })));
const InsightsCard = lazy(() => import("./pages/AdminPage").then((m) => ({ default: m.InsightsCard })));
const MembersPage = lazy(() => import("./pages/MembersPage").then((m) => ({ default: m.MembersPage })));
const FeedbackPage = lazy(() => import("./pages/FeedbackPage").then((m) => ({ default: m.FeedbackPage })));
const MyReportsPage = lazy(() => import("./pages/MyReportsPage").then((m) => ({ default: m.MyReportsPage })));
const ModelsPage = lazy(() => import("./pages/ModelsPage").then((m) => ({ default: m.ModelsPage })));
const HelpPage = lazy(() => import("./pages/HelpPage").then((m) => ({ default: m.HelpPage })));
const McpPage = lazy(() => import("./pages/McpPage").then((m) => ({ default: m.McpPage })));
const IntegrationsPage = lazy(() => import("./pages/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })));
const DownloadsPage = lazy(() => import("./pages/DownloadsPage").then((m) => ({ default: m.DownloadsPage })));
const PlannerPage = lazy(() => import("./pages/PlannerPage").then((m) => ({ default: m.PlannerPage })));
const DatabasesPage = lazy(() => import("./pages/DatabasesPage").then((m) => ({ default: m.DatabasesPage })));
const ChatPage = lazy(() => import("./pages/ChatPage").then((m) => ({ default: m.ChatPage })));
import { PasswordInput } from "./components/PasswordInput";
import { GroupOptionsEditor } from "./components/GroupOptionsEditor";
import { FeedbackWidget } from "./feedback/FeedbackWidget";
import { NotificationSettingsDialog, PushSubscriptionSync } from "./components/NotificationSettings";
import { unsubscribeThisDevice } from "./push";
import { Icon } from "./components/Icon";
import { useFocusTrap } from "./components/interactions";
import { BrandLogo } from "./components/BrandLogo";
import { SplashScreen } from "./components/SplashScreen";
import { canShowInstallUi, isIosDevice, isStandaloneApp, promptInstall, subscribeInstallUi } from "./pwa";

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
 * 自助改密碼（拿到管理員的臨時密碼後，從這裡換成自己的）：成功後其他裝置全部登出。
 * forced：管理員重設密碼後的強制模式——不能取消、不能點背景關閉，
 * 成功後本地先清 mustChangePassword 解除強制對話框，再 invalidate 對齊伺服器。
 */
function ChangePasswordDialog({ onClose, forced = false }: { onClose: () => void; forced?: boolean }) {
  const utils = trpc.useUtils();
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const change = trpc.auth.changePassword.useMutation({
    // 先讓成功訊息停 1.8 秒再收尾——避免對話框在使用者讀到「已更新 ✓」前就消失
    onSuccess: () =>
      setTimeout(() => {
        // 改密碼已成功，先本地清旗標：解除不能只靠 invalidate 的 refetch——它一失敗，強制對話框就永遠關不掉
        utils.auth.me.setData(undefined, (old) => (old ? { ...old, user: { ...old.user, mustChangePassword: false } } : old));
        utils.auth.me.invalidate();
        onClose();
      }, 1800),
  });
  const canSubmit = oldPw.length > 0 && newPw.length >= 8 && !change.isPending && !change.isSuccess;
  const dialogRef = useRef<HTMLDivElement>(null);
  // 真模態：焦點鎖在對話框內＋鎖背景捲動＋Esc 關閉（強制模式不可關）；關閉後焦點還給開啟者
  useFocusTrap(dialogRef, true, forced ? undefined : onClose);
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "var(--scrim)", display: "grid", placeItems: "center", zIndex: 50 }}
      onClick={(e) => { if (!forced && e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className="card" style={{ width: 380, maxWidth: "92vw" }} role="dialog" aria-modal="true" aria-label="改密碼">
        <h2 style={{ marginTop: 0 }}>改密碼</h2>
        {forced && <p className="hint">管理員重設了你的密碼——請先設定一組自己的新密碼再繼續使用</p>}
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) change.mutate({ oldPassword: oldPw, newPassword: newPw }); }}>
          <label htmlFor="chpw-old">原密碼（或管理員給的臨時密碼）</label>
          <PasswordInput id="chpw-old" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" autoFocus />
          <label htmlFor="chpw-new">新密碼（至少 8 碼）</label>
          <PasswordInput id="chpw-new" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          {newPw.length > 0 && newPw.length < 8 && <p className="hint">還差 {8 - newPw.length} 個字</p>}
          <div style={{ marginTop: "var(--sp-16)", display: "flex", gap: "var(--sp-8)" }}>
            <button className="primary" type="submit" disabled={!canSubmit}>{change.isPending ? "更新中…" : "更新密碼"}</button>
            {!forced && <button type="button" onClick={onClose}>取消</button>}
          </div>
        </form>
        {change.error && <p className="error" role="alert">{change.error.message}</p>}
        {change.isSuccess && <p className="hint" style={{ color: "var(--success-ink)" }} role="status"><Icon name="Check" size={14} style={{ verticalAlign: "-2px" }} /> 已更新——其他裝置已登出，本裝置不受影響</p>}
      </div>
    </div>
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
          <Link href="/help" className="menu-item" role="menuitem" onClick={close}><Icon name="HelpCircle" size={15} />怎麼用</Link>
          <Link href="/models" className="menu-item" role="menuitem" onClick={close}><Icon name="Info" size={15} />模型指南</Link>
          <div className="menu-sep" />
          <div className="menu-label" role="presentation">工作</div>
          <Link href="/mcp" className="menu-item" role="menuitem" onClick={close}><Icon name="Sparkles" size={15} />接上外部 AI</Link>
          <Link href="/integrations" className="menu-item" role="menuitem" onClick={close}><Icon name="Package" size={15} />連接的資料來源</Link>
          <Link href="/downloads" className="menu-item" role="menuitem" onClick={close}><Icon name="FileText" size={15} />共用文件下載</Link>
          {/* 管理組：只要在任一組是組長或管理員（canSeeOrg）就顯示整段；段內各項再依細權限收放，
           * 團隊管理限管理員（isAdmin）、選項限作用組組長（activeIsLeader）。canSeeOrg 為兩者的聯集，
           * 故整段用它當閘門時，段內至少會有通訊錄／監控兩項，不會出現只有標題的空組。 */}
          {canSeeOrg && (
            <>
              <div className="menu-sep" />
              <div className="menu-label" role="presentation">管理</div>
              {activeIsLeader && <Link href="/options" className="menu-item" role="menuitem" onClick={close}><Icon name="Ellipsis" size={15} />選項</Link>}
              <Link href="/members" className="menu-item" role="menuitem" onClick={close}><Icon name="User" size={15} />通訊錄</Link>
              <Link href="/logs" className="menu-item" role="menuitem" onClick={close}><Icon name="FileText" size={15} />監控與紀錄</Link>
              {isAdmin && <Link href="/admin" className="menu-item" role="menuitem" onClick={close}><Icon name="SlidersHorizontal" size={15} />團隊管理</Link>}
            </>
          )}
          <div className="menu-sep" />
          <div className="menu-label" role="presentation">帳號</div>
          <InstallAppMenuItem onDone={close} />
          <Link href="/my-reports" className="menu-item" role="menuitem" onClick={close}><Icon name="MessageCircle" size={15} />我的回報</Link>
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

export function App() {
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
          {me.data && (
            <Link href="/planner" className="badge" style={{ textDecoration: "none", color: "inherit" }} title="筆記排程——把筆記排進待辦與行程">
              <Icon name="Clock" size={14} />
              <span className="topbar-quick-label">筆記排程</span>
            </Link>
          )}
          {me.data && (
            <Link href="/databases" className="badge" style={{ textDecoration: "none", color: "inherit" }} title="資料庫——你的素材與資料集">
              <Icon name="Package" size={14} />
              <span className="topbar-quick-label">資料庫</span>
            </Link>
          )}
          {/* 常駐「怎麼用」入口：困惑當下一眼找得到說明，不必想到去點自己的名字（UX 中：可發現性） */}
          {me.data && (
            <Link href="/help" className="badge" style={{ textDecoration: "none", color: "inherit" }} title="怎麼用——白話說明與常見問題">
              <Icon name="HelpCircle" size={14} />
              <span className="topbar-help-label">怎麼用</span>
            </Link>
          )}
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
        <Switch>
          <Route path="/invite/:token">{(params) => <AcceptInvitePage token={params.token} />}</Route>
          <Route>
            {me.isLoading ? (
              <p className="hint">載入中…</p>
            ) : me.error ? (
              <p className="error">
                系統暫時連不上（不是你被登出）——請稍候重新整理，或按{" "}
                <button className="btn-sm" onClick={() => me.refetch()}>重試</button>
              </p>
            ) : !me.data ? (
              <LoginPage />
            ) : me.data.groups.length === 0 && !me.data.user.isSuperAdmin && !isAdmin ? (
              // 團隊管理員不擋（!isAdmin）：他本人就能去「團隊管理」建組，擋住反而是自相矛盾的死路。
              // /help 保持可達——等待被加入組的空檔正是最需要說明的時候
              <Switch>
                <Route path="/help"><HelpPage /></Route>
                {/* 金鑰管理與帳號無關組別，未分組也可先建立（連進來仍受組隔離限制） */}
                <Route path="/mcp"><McpPage /></Route>
                {/* 連接的資料來源屬帳號層級（Google/Notion/外部 API 都綁個人）——未分組也可先設定 */}
                <Route path="/integrations"><IntegrationsPage /></Route>
                {/* 私訊也保持可達：還沒被分組的空檔正需要聯絡管理員／開發者（可訊界由後端守） */}
                <Route path="/chat/:peerId">{(params) => <ChatPage peerId={params.peerId} />}</Route>
                <Route path="/chat"><ChatPage /></Route>
                <Route>
                  <div className="empty-state" style={{ marginTop: "var(--sp-32)" }}>
                    <h3>你已成功加入 ✓ 還差一步</h3>
                    <p>
                      帳號建立完成，只是還沒被分進任何組別。請聯絡你的組長或管理員把你加入組——加入後重新整理這一頁，就能開始創作。
                    </p>
                    <p className="hint">等待的時候可以先<Link href="/help">看看怎麼用</Link>，了解點數、生成與審核是怎麼運作的。</p>
                  </div>
                </Route>
              </Switch>
            ) : (
              <Switch>
                <Route path="/">
                  <Launchpad groupId={activeGroupId} />
                </Route>
                <Route path="/admin">
                  {isAdmin ? <AdminPage /> : (
                    <p className="error">
                      這頁需要團隊管理權限 — <Link href="/">回作業台</Link>
                    </p>
                  )}
                </Route>
                <Route path="/options">
                  {activeIsLeader ? (
                    <GroupOptionsEditor groupId={activeGroupId} />
                  ) : (
                    <p className="error">
                      這頁需要組長或管理員權限 — <Link href="/">回作業台</Link>
                    </p>
                  )}
                </Route>
                <Route path="/logs">
                  {canSeeOrg ? (
                    // 組長也看得到「點數消耗監控」：後端已按呼叫者權限把範圍收斂到自己帶的組
                    <div className="stack" style={{ maxWidth: 860, margin: "0 auto" }}>
                      <ConsumptionMonitorCard />
                      <InsightsCard />
                      <AuditLogCard />
                    </div>
                  ) : (
                    <p className="error">
                      這頁需要組長或管理員權限 — <Link href="/">回作業台</Link>
                    </p>
                  )}
                </Route>
                <Route path="/members">
                  {canSeeOrg ? (
                    <MembersPage />
                  ) : (
                    <p className="error">
                      這頁需要組長或管理員權限 — <Link href="/">回作業台</Link>
                    </p>
                  )}
                </Route>
                <Route path="/feedback"><FeedbackPage groupId={activeGroupId || undefined} /></Route>
                <Route path="/my-reports"><MyReportsPage /></Route>
                <Route path="/models"><ModelsPage /></Route>
                <Route path="/help"><HelpPage /></Route>
                <Route path="/mcp"><McpPage /></Route>
                <Route path="/integrations"><IntegrationsPage /></Route>
                <Route path="/downloads"><DownloadsPage /></Route>
                <Route path="/chat/:peerId">{(params) => <ChatPage peerId={params.peerId} />}</Route>
                <Route path="/chat"><ChatPage /></Route>
                <Route path="/planner"><PlannerPage groupId={activeGroupId} /></Route>
                <Route path="/databases"><DatabasesPage groupId={activeGroupId} /></Route>
                {/* key=id：換專案（例如頂欄待辦下拉直接跳另一案、或上一頁/下一頁）時強制重建整棵
                    ProjectPage——否則 id prop 變了但元件不重掛，前一案的 prompt／選中模型／角色場景勾選
                    會殘留到新案，且各卡的 localStorage 初始化只在掛載時讀一次，永遠載不到新案的存檔。 */}
                <Route path="/p/:id">{(params) => <ProjectPage key={params.id} id={params.id} />}</Route>
                <Route>
                  <p>
                    找不到頁面 — <Link href="/">回作業台</Link>
                  </p>
                </Route>
              </Switch>
            )}
          </Route>
        </Switch>
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
