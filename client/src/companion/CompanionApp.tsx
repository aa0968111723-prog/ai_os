import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { companionOrbToLegacy, deriveOrbState, type OrbState } from "@shared/companionOrb";
import { GlobalAssistantSheet } from "../app/components/GlobalAssistantSheet";
import { Icon, type IconName } from "../components/Icon";
import { RouteFallback } from "../components/RouteFallback";
import { lazyWithRetry } from "../lib/lazyWithRetry";
import { useAssistantComposeListener, useAssistantOpenListener } from "../lib/assistantCompose";
import { usePhoneAssistantTurn } from "../lib/phoneAssistantBridge";
import { setOrbState } from "../lib/orbState";
import { AiosOrb } from "./AiosOrb";
import { CompanionHome } from "./CompanionHome";
/**
 * Companion 的樣式跟著 Companion 的 chunk 走，不進全站 index.css。
 *
 * 整份 styles.companion.css 掛在 `html[data-surface="companion"]` 之下，所以就算
 * 放進 index.css 也不會影響桌面的畫面——但它仍會讓每一位桌機使用者多下載
 * 一份永遠不會命中的規則。從這裡 import，Vite 會把它切成 CompanionApp 的
 * 附屬 CSS chunk：只有真的渲染 Companion 的裝置才會抓。
 */
import "../styles.companion.css";

/**
 * Companion 外殼——手機原生 App 的整個導航。
 *
 * ## 三格，就這樣
 *
 * `AI｜任務｜我`。沒有專案分頁、沒有素材分頁、沒有「更多」面板裡再塞二十個入口。
 * 桌面版的 `MobileNavigation`（底欄＋全部功能面板）在 Companion 裡**不掛載**——
 * 它是手機 Web 殼層的東西，兩者同時掛會出現兩張助手面板（見該檔的擁有權說明）。
 *
 * ## 為什麼 AI 分頁就是整個 App
 *
 * 「任務」與「我」都只有一屏，而且兩者的每一個數字都能用一句話交給 AI 處理。
 * 它們存在的理由是**讓人知道還有什麼在等他**，不是讓人在裡面工作。
 *
 * ## 助手面板的擁有權
 *
 * Companion 掛一張 `GlobalAssistantSheet`（與手機 Web 完全同一個元件、同一條
 * compose 事件）。AppShell 在 Companion 外殼下不掛 `MobileNavigation`，
 * 所以每個寬度仍然只有一個主人——這條不變式沒有被打破，只是多了一個主人選項。
 *
 * ## 分頁是狀態，不是路由
 *
 * 刻意不給「任務」「我」自己的網址：Companion 的網址契約只有一個（App 開在首頁），
 * 而深連結一律指向 Web 工作站。加上 `/companion/tasks` 這種路由只會多出一組
 * 沒有人會分享、卻要永遠維護的網址。
 */
const CompanionTasks = lazyWithRetry(() => import("./CompanionTasks").then((m) => ({ default: m.CompanionTasks })));
const CompanionMe = lazyWithRetry(() => import("./CompanionMe").then((m) => ({ default: m.CompanionMe })));

export type CompanionTab = "ai" | "tasks" | "me";

const TABS: { id: CompanionTab; label: string; icon: IconName }[] = [
  { id: "ai", label: "AI", icon: "Sparkles" },
  { id: "tasks", label: "任務", icon: "Bell" },
  { id: "me", label: "我", icon: "User" },
];

/**
 * 進站時的分頁與語音意圖。
 *
 * 來源是桌面 Widget 與長按捷徑（見 android/app/src/main/res/xml/shortcuts.xml）：
 * `?tab=tasks` 直接開任務、`?voice=1` 直接進語音。只讀一次——之後使用者自己換分頁時
 * 不該因為網址還掛著參數而被拉回去。
 */
function initialTabFromUrl(): CompanionTab {
  if (typeof window === "undefined") return "ai";
  try {
    const tab = new URLSearchParams(window.location.search).get("tab");
    return tab === "tasks" || tab === "me" ? tab : "ai";
  } catch {
    return "ai";
  }
}

