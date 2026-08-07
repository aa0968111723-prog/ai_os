import { lazy, Suspense, useEffect, useState, type RefObject } from "react";
import { useLocation } from "wouter";
import { MenuSurface } from "./MenuSurface";
import { Meta } from "../../components/ui";

/**
 * 助手本體延後載入。
 *
 * 分頁列是登入後**全站常駐**的元件，直接 import 會把整個問答 UI（含 markdown
 * 呈現、快捷提示、對話狀態）壓進首屏 chunk。DECISIONS.md D-006 記載首屏 JS
 * 已是 206.5KB gzip、超過 180KB 門檻——不能為了一顆按鈕再加。
 * 使用者按下球才載，等待期間 sheet 已經開好、顯示一行「載入中」。
 */
const AICreativeCopilot = lazy(() =>
  import("../../components/AICreativeCopilot").then((m) => ({ default: m.AICreativeCopilot })),
);

/**
 * 調度面板同樣延後載入，而且是**條件渲染**：只有「可總指揮」的人看得到它，
 * 但 lazy 是以 import 為單位的——寫成靜態 import 的話，全站每個人的首屏都會扛上
 * 這段只有少數人按得到的程式碼。
 */
const GroupCampaignPanel = lazy(() =>
  import("../../features/group-campaign/GroupCampaignPanel").then((m) => ({ default: m.GroupCampaignPanel })),
);

/** 專案模式的本體：既有的專案助手（SSE 軌跡＋工具預覽＋動作確認卡全部內建），embedded 由外殼供框 */
const ProjectAssistant = lazy(() =>
  import("../../components/ProjectAssistant").then((m) => ({ default: m.ProjectAssistant })),
);

/**
 * Scope 路由（deterministic，GLOBAL_ASSISTANT_PLAN §3.3）：
 * 只認兩種專案路徑（/p/:id、/studio/:projectId）。不靠 LLM、不靠猜——
 * route 說你在專案裡，助手就預設聚焦這個專案；chip 可一鍵切回整個組。
 * 伺服器端永遠用 requireGroup／專案查詢重驗，偽造 route 只會看到你本來就有權看的東西。
 */
export function projectIdFromRoute(path: string): string | null {
  const m = /^\/(?:p|studio)\/([0-9a-fA-F-]{36})(?:\/|$)/.exec(path);
  return m ? m[1] : null;
}

/**
 * 全站 AI 助手：底部導覽正中央那顆球（手機）與頂欄 AssistantLauncher（桌機）按下去的東西。
 *
 * ## 範圍（scope）
 *
 * 這張 sheet 現在有兩種視野，由目前路徑 deterministic 決定預設：
 * - **專案頁**（/p/:id、/studio/:projectId）：預設聚焦該專案——直接渲染既有的
 *   ProjectAssistant（SSE 軌跡、工具結果預覽、七種動作確認卡全數繼承），
 *   頂部 chip 可切回「整個組」。
 * - **其他頁**：組級視野（globalAssistant.ask）——組內全專案現況問答、派工／指令提議，
 *   以及站級動作確認卡（建專案／筆記／行程／任務／私訊）。
 *
 * 兩種視野是同一顆球的兩個焦距，不是兩個產品：組級核心（globalAssistant.ask）
 * 與組助手共用同一份上下文組裝；專案模式與工作台側欄共用同一個 ProjectAssistant。
 *
 * ## 為什麼用 MenuSurface 而不是自己做一個浮層
 *
 * 手機貼底 sheet 有三個每個人都會單獨踩一次的陷阱（backdrop-filter 包含區塊、
 * z-index 被分頁列蓋住、portal 後外點誤判），MenuSurface 的檔頭把它們都記錄
 * 並解掉了。`surfaceRole="dialog"` 是刻意的：內容是輸入框與對話卡片，不是
 * role="menuitem" 的清單，宣告成 menu 等於對讀屏承諾了沒實作的方向鍵模型。
 */
