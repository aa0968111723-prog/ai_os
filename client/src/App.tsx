import { useEffect, useState } from "react";
import { Route, Switch, Link } from "wouter";
import { trpc } from "./api";
import { Launchpad } from "./pages/Launchpad";
import { ProjectPage } from "./pages/ProjectPage";
import { LoginPage } from "./pages/LoginPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { AdminPage } from "./pages/AdminPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { ModelsPage } from "./pages/ModelsPage";
import { HelpPage } from "./pages/HelpPage";
import { PasswordInput } from "./components/PasswordInput";
import { GroupOptionsEditor } from "./components/GroupOptionsEditor";
import { FeedbackWidget } from "./feedback/FeedbackWidget";

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
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(43,38,32,0.35)", display: "grid", placeItems: "center", zIndex: 50 }}
      onClick={(e) => { if (!forced && e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ width: 380, maxWidth: "92vw" }} role="dialog" aria-label="改密碼">
        <h2 style={{ marginTop: 0 }}>改密碼</h2>
        {forced && <p className="hint">管理員重設了你的密碼——請先設定一組自己的新密碼再繼續使用</p>}
        <form onSubmit={(e) => { e.preventDefault(); if (canSubmit) change.mutate({ oldPassword: oldPw, newPassword: newPw }); }}>
          <label htmlFor="chpw-old">原密碼（或管理員給的臨時密碼）</label>
          <PasswordInput id="chpw-old" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" autoFocus />
          <label htmlFor="chpw-new">新密碼（至少 8 碼）</label>
          <PasswordInput id="chpw-new" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" />
          {newPw.length > 0 && newPw.length < 8 && <p className="hint">還差 {8 - newPw.length} 個字</p>}
          <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
            <button className="primary" type="submit" disabled={!canSubmit}>{change.isPending ? "更新中…" : "更新密碼"}</button>
            {!forced && <button type="button" onClick={onClose}>取消</button>}
          </div>
        </form>
        {change.error && <p className="error" role="alert">{change.error.message}</p>}
        {change.isSuccess && <p className="hint" style={{ color: "var(--success)" }} role="status">已更新 ✓——其他裝置已登出，本裝置不受影響</p>}
      </div>
    </div>
  );
}

/** 彈性點數徽章：剩餘 or 不限（管理員可在團隊管理調整） */
function PointsBadge({ groupId }: { groupId: string }) {
  // enabled 等組別就緒才查——避免首載以 undefined 先打一輪造成「週額度閃爍」
  const my = trpc.quota.my.useQuery({ groupId: groupId || undefined }, { refetchInterval: 60_000, enabled: !!groupId });
  if (my.error) return <span className="badge" title="點數暫時讀不到，稍後會自動重試">◈ <span className="mono">—</span></span>;
  if (!my.data) return null;
  const { totalRemaining, weeklyQuota, weeklyUsed, dailyQuota, dailyUsed } = my.data;
  const label = totalRemaining != null ? `剩 ${totalRemaining.toLocaleString()}` : "不限";
  const weekly = weeklyQuota != null ? `・週 ${weeklyUsed}/${weeklyQuota}` : "";
  const daily = dailyQuota != null ? `・日 ${dailyUsed}/${dailyQuota}` : "";
  return (
    <span className="badge" title="點數額度由管理員調整；日上限每天重置">
      ◈ <span className="mono">{label}{weekly}{daily}</span>
    </span>
  );
}

export function App() {
  const utils = trpc.useUtils();
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
      <div inert={mustChangePw || undefined}>
        <header className="topbar">
          <Link href="/" className="brand" style={{ cursor: "pointer", textDecoration: "none", color: "inherit" }}>
            <span className="orb" /> AI Director OS
          </Link>
          {me.data && groups.length > 0 && (
            <select
              aria-label="切換作用中的組別"
              style={{ width: "auto", borderRadius: 999, padding: "6px 14px", fontSize: 13 }}
              value={activeGroupId}
              onChange={(e) => setActiveGroupId(e.target.value)}
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
          {me.data && info.data?.mockMode && <span className="badge mock">假生成模式</span>}
          {me.data && <PointsBadge groupId={activeGroupId} />}
          {activeIsLeader && <Link href="/options"><span className="badge" style={{ cursor: "pointer" }}>選項</span></Link>}
          {me.data && <Link href="/help"><span className="badge" style={{ cursor: "pointer" }}>怎麼用</span></Link>}
          {me.data && <Link href="/models"><span className="badge" style={{ cursor: "pointer" }}>模型指南</span></Link>}
          {me.data && <Link href="/feedback"><span className="badge" style={{ cursor: "pointer" }}>回饋</span></Link>}
          {isAdmin && <Link href="/admin"><span className="badge" style={{ cursor: "pointer" }}>團隊管理</span></Link>}
          {me.data && (
            <span
              className="badge"
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onClick={() => setShowChangePw(true)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setShowChangePw(true); } }}
            >
              改密碼
            </span>
          )}
          {me.data && (
            <button onClick={() => logout.mutate()} disabled={logout.isPending} title={me.data.user.name}>
              {logout.isPending ? "登出中…" : `${me.data.user.name}・登出`}
            </button>
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
                <button style={{ padding: "2px 12px" }} onClick={() => me.refetch()}>重試</button>
              </p>
            ) : !me.data ? (
              <LoginPage />
            ) : me.data.groups.length === 0 && !me.data.user.isSuperAdmin ? (
              <p className="hint" style={{ marginTop: 40, fontSize: 15 }}>
                你的帳號還沒被加進任何組別——請聯絡你的組長或管理員把你加入組，加入後重新整理就能開始創作。
              </p>
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