export function CompanionApp({
  groupId,
  userName,
  groups,
  onActiveGroupIdChange,
  unreadCount = 0,
}: {
  groupId: string;
  userName?: string;
  groups: { groupId: string; groupName: string; role: string }[];
  onActiveGroupIdChange: (groupId: string) => void;
  unreadCount?: number;
}) {
  const [tab, setTab] = useState<CompanionTab>(initialTabFromUrl);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const orbRef = useRef<HTMLButtonElement | null>(null);

  const openAssistant = useCallback(() => setAssistantOpen(true), []);
  // 有人對 Aios 說話（首頁輸入框、卡片按鈕、任務頁的數字）→ 面板要跟著開。
  useAssistantComposeListener(openAssistant);
  useAssistantOpenListener(openAssistant);

  const turn = usePhoneAssistantTurn({ groupId });
  const orb = deriveOrbState({
    thinking: !!turn?.running,
    awaitingConfirmation: (turn?.pendingProposals?.length ?? 0) > 0 || !!turn?.pendingInteraction,
    unreadNotifications: unreadCount,
  });

  /**
   * 與既有的 `<html data-orb-state>` 小球對齊。
   *
   * 那顆球是手機 Web 底欄的四態 CSS 開關，Companion 用不到它——但站內其他地方
   * （創作台、生成送出）仍會寫它。把 Companion 的八態投影回去，兩顆球才不會
   * 在同一個 App 裡講不同的話。
   */
  useEffect(() => {
    setOrbState(companionOrbToLegacy(orb.state));
  }, [orb.state]);


  return (
    <div className="companion" data-companion-tab={tab}>
      <main id="main-content" className="companion__main" tabIndex={-1}>
        {tab === "ai" && (
          <CompanionHome
            groupId={groupId}
            {...(userName ? { userName } : {})}
            onOpenTab={setTab}
          />
        )}
        {tab === "tasks" && (
          <Suspense fallback={<RouteFallback />}>
            <CompanionTasks groupId={groupId} />
          </Suspense>
        )}
        {tab === "me" && (
          <Suspense fallback={<RouteFallback />}>
            <CompanionMe
              {...(userName ? { userName } : {})}
              groups={groups}
              activeGroupId={groupId}
              onActiveGroupIdChange={onActiveGroupIdChange}
            />
          </Suspense>
        )}
      </main>

      <GlobalAssistantSheet
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        groupId={groupId}
        triggerRef={orbRef}
      />

      <nav className="companion-nav" aria-label="主要功能">
        {TABS.map((item) => {
          const active = tab === item.id;
          // 正中央那格是球本人，不是圖示——Companion 的主體從頭到尾都是它。
          if (item.id === "ai") {
            return (
              <button
                key={item.id}
                type="button"
                ref={orbRef}
                className={`companion-nav__orb${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => (active ? setAssistantOpen(true) : setTab("ai"))}
              >
                <AiosOrb
                  state={miniState(orb.state)}
                  size={44}
                  className="companion-nav__orb-visual"
                />
                <span>{item.label}</span>
              </button>
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              className={active ? "is-active" : ""}
              aria-current={active ? "page" : undefined}
              onClick={() => setTab(item.id)}
            >
              <span className="companion-nav__icon">
                <Icon name={item.icon} size={20} />
                {item.id === "tasks" && unreadCount > 0 && (
                  <span className="companion-nav__dot" aria-hidden="true" />
                )}
              </span>
              <span>
                {item.label}
                {item.id === "tasks" && unreadCount > 0 && (
                  <span className="sr-only">（有 {unreadCount} 則未讀）</span>
                )}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

/**
 * 分頁列那顆小球只播三種狀態。
 *
 * 44px 上畫不出進度環的差別，也讀不出「等你確認」與「有新提醒」的顏色差；
 * 硬要全部畫出來只會變成一顆一直在閃的彩色點。真正的狀態在首頁那顆大球上。
 */
function miniState(state: OrbState): OrbState {
  if (state === "thinking" || state === "executing") return "thinking";
  if (state === "waiting_confirmation" || state === "notification" || state === "error") return "notification";
  return "idle";
}

export default CompanionApp;
