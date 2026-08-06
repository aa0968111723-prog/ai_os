import { Redirect, Route, Switch, Link } from "wouter";
import { GroupOptionsEditor } from "../components/GroupOptionsEditor";
import { SecondaryPageHeader } from "../components/SecondaryPageHeader";
import { EmptyState, Hint } from "../components/ui";
import { Icon } from "../components/Icon";
import { lazyWithRetry } from "../lib/lazyWithRetry";

// 路由層級 code-splitting（QA-025）：管理、資料庫、排程等重頁面延遲載入，
// 避免首屏（作業台、專案頁、登入）揹整個 App 的 JS。具名匯出需轉成 lazy 所需的 default export。
const AdminPage = lazyWithRetry(() => import("../pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const AuditLogCard = lazyWithRetry(() => import("../pages/AdminPage").then((m) => ({ default: m.AuditLogCard })));
const ConsumptionMonitorCard = lazyWithRetry(() => import("../pages/AdminPage").then((m) => ({ default: m.ConsumptionMonitorCard })));
const InsightsCard = lazyWithRetry(() => import("../pages/AdminPage").then((m) => ({ default: m.InsightsCard })));
const MembersPage = lazyWithRetry(() => import("../pages/MembersPage").then((m) => ({ default: m.MembersPage })));
const FeedbackPage = lazyWithRetry(() => import("../pages/FeedbackPage").then((m) => ({ default: m.FeedbackPage })));
const SettingsPage = lazyWithRetry(() => import("../pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const MyReportsPage = lazyWithRetry(() => import("../pages/MyReportsPage").then((m) => ({ default: m.MyReportsPage })));
const ModelsPage = lazyWithRetry(() => import("../pages/ModelsPage").then((m) => ({ default: m.ModelsPage })));
const HelpPage = lazyWithRetry(() => import("../pages/HelpPage").then((m) => ({ default: m.HelpPage })));
const McpPage = lazyWithRetry(() => import("../pages/McpPage").then((m) => ({ default: m.McpPage })));
const IntegrationsPage = lazyWithRetry(() => import("../pages/IntegrationsPage").then((m) => ({ default: m.IntegrationsPage })));
const DownloadsPage = lazyWithRetry(() => import("../pages/DownloadsPage").then((m) => ({ default: m.DownloadsPage })));
const PlannerPage = lazyWithRetry(() => import("../pages/PlannerPage").then((m) => ({ default: m.PlannerPage })));
const DatabasesPage = lazyWithRetry(() => import("../pages/DatabasesPage").then((m) => ({ default: m.DatabasesPage })));
const ChatPage = lazyWithRetry(() => import("../pages/ChatPage").then((m) => ({ default: m.ChatPage })));
const Launchpad = lazyWithRetry(() => import("../pages/Launchpad").then((m) => ({ default: m.Launchpad })));
const ProjectPage = lazyWithRetry(() => import("../pages/ProjectPage").then((m) => ({ default: m.ProjectPage })));
const ShareTargetPage = lazyWithRetry(() => import("../pages/ShareTargetPage").then((m) => ({ default: m.ShareTargetPage })));
const CommunityPage = lazyWithRetry(() => import("../pages/CommunityPage").then((m) => ({ default: m.CommunityPage })));

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
          <div className="page-shell secondary-page admin-tool-page">
            <SecondaryPageHeader
              eyebrow="組別設定"
              title="工作規則與選項"
              icon="SlidersHorizontal"
              badge="只影響目前組別"
              description={<>調整可用的內容類型、風格、標籤與 AI 規則；日常成員只會看到啟用中的選項。</>}
            />
            <GroupOptionsEditor groupId={activeGroupId} />
          </div>
        ) : (
          <p className="error">
            這頁需要組長或管理員權限 — <Link href="/dashboard">回今日工作台</Link>
          </p>
        )}
      </Route>
      <Route path="/logs">
        {canSeeOrg ? (
          // 組長也可看點數消耗與洞察；後端會按呼叫者權限收斂到其可管理範圍。
          <div className="page-shell secondary-page secondary-page--reading admin-tool-page">
            <SecondaryPageHeader
              eyebrow="營運觀測"
              title="用量與活動紀錄"
              icon="Scale"
              badge="依管理權限顯示"
              description={<>查看點數消耗、模型使用、近期操作與異常線索，快速找到需要調整或追蹤的地方。</>}
            />
            <div className="stack">
              <ConsumptionMonitorCard />
              <InsightsCard />
              <AuditLogCard />
            </div>
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
      <Route path="/settings"><SettingsPage /></Route>
      <Route path="/my-reports"><MyReportsPage /></Route>
      <Route path="/models"><ModelsPage /></Route>
      <Route path="/help"><HelpPage /></Route>
      <Route path="/mcp"><McpPage /></Route>
      <Route path="/integrations"><IntegrationsPage /></Route>
      <Route path="/downloads"><DownloadsPage /></Route>
      <Route path="/chat/:peerId">{(params) => <ChatPage peerId={params.peerId} />}</Route>
      <Route path="/chat"><ChatPage /></Route>
      {/* Web Share Target（Android 安裝版）：SW 收下分享的 POST 後 303 到這裡認領 */}
      <Route path="/share-target"><ShareTargetPage groupId={activeGroupId} /></Route>
      <Route path="/planner"><PlannerPage groupId={activeGroupId} /></Route>
      <Route path="/databases"><DatabasesPage groupId={activeGroupId} /></Route>
      <Route path="/community"><CommunityPage /></Route>
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
      <Route path="/settings"><SettingsPage /></Route>
      <Route path="/help"><HelpPage /></Route>
      {/* MCP 金鑰屬帳號層級；未分組時仍可先建立，實際連入後仍由服務端權限隔離。 */}
      <Route path="/mcp"><McpPage /></Route>
      {/* Google、Notion、外部 API 整合都綁個人帳號，不依賴組別。 */}
      <Route path="/integrations"><IntegrationsPage /></Route>
      {/* 未分組期間仍可能需要聯絡管理員；可訊範圍由後端守門。 */}
      <Route path="/chat/:peerId">{(params) => <ChatPage peerId={params.peerId} />}</Route>
      <Route path="/chat"><ChatPage /></Route>
      {/* 分享收件：未分組只能「傳給夥伴」（頁內已依 groupId 空值收斂選項） */}
      <Route path="/share-target"><ShareTargetPage groupId="" /></Route>
      <Route>
        <EmptyState icon={<Icon name="Clock" />} title={<>你已成功加入 ✓ 還差一步</>} description={<>帳號建立完成，只是還沒被分進任何組別。請聯絡你的組長或管理員把你加入組——加入後重新整理這一頁，就能開始創作。</>} action={<><Hint layer="always">等待的時候可以先<Link href="/help">看看怎麼用</Link>，了解點數、生成與審核是怎麼運作的。</Hint></>} style={{ marginTop: "var(--sp-32)" }} />
      </Route>
    </Switch>
  );
}