export function GlobalAssistantSheet({
  open,
  onClose,
  groupId,
  triggerRef,
}: {
  open: boolean;
  onClose: () => void;
  /** 頂欄目前作用中的組；未選組時助手不可用（送出會被後端擋，這裡先講清楚） */
  groupId: string;
  triggerRef: RefObject<HTMLElement | null>;
}) {
  const [location, navigate] = useLocation();
  const projectId = projectIdFromRoute(location);
  // 使用者手動切過的視野；換到另一個專案（或離開專案頁）就回到 route 的預設
  const [scopeOverride, setScopeOverride] = useState<"project" | "group" | null>(null);
  useEffect(() => {
    setScopeOverride(null);
  }, [projectId]);
  const scope: "project" | "group" = projectId ? (scopeOverride ?? "project") : "group";

  const goTo = (href: string) => {
    onClose();
    navigate(href);
  };

  return (
    <MenuSurface
      open={open}
      onClose={onClose}
      label="AI 助手"
      id="global-assistant-sheet"
      surfaceRole="dialog"
      roving={false}
      /* 桌機也用同一套浮層：助手的外觀是「鋪滿視窗的感知光 ＋ 浮著的輸入框」，
         退回頂欄底下的錨定下拉會變成兩種完全不同的東西。 */
      forceSheet
      placement="stretch"
      minWidth={360}
      className="global-assistant"
      triggerRef={triggerRef}
    >
      {groupId ? (
        <>
          {/* 視野 chip：只在專案頁出現（其他頁只有一種視野，chip 是噪音）。
              radiogroup 語義：兩檔互斥、恆有一檔選中。 */}
          {projectId && (
            <div className="ga-scope" role="radiogroup" aria-label="助手視野">
              <button
                type="button"
                role="radio"
                aria-checked={scope === "project"}
                className={`ga-scope__chip${scope === "project" ? " is-active" : ""}`}
                onClick={() => setScopeOverride("project")}
              >
                這個專案
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scope === "group"}
                className={`ga-scope__chip${scope === "group" ? " is-active" : ""}`}
                onClick={() => setScopeOverride("group")}
              >
                整個組
              </button>
            </div>
          )}
          <Suspense fallback={<Meta as="p">助手載入中…</Meta>}>
            {scope === "project" && projectId ? (
              <>
                {/* 調度面板在專案模式也要在：它收合成一列、無權限者完全不渲染，
                    但「有計畫等你核准」的徽章不能因為人在專案頁就看不見——
                    組長常駐專案頁工作，把核准提示藏在「整個組」chip 後面等於沒提醒。 */}
                <GroupCampaignPanel groupId={groupId} collapsible />
                {/* key=projectId：換專案時整棵重掛，對話與軌跡不殘留上一個專案的內容 */}
                <ProjectAssistant key={projectId} projectId={projectId} embedded />
              </>
            ) : (
              <>
                {/* 調度面板放在問答上面：「叫 AI 去做一整件事」比「問 AI 一個問題」是更重的意圖，
                    而它在自己不可用時（權限不足）完全不渲染，不會白佔一般組員的畫面。 */}
                <GroupCampaignPanel groupId={groupId} collapsible />
                <AICreativeCopilot
                  groupId={groupId}
                  projectId={projectId ?? undefined}
                  onNavigate={goTo}
                  onUseIdeaForNewProject={(ideaTitle) => {
                    // 建專案是寫入動作——這裡只把想法帶到建立流程，不代按確認。
                    // 真正的建立仍在 Launchpad 的建立專案表單，由使用者自己送出。
                    onClose();
                    navigate(`/dashboard#projects`);
                    window.setTimeout(() => {
                      window.dispatchEvent(new CustomEvent("aios:new-project-idea", { detail: { ideaTitle } }));
                    }, 0);
                  }}
                />
              </>
            )}
          </Suspense>
        </>
      ) : (
        <Meta as="p">還沒有選定的組——到頂欄選一個組之後，助手才知道要看誰的專案。</Meta>
      )}
    </MenuSurface>
  );
}
