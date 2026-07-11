import { useEffect, useState } from "react";
import { Route, Switch, Link, useLocation } from "wouter";
import { trpc } from "./api";
import { Launchpad } from "./pages/Launchpad";
import { ProjectPage } from "./pages/ProjectPage";
import { LoginPage } from "./pages/LoginPage";
import { AcceptInvitePage } from "./pages/AcceptInvitePage";
import { AdminPage } from "./pages/AdminPage";

export function App() {
  const utils = trpc.useUtils();
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const points = trpc.generation.pointsSummary.useQuery(undefined, { refetchInterval: 15_000, enabled: !!me.data });
  const [, navigate] = useLocation();

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
        <div className="brand" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
          <span className="orb" /> AI Director OS
        </div>
        {me.data && groups.length > 0 && (
          <select
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
        {me.data && points.data?.mockMode && <span className="badge mock">假生成模式</span>}
        {me.data && (
          <span className="badge">
            ◈ <span className="mono">{points.data ? points.data.totalRemaining.toLocaleString() : "…"}</span> 點
          </span>
        )}
        {isAdmin && <Link href="/admin"><span className="badge" style={{ cursor: "pointer" }}>團隊管理</span></Link>}
        {me.data && (
          <button onClick={() => logout.mutate()} title={me.data.user.name}>
            {me.data.user.name}・登出
          </button>
        )}
      </header>

      <Switch>
        <Route path="/invite/:token">{(params) => <AcceptInvitePage token={params.token} />}</Route>
        <Route>
          {me.isLoading ? (
            <p className="hint">載入中…</p>
          ) : !me.data ? (
            <LoginPage />
          ) : (
            <Switch>
              <Route path="/">
                <Launchpad groupId={activeGroupId} />
              </Route>
              <Route path="/admin">{isAdmin ? <AdminPage /> : <p className="error">沒有權限</p>}</Route>
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
