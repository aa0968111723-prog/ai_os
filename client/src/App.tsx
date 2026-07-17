import { useEffect, useRef, useState } from "react";
import { Route, Switch, Link, useLocation } from "wouter";
import { trpc } from "./api";
import { Launchpad } from "./pages/Launchpad";
import { ProjectPage } from "./pages/ProjectPage";
import { LoginPage } from "./pages/LoginPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { AdminPage } from "./pages/AdminPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { ModelsPage } from "./pages/ModelsPage";
import { HelpPage } from "./pages/HelpPage";
import { DownloadsPage } from "./pages/DownloadsPage";
import { PlannerPage } from "./pages/PlannerPage";
import { PasswordInput } from "./components/PasswordInput";
import { GroupOptionsEditor } from "./components/GroupOptionsEditor";
import { FeedbackWidget } from "./feedback/FeedbackWidget";
import { Icon } from "./components/Icon";
import { useFocusTrap } from "./components/interactions";

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

/** 使用者選單（收斂頂欄）：怎麼用／模型指南／選項／團隊管理／改密碼＋登出，收進單一下拉。
 * CSP 下自製（無外部庫）：點外面或 Esc 關閉。 */
function UserMenu({
  userName, isAdmin, activeIsLeader, onChangePw, onLogout, loggingOut,
}: {
  userName: string; isAdmin: boolean; activeIsLeader: boolean;
  onChangePw: () => void; onLogout: () => void; loggingOut: boolean;
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
          {/* 分組＋分隔線：說明／工作／帳號——9 項扁平列表太難掃（回饋 W1） */}
          <div className="menu-label" role="presentation">說明</div>
          <Link href="/help" className="menu-item" role="menuitem" onClick={close}><Icon name="HelpCircle" size={15} />怎麼用</Link>
          <Link href="/models" className="menu-item" role="menuitem" onClick={close}><Icon name="Info" size={15} />模型指南</Link>
          <div className="menu-sep" />
          <div className="menu-label" role="presentation">工作</div>
          <Link href="/planner" className="menu-item" role="menuitem" onClick={close}><Icon name="Clock" size={15} />筆記排程</Link>
          <Link href="/downloads" className="menu-item" role="menuitem" onClick={close}><Icon name="Download" size={15} />資料下載</Link>
          {activeIsLeader && <Link href="/options" className="menu-item" role="menuitem" onClick={close}><Icon name="Ellipsis" size={15} />選項</Link>}
          {isAdmin && <Link href="/admin" className="menu-item" role="menuitem" onClick={close}><Icon name="User" size={15} />團隊管理</Link>}
          <div className="menu-sep" />
          <div className="menu-label" role="presentation">帳號</div>
          {/* 個人資料匯出（端點 /api/me/export 由後端提供）：a 標籤直下載，不經前端路由 */}
          <a href="/api/me/export" download className="menu-item" role="menuitem" onClick={close}><Icon name="FileText" size={15} />下載我的資料</a>
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
  const info = trpc.generation.info.useQuery(undefined, { enabled: !!me.data });

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
  const [showChangePw, setShowChangePw] = useState(false);
  // 管理員重設密碼後：不論在哪個路由都用強制對話框擋住，改完密碼（auth.me 重查）才放行
  const mustChangePw = !!me.data?.user.mustChangePassword;

  return (
    <div className="app">
      {/* 強制改密碼時整塊背景 inert：對話框遮罩只擋滑鼠，Tab 仍能聚焦到背景，要靠 inert 一起擋 */}
      <div inert={(mustChangePw || showChangePw) || undefined}>
        <header className="topbar">
          <Link href="/" className="brand" style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <span className="orb" /> AI Director OS
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
          {/* 常駐「怎麼用」入口：困惑當下一眼找得到說明，不必想到去點自己的名字（UX 中：可發現性） */}
          {me.data && (
            <Link href="/help" className="badge" style={{ textDecoration: "none", color: "inherit" }} title="怎麼用——白話說明與常見問題">
              <Icon name="HelpCircle" size={14} />
              <span className="topbar-help-label">怎麼用</span>
            </Link>
          )}
          {me.data && <PendingBadge groupId={activeGroupId} />}
          {me.data && <PointsBadge groupId={activeGroupId} />}
          {/* 頂欄收斂：次要入口（怎麼用/模型指南/選項/團隊管理/改密碼）＋登出全收進使用者選單 */}
          {me.data && (
            <UserMenu
              userName={me.data.user.name}
              isAdmin={isAdmin}
              activeIsLeader={activeIsLeader}
              onChangePw={() => setShowChangePw(true)}
              onLogout={() => logout.mutate()}
              loggingOut={logout.isPending}
            />
          )}
        </header>

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
                <Route path="/feedback"><FeedbackPage groupId={activeGroupId || undefined} /></Route>
                <Route path="/models"><ModelsPage /></Route>
                <Route path="/help"><HelpPage /></Route>
                <Route path="/downloads"><DownloadsPage /></Route>
                <Route path="/planner"><PlannerPage groupId={activeGroupId} /></Route>
                <Route path="/p/:id">{(params) => <ProjectPage id={params.id} />}</Route>
                <Route>
                  <p>
                    找不到頁面 — <Link href="/">回作業台</Link>
                  </p>
                </Route>
              </Switch>
            )}
          </Route>
        </Switch>
      </div>

      {mustChangePw ? (
        <ChangePasswordDialog forced onClose={() => setShowChangePw(false)} />
      ) : (
        showChangePw && me.data && <ChangePasswordDialog onClose={() => setShowChangePw(false)} />
      )}

      {/* 元件級回饋浮標：登入後任何路由都掛一次；放在 inert 包裹外、與對話框同層，強制改密碼時不受影響 */}
      {me.data && <FeedbackWidget />}
    </div>
  );
}
