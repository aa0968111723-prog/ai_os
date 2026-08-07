import { Suspense, useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { trpc } from "../api";
import { FeedbackWidget } from "../feedback/FeedbackWidget";
import { FloatingDmBubble } from "../components/FloatingDmBubble";
import { NotificationSettingsDialog, PushSubscriptionSync } from "../components/NotificationSettings";
import { AppUpdateBanner } from "../components/AppUpdateBanner";
import { unsubscribeThisDevice } from "../push";
import { SplashScreen } from "../components/SplashScreen";
import { ChangePasswordDialog } from "./session/ChangePasswordDialog";
import { SessionGate } from "./SessionGate";
import { AppHeader } from "./components/AppHeader";
import { MobileNavigation } from "./components/MobileNavigation";
import { RouteFallback } from "../components/RouteFallback";
import { Button } from "../components/ui";
import { Icon } from "../components/Icon";

const SPLASH_SESSION_KEY = "aios.splash.seen";

/**
 * 未登入時分享進來的檔案會留在 SHARE_CACHE（SW 收下後 303，登入流程中不會丟）——
 * 但登入後沒有任何入口喚回，實測會無聲滯留。這裡在登入後檢查一次，
 * 有待存分享就顯示一條回去認領的 banner（在分享收件頁本身時不顯示）。
 */
function ShareInboxRescue() {
  const [location, navigate] = useLocation();
  const [hasInbox, setHasInbox] = useState(false);
  useEffect(() => {
    if (!("caches" in window)) return;
    let alive = true;
    void caches.open("aios-share-inbox")
      .then((cache) => cache.match("/share-payload/meta"))
      .then((hit) => { if (alive) setHasInbox(!!hit); })
      .catch(() => {});
    return () => { alive = false; };
  }, [location]);
  if (!hasInbox || location === "/share-target") return null;
  return (
    <div className="share-rescue-banner" role="status">
      <Icon name="Download" size={15} />
      <span>你有一批分享進來、還沒存的檔案</span>
      <Button size="sm" variant="primary" onClick={() => navigate("/share-target")}>去存入</Button>
    </div>
  );
}

function shouldShowSplash(): boolean {
  try {
    if (sessionStorage.getItem(SPLASH_SESSION_KEY) === "1") return false;
    sessionStorage.setItem(SPLASH_SESSION_KEY, "1");
    return true;
  } catch {
    return true;
  }
}

function pageTitle(pathname: string): string {
  // #273：與 brand.ts BRAND_NAME 對齊（Aios）
  if (pathname === "/") return "Aios｜把想法變成可執行的團隊計畫";
  if (pathname === "/login") return "登入｜Aios";
  if (pathname === "/dashboard") return "今日工作台｜Aios";
  if (pathname.startsWith("/p/")) return "專案｜Aios";
  // 分享連結的唯讀檢視：頁面自己會在拿到資料後改成專案名，這裡先給中性標題，
  // 不要讓外部訪客的分頁標題直接掛上產品名以外的內部字樣
  if (pathname.startsWith("/s/")) return "專案檢視｜Aios";
  if (pathname.startsWith("/planner")) return "筆記排程｜Aios";
  if (pathname.startsWith("/databases")) return "知識資料｜Aios";
  if (pathname.startsWith("/studio")) return "動畫創作室｜Aios";
  if (pathname.startsWith("/chat")) return "訊息｜Aios";
  return "Aios";
}

/**
 * App chrome composer: session/group state, header, routes, dialogs.
 * Header / nav / account menu live in `./components/*` (TD-06).
 */
export function AppShell() {
  const utils = trpc.useUtils();
  const [location, navigate] = useLocation();
  /**
   * 首屏只打一支 sessionBoot.bootstrap（伺服器聚合 me + 未讀 + mock）。
   * 裝置不再並行三支 API；輪詢也只打這一支，由伺服器重算未讀。
   *
   * retry 只試 1 次：預設 3 次會讓 SessionGate 長時間停在「載入中…」，
   * 使用者感覺「除了首頁其他頁都壞了」。失敗改由 SessionGate 顯示可點重試。
   */
  const boot = trpc.sessionBoot.bootstrap.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
    refetchInterval: (q) => (q.state.data?.me ? 60_000 : false),
  });
  // 有舊資料時不把整站當 loading（背景 refetch 不應擋住路由）
  const meLoading = boot.isLoading && !boot.data;
  const me = {
    data: boot.data?.me ?? undefined,
    isLoading: meLoading,
    isError: boot.isError,
    error: boot.error,
    refetch: boot.refetch,
  };
  const info = { data: boot.data ? { mockMode: boot.data.mockMode } : undefined };
  const dmUnread = { data: boot.data ? { total: boot.data.unreadTotal } : undefined };

  const logout = trpc.auth.logout.useMutation({
    onSuccess: () => {
      void utils.sessionBoot.bootstrap.invalidate();
      void utils.auth.me.invalidate();
    },
  });
  const logoutAll = trpc.auth.logoutAll.useMutation({
    onSuccess: () => {
      void utils.sessionBoot.bootstrap.invalidate();
      void utils.auth.me.invalidate();
    },
  });
  const touchSession = trpc.auth.touchSession.useMutation();
  const pushUnsubscribe = trpc.push.unsubscribe.useMutation();
  // 登出＝連推播一起解除本裝置（共用電腦隱私：登出後這台機器不能再跳你的私訊/核准通知）。
  // 盡力而為：解除失敗不擋登出；要再收通知，下次登入後到「連結手機與電腦」重新啟用。
  const logoutWithPushCleanup = async () => {
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await pushUnsubscribe.mutateAsync({ endpoint });
    } catch { /* 推播清理失敗照樣登出 */ }
    logout.mutate();
  };
  /** 登出全部裝置：撤銷所有 sessions 後本機換發新 cookie；不撤 MCP（見 AUTH-01）。 */
  const logoutAllDevices = async () => {
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await pushUnsubscribe.mutateAsync({ endpoint });
    } catch { /* 推播清理失敗照樣登出全部 */ }
    logoutAll.mutate();
  };

  // AUTH-01 sliding：掛載與回到前景時節流呼叫 touchSession（本地 6h），
  // server 僅在剩餘 < 7 天才寫 DB／刷新 cookie，避免每請求寫庫。
  useEffect(() => {
    if (!me.data?.user?.id) return;
    const TOUCH_KEY = "aios.session.touchAt";
    const TOUCH_MIN_MS = 6 * 3600_000;
    const maybeTouch = () => {
      try {
        const last = Number(localStorage.getItem(TOUCH_KEY) || "0");
        if (Number.isFinite(last) && Date.now() - last < TOUCH_MIN_MS) return;
        localStorage.setItem(TOUCH_KEY, String(Date.now()));
      } catch {
        /* private mode：仍嘗試 touch，靠 server 不寫庫節流 */
      }
      touchSession.mutate();
    };
    maybeTouch();
    const onVis = () => {
      if (document.visibilityState === "visible") maybeTouch();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // touchSession 穩定 mutation 物件；刻意只跟登入 user id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me.data?.user?.id]);

  // Service Worker 點通知後若無法 navigate，會 postMessage 請前端路由
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      // #274：擋協議相對路徑 //evil.com（startsWith("/") 仍為 true）
      if (
        data?.type === "aios:navigate" &&
        typeof data.url === "string" &&
        data.url.startsWith("/") &&
        !data.url.startsWith("//")
      ) {
        navigate(data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [navigate]);

  useEffect(() => {
    document.title = pageTitle(location);
  }, [location]);

  // 組切換（多組成員）：記住上次選的組
  const groups = me.data?.groups ?? [];
  const [activeGroupId, setActiveGroupId] = useState<string>(() => {
    try { return localStorage.getItem("aidos_group") ?? ""; }
    catch { return ""; }
  });
  useEffect(() => {
    if (groups.length && !groups.some((g) => g.groupId === activeGroupId)) {
      setActiveGroupId(groups[0].groupId);
    }
  }, [groups, activeGroupId]);
  useEffect(() => {
    if (!activeGroupId) return;
    try { localStorage.setItem("aidos_group", activeGroupId); } catch { /* 無痕／停用儲存時僅不記住組別 */ }
  }, [activeGroupId]);

  const isAdmin = !!me.data && (me.data.user.isSuperAdmin || me.data.adminTeamIds.length > 0);
  // 目前作用組的角色：組長或管理員才做得了組級設定（就地新增選項、點數分配、審核門檻、/options 整理頁）
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
  const [splashDone, setSplashDone] = useState(() => !shouldShowSplash());

  return (
    <div className="app">
      {me.data && <a className="skip-link" href="#main-content">跳到主要內容</a>}
      {!splashDone && (
        <SplashScreen ready={!me.isLoading} onDone={() => setSplashDone(true)} />
      )}
      {/* 強制改密碼時整塊背景 inert：對話框遮罩只擋滑鼠，Tab 仍能聚焦到背景，要靠 inert 一起擋 */}
      <div inert={(mustChangePw || showChangePw || showNotifSettings) || undefined}>
        {me.data && <AppHeader
          userName={me.data?.user.name}
          avatarUrl={me.data?.user.avatarUrl}
          me={me.data}
          groups={groups}
          activeGroupId={activeGroupId}
          onActiveGroupIdChange={setActiveGroupId}
          isAdmin={isAdmin}
          activeIsLeader={activeIsLeader}
          canSeeOrg={canSeeOrg}
          mockMode={info.data?.mockMode}
          onChangePw={() => setShowChangePw(true)}
          onNotifSettings={() => setShowNotifSettings(true)}
          onLogout={() => { void logoutWithPushCleanup(); }}
          onLogoutAll={() => { void logoutAllDevices(); }}
          loggingOut={logout.isPending || logoutAll.isPending}
        />}

        {/* 新版已下載完成時由使用者主動更新；不在編輯途中自動刷新。 */}
        <AppUpdateBanner />
        {me.data && <ShareInboxRescue />}

        {/* lazy 頁面載入中的過場：RouteFallback 超過門檻可強制重整，避免 chunk 卡住永遠「載入中」 */}
        {me.data ? (
          <>
            <main id="main-content" className="app-main" tabIndex={-1}>
              <Suspense fallback={<RouteFallback />}>
                <SessionGate
                  me={me.data}
                  meLoading={me.isLoading}
                  meError={!!me.error}
                  onRetry={() => { void me.refetch(); }}
                  isAdmin={isAdmin}
                  activeGroupId={activeGroupId}
                  activeIsLeader={activeIsLeader}
                  canSeeOrg={canSeeOrg}
                />
              </Suspense>
            </main>
            <MobileNavigation dmUnread={dmUnread.data?.total ?? 0} groupId={activeGroupId} />
          </>
        ) : (
          <Suspense fallback={<RouteFallback />}>
            <SessionGate
              me={me.data}
              meLoading={me.isLoading}
              meError={!!me.error}
              onRetry={() => { void me.refetch(); }}
              isAdmin={isAdmin}
              activeGroupId={activeGroupId}
              activeIsLeader={activeIsLeader}
              canSeeOrg={canSeeOrg}
            />
          </Suspense>
        )}
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

      {/* 私訊 Messenger 風格小球球（左下角）；偏好可在「連結手機與電腦」關閉 */}
      {me.data && <FloatingDmBubble />}
    </div>
  );
}
