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

/** 彈性點數徽章：剩餘 or 不限（組長/管理員可在團隊管理調整） */
function PointsBadge({ groupId }: { groupId: string }) {
  // enabled 等組別就緒才查——避免首載以 undefined 先打一輪造成「週額度閃爍」
  const my = trpc.quota.my.useQuery({ groupId: groupId || undefined }, { refetchInterval: 20_000, enabled: !!groupId });
  if (my.error) return <span className="badge" title="點數暫時讀不到，稍後會自動重試">◈ <span className="mono">—</span></span>;
  if (!my.data) return null;
  const { totalRemaining, weeklyQuota, weeklyUsed } = my.data;
  const label = totalRemaining != null ? `剩 ${totalRemaining.toLocaleString()}` : "不限";
  const weekly = weeklyQuota != null ? `・週 ${weeklyUsed}/${weeklyQuota}` : "";
  return (
    <span className="badge" title="點數額度由組長／管理員調整">
      ◈ <span className="mono">{label}{weekly}</span>
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

  return (
    <div className="app">
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
        {me.data && <Link href="/models"><span className="badge" style={{ cursor: "pointer" }}>模型指南</span></Link>}
        {me.data && <Link href="/feedback"><span className="badge" style={{ cursor: "pointer" }}>回饋</span></Link>}
        {isAdmin && <Link href="/admin"><span className="badge" style={{ cursor: "pointer" }}>團隊管理</span></Link>}
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
              <Route path="/feedback"><FeedbackPage groupId={activeGroupId || undefined} /></Route>
              <Route path="/models"><ModelsPage /></Route>
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
  );
}
