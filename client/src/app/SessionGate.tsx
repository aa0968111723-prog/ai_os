import { useEffect, useState } from "react";
import { Redirect, Route, Switch, useLocation } from "wouter";
import { LandingPage } from "../pages/LandingPage";
import { LoginPage } from "../pages/LoginPage";
import { AppRoutes, UngroupedRoutes } from "./AppRoutes";
import { Button, Meta } from "../components/ui";
import { safeInternalPath } from "../lib/safePath";
import { lazyWithRetry } from "../lib/lazyWithRetry";

/**
 * 這三頁靜態 import 時全部躺在首屏 entry chunk 裡（約 28KB 原始碼），
 * 但它們都是「一輩子可能只走一次」的入口：邀請連結、對外分享檢視、桌面版配對。
 * 一般登入者的每一次開站都在替這三頁付錢。改 lazy，網址契約與行為不變。
 * 外層 AppShell 已有 <Suspense fallback={<RouteFallback />}> 承接載入過場。
 */
const AcceptInvitePage = lazyWithRetry(() => import("../pages/AcceptInvitePage").then((m) => ({ default: m.AcceptInvitePage })));
const SharedProjectPage = lazyWithRetry(() => import("../pages/SharedProjectPage").then((m) => ({ default: m.SharedProjectPage })));
const DesktopCompanionPage = lazyWithRetry(() => import("../pages/DesktopCompanionPage").then((m) => ({ default: m.DesktopCompanionPage })));

export type SessionMe = {
  user: { isSuperAdmin: boolean; mustChangePassword: boolean };
  groups: { groupId: string; role: string }[];
  adminTeamIds: string[];
} | null | undefined;

/** 只接受同源站內路徑：safeInternalPath（/ 開頭、非 //、無反斜線、無控制字元），防 open-redirect */

/**
 * 未登入被踢到 /login 時把「原本要去哪」帶上（returnTo）：
 * session 過期點推播深連結（/p/xxx?focus=scene-yyy）→ 登入後回到原目標，
 * 不再一律落在 /dashboard 逼人重找。wouter location 不含 query，直接讀 window.location。
 */
function RedirectToLogin() {
  const current = typeof window === "undefined"
    ? "/"
    : window.location.pathname + window.location.search + window.location.hash;
  const next = safeInternalPath(current);
  const carry = next && next !== "/" && !next.startsWith("/login") ? `?next=${encodeURIComponent(next)}` : "";
  return <Redirect to={`/login${carry}`} replace />;
}

/** 已登入狀態下的 /login：有合法 next 就回原目標，否則回工作台 */
function RedirectFromLogin() {
  const next = typeof window === "undefined"
    ? null
    : safeInternalPath(new URLSearchParams(window.location.search).get("next"));
  return <Redirect to={next ?? "/dashboard"} replace />;
}

/** bootstrap 超過此時間仍未回來 → 顯示可操作的重試，避免整站永遠「載入中…」 */
const SESSION_LOADING_SOFT_MS = 6_000;
const SESSION_LOADING_HARD_MS = 14_000;

/** 會一直卡在「載入中」的 session 閘門：超過 soft 提示慢、超過 hard 給重試／去登入 */
function SessionLoading({ onRetry }: { onRetry: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t0 = Date.now();
    const id = window.setInterval(() => setElapsed(Date.now() - t0), 500);
    return () => window.clearInterval(id);
  }, []);

  if (elapsed < SESSION_LOADING_SOFT_MS) {
    return <Meta as="p" role="status" aria-busy="true">載入中…</Meta>;
  }

  const stuck = elapsed >= SESSION_LOADING_HARD_MS;
  return (
    <div role="status" aria-busy={!stuck} style={{ maxWidth: 420, margin: "24px auto", padding: "0 16px" }}>
      <Meta as="p" style={{ marginBottom: 12 }}>
        {stuck
          ? "連線偏慢或伺服器暫時沒回應——不是你被登出。可重試，或先去登入頁。"
          : "連線比平常慢一點，還在等伺服器回應…"}
      </Meta>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="primary" onClick={onRetry}>重試</Button>
        <Button size="sm" variant="ghost" onClick={() => { window.location.href = "/login"; }}>
          去登入
        </Button>
        {stuck && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const url = new URL(window.location.href);
              url.searchParams.set("_r", String(Date.now()));
              window.location.replace(url.toString());
            }}
          >
            強制重新整理
          </Button>
        )}
      </div>
    </div>
  );
}

export type SessionGateProps = {
  me: SessionMe;
  meLoading: boolean;
  meError: boolean;
  onRetry: () => void;
  isAdmin: boolean;
  activeGroupId: string;
  activeIsLeader: boolean;
  canSeeOrg: boolean;
};

/**
 * Session / auth branching for the catch-all app tree:
 * invite route → loading → error → unauthenticated (login) →
 * signed-in but ungrouped → fully authenticated routes.
 *
 * Forced password-change is handled as an overlay in AppShell (mustChangePassword),
 * not as a separate route branch.
 */
export function SessionGate({
  me,
  meLoading,
  meError,
  onRetry,
  isAdmin,
  activeGroupId,
  activeIsLeader,
  canSeeOrg,
}: SessionGateProps) {
  const [location] = useLocation();
  return (
    <Switch>
      <Route path="/invite/:token">{(params) => <AcceptInvitePage token={params.token} />}</Route>
      {/* 專案分享連結：與 /invite 同層、刻意排在所有登入分支之前——
          它的存取憑證就是網址裡的 token，未登入的訪客不該被推去 /login。
          已登入的人打開同一條連結也走這裡（看到的一樣是唯讀畫面，不是專案頁）。 */}
      <Route path="/s/:token">{(params) => <SharedProjectPage token={params.token} />}</Route>
      <Route>
        {meError && location === "/" ? (
          <LandingPage />
        ) : meError && location === "/login" ? (
          // #281：auth.me 失敗時仍允許進登入表單（否則連不上後端時永遠看不到登入頁）
          <LoginPage />
        ) : meLoading ? (
          <SessionLoading onRetry={onRetry} />
        ) : meError ? (
          <p className="error">
            系統暫時連不上（不是你被登出）——請稍候重新整理，或按{" "}
            <Button size="sm" onClick={onRetry}>重試</Button>
            {" · "}
            <Button size="sm" variant="ghost" onClick={() => { window.location.href = "/login"; }}>
              去登入
            </Button>
          </p>
        ) : !me ? (
          <Switch>
            <Route path="/"><LandingPage /></Route>
            <Route path="/login"><LoginPage /></Route>
            <Route><RedirectToLogin /></Route>
          </Switch>
        ) : me.groups.length === 0 && !me.user.isSuperAdmin && !isAdmin ? (
          // 團隊管理員不擋（!isAdmin）：他本人就能去「團隊管理」建組，擋住反而是自相矛盾的死路。
          // /help 保持可達——等待被加入組的空檔正是最需要說明的時候
          <UngroupedRoutes onRefresh={onRetry} />
        ) : (
          <Switch>
            <Route path="/login"><RedirectFromLogin /></Route>
            {/* 桌面剪輯連接只在已登入且已有專案權限時可進；頁面內再辨識是否真為 Tauri 桌面環境。 */}
            <Route path="/desktop"><DesktopCompanionPage /></Route>
            <Route>
              <AppRoutes
                activeGroupId={activeGroupId}
                isAdmin={isAdmin}
                activeIsLeader={activeIsLeader}
                canSeeOrg={canSeeOrg}
              />
            </Route>
          </Switch>
        )}
      </Route>
    </Switch>
  );
}
