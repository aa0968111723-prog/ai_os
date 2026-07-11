import { Route, Switch, Link, useLocation } from "wouter";
import { trpc } from "./api";
import { Launchpad } from "./pages/Launchpad";
import { ProjectPage } from "./pages/ProjectPage";

export function App() {
  const points = trpc.generation.pointsSummary.useQuery(undefined, { refetchInterval: 15_000 });
  const [, navigate] = useLocation();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" style={{ cursor: "pointer" }} onClick={() => navigate("/")}>
          <span className="orb" /> AI Director OS
        </div>
        <span className="spacer" />
        {points.data?.mockMode && <span className="badge mock">假生成模式（不扣真錢）</span>}
        <span className="badge">
          ◈ <span className="mono">{points.data ? points.data.totalRemaining.toLocaleString() : "…"}</span> 點
        </span>
      </header>

      <Switch>
        <Route path="/" component={Launchpad} />
        <Route path="/p/:id">{(params) => <ProjectPage id={params.id} />}</Route>
        <Route>
          <p>
            找不到頁面 — <Link href="/">回作業台</Link>
          </p>
        </Route>
      </Switch>
    </div>
  );
}
