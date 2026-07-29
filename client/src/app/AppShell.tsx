import { Suspense, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "../api";
import { FeedbackWidget } from "../feedback/FeedbackWidget";
import { NotificationSettingsDialog, PushSubscriptionSync } from "../components/NotificationSettings";
import { AppUpdateBanner } from "../components/AppUpdateBanner";
import { unsubscribeThisDevice } from "../push";
import { SplashScreen } from "../components/SplashScreen";
import { ChangePasswordDialog } from "./session/ChangePasswordDialog";
import { SessionGate } from "./SessionGate";
import { AppHeader } from "./components/AppHeader";

/**
 * App chrome composer: session/group state, header, routes, dialogs.
 * Header / nav / account menu live in `./components/*` (TD-06).
 */
export function AppShell() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const me = trpc.auth.me.useQuery();
  const logout = trpc.auth.logout.useMutation({ onSuccess: () => utils.auth.me.invalidate() });
  const pushUnsubscribe = trpc.push.unsubscribe.useMutation();
  // 登出＝連推播一起解除本裝置（共用電腦隱私：登出後這台機器不能再跳你的私訊/審批通知）。
  // 盡力而為：解除失敗不擋登出；要再收通知，下次登入後到「連結手機與電腦」重新啟用。
  const logoutWithPushCleanup = async () => {
    try {
      const endpoint = await unsubscribeThisDevice();
      if (endpoint) await pushUnsubscribe.mutateAsync({ endpoint });
    } catch { /* 推播清理失敗照樣登出 */ }
    logout.mutate();
  };
  const info = trpc.generation.info.useQuery(undefined, { enabled: !!me.data });

  // Service Worker 點通知後若無法 navigate，會 postMessage 請前端路由
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | undefined;
      if (data?.type === "aios:navigate" && typeof data.url === "string" && data.url.startsWith("/")) {
        navigate(data.url);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [navigate]);

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
  // 通訊錄／操作紀錄：只要在「任一組」是組長或管理員就能看（跨組彙總）——比照後端 directory/audit 的可見界；
  // 不可只看「作用中的組」的角色，否則多組組長切到自己是純組員的那一組時會被誤擋在外。
  const canSeeOrg = isAdmin || groups.some((g) => g.role !== "member");
  const [showChangePw, setShowChangePw] = useState(false);
  const [showNotifSettings, setShowNotifSettings] = useState(false);
  // 管理員重設密碼後：不論在哪個路由都用強制對話框擋住，改完密碼（auth.me 重查）才放行
  const mustChangePw = !!me.data?.user.mustChangePassword;
  // 進站 splash：auth 就緒後淡出；不阻擋互動路徑以外的預載，僅首次掛載
  const [splashDone, setSplashDone] = useState(false);

  return (
    <div className="app">
      {!splashDone && (
        <SplashScreen ready={!me.isLoading} onDone={() => setSplashDone(true)} />
      )}
      {/* 強制改密碼時整塊背景 inert：對話框遮罩只擋滑鼠，Tab 仍能聚焦到背景，要靠 inert 一起擋 */}
      <div inert={(mustChangePw || showChangePw || showNotifSettings) || undefined}>
        <AppHeader
          userName={me.data?.user.name}
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
          loggingOut={logout.isPending}
        />

        {/* 新版已下載完成時由使用者主動更新；不在編輯途中自動刷新。 */}
        <AppUpdateBanner />

        {/* lazy 頁面載入中的過場（QA-025 code-splitting）：整個路由樹共用一個 Suspense */}
        <Suspense fallback={<p className="hint">載入中…</p>}>
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
    </div>
  );
}
