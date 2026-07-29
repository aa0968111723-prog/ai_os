import { lazy } from "react";
import { Route, Switch, Link } from "wouter";
import { Launchpad } from "../pages/Launchpad";
import { ProjectPage } from "../pages/ProjectPage";
import { GroupOptionsEditor } from "../components/GroupOptionsEditor";

const AdminPage = lazy(() => import("../pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const AuditLogCard = lazy(() => import("../pages/AdminPage").then((m) => ({ default: m.AuditLogCard })));
const ConsumptionMonitorCard = lazy(() => import("../pages/AdminPage").then((m) => ({ default: m.ConsumptionMonitorCard })));
const InsightsCard = lazy(() => import("../pages/AdminPage").then((m) => ({ default: m.InsightsCard })));
const MembersPage = lazy(() => import("../pages/MembersPage").then((m) => ({ default: m.MembersPage })));
const FeedbackPage = lazy(() => import("../pages/FeedbackPage").then((m) => ({ default: m.FeedbackPage })));
const MyReportsPage = lazy(() => import("../pages/MyReportsPage").then((m) => ({ default: m.MyReportsPage })));
const ModelsPage = lazy(() => import("../pages/ModelsPage").then((m) => ({ default: m.ModelsPage })));
const HelpPage = lazy(() => import("../pages/HelpPage").then((m) => ({ default: m.HelpPage })));
const McpPage = lazy(() => import("../pages/McpPage").then((m) => ({ default: m.McpPage })));
const IntegrationsPage = lazy(() => import("../pages/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })));
const DownloadsPage = lazy(() => import("../pages/DownloadsPage").then((m) => ({ default: m.DownloadsPage })));
const PlannerPage = lazy(() => import("../pages/PlannerPage").then((m) => ({ default: m.PlannerPage })));
const DatabasesPage = lazy(() => import("../pages/DatabasesPage").then((m) => ({ default: m.DatabasesPage })));
const ChatPage = lazy(() => import("../pages/ChatPage").then((m) => ({ default: m.ChatPage })));

export type AppRoutesProps = {
  activeGroupId: string;
  isAdmin: boolean;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
};

export function AppRoutes({ activeGroupId, isAdmin, activeIsLeader, canSeeOrg }: AppRoutesProps) {
  return (
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
      <Route path="/p/:id">{(params) => <ProjectPage key={params.id} id={params.id} />}</Route>
      <Route>
        <p>
          找不到頁面 — <Link href="/">回作業台</Link>
        </p>
      </Route>
    </Switch>
  );
}

export function UngroupedRoutes() {
  return (
    <Switch>
      <Route path="/help"><HelpPage /></Route>
      <Route path="/mcp"><McpPage /></Route>
      <Route path="/integrations"><IntegrationsPage /></Route>
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
  );
}
