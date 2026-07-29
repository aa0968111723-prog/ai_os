import { lazy } from "react";
import { Redirect, Route, Switch, Link } from "wouter";
import { GroupOptionsEditor } from "../components/GroupOptionsEditor";

// 路由層級 code-splitting（QA-025）：管理、資料庫、排程等重頁面延遲載入，
// 避免首屏（作業台、專案頁、登入）揹整個 App 的 JS。具名匯出需轉成 lazy 所需的 default export。
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
const Launchpad = lazy(() => import("../pages/Launchpad").then((m) => ({ default: m.Launchpad })));
const ProjectPage = lazy(() => import("../pages/ProjectPage").then((m) => ({ default: m.ProjectPage })));

export type AppRoutesProps = {
  activeGroupId: string;
  isAdmin: boolean;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
};

/** 已登入且已有組別的完整路由表；網址契約須與既有深鏈、通知與書籤保持相容。 */
export function AppRoutes({ activeGroupId, isAdmin, activeIsLeader, canSeeOrg }: AppRoutesProps) {
  return (
    <Switch>
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/dashboard">
        <Launchpad groupId={activeGroupId} />
      </Route>
      <Route path="/admin">
        {isAdmin ? <AdminPage /> : (
          <p className="error">
            這頁需要團隊管理權限 — <Link href="/dashboard">回今日工作台</Link>
          </p>
        )}
      </Route>
      <Route path="/options">
        {activeIsLeader ? (
          <GroupOptionsEditor groupId={activeGroupId} />
        ) : (
          <p className="error">
            這頁需要組長或管理員權限 — <Link href="/dashboard">回今日工作台</Link>
          </p>
        )}
      </Route>
      <Route path="/logs">
        {canSeeOrg ? (
          // 組長也可看點數消耗與洞察；後端會按呼叫者權限收斂到其可管理範圍。
          <div className="stack" style={{ maxWidth: 860, margin: "0 auto" }}>
            <ConsumptionMonitorCard />
            <InsightsCard />
            <AuditLogCard />
          </div>
        ) : (
          <p className="error">
            這頁需要組長或管理員權限 — <Link href="/dashboard">回今日工作台</Link>
          </p>
        )}
      </Route>
      <Route path="/members">
        {canSeeOrg ? (
          <MembersPage />
        ) : (
          <p className="error">
            這頁需要組長或管理員權限 — <Link href="/dashboard">回今日工作台</Link>
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
      {/* key=id：從通知、待辦或上一頁／下一頁切換專案時強制重建 ProjectPage。
          否則前一案的提示詞、模型、角色場景勾選與 localStorage 初始化狀態可能殘留到新案。 */}
      <Route path="/p/:id">{(params) => <ProjectPage key={params.id} id={params.id} />}</Route>
      <Route>
        <p>
          找不到頁面 — <Link href="/dashboard">回今日工作台</Link>
        </p>
      </Route>
    </Switch>
  );
}

/** 已登入但尚未加入組別：保留帳號層級與求助用功能，避免等待分組時完全無法操作。 */
export function UngroupedRoutes() {
  return (
    <Switch>
      <Route path="/help"><HelpPage /></Route>
      {/* MCP 金鑰屬帳號層級；未分組時仍可先建立，實際連入後仍由服務端權限隔離。 */}
      <Route path="/mcp"><McpPage /></Route>
      {/* Google、Notion、外部 API 整合都綁個人帳號，不依賴組別。 */}
      <Route path="/integrations"><IntegrationsPage /></Route>
      {/* 未分組期間仍可能需要聯絡管理員；可訊範圍由後端守門。 */}
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
