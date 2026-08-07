import { lazy, Suspense, type RefObject } from "react";
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

/**
 * 全站 AI 助手：底部導覽正中央那顆球按下去的東西。
 *
 * 在這之前，那顆球只是 `/dashboard#ai-work` 的捲動錨點——按下去會跳回今日
 * 工作台捲到「繼續創作」那一格。而組級問答的後端（teamAssistant.ask，9 個
 * 跨專案唯讀工具）與前端（AICreativeCopilot）**都已經寫好，只是全站沒有任何
 * 頁面 import 它**。這張 sheet 就是把兩者接起來。
 *
 * ## 為什麼用 MenuSurface 而不是自己做一個浮層
 *
 * 手機貼底 sheet 有三個每個人都會單獨踩一次的陷阱（backdrop-filter 包含區塊、
 * z-index 被分頁列蓋住、portal 後外點誤判），MenuSurface 的檔頭把它們都記錄
 * 並解掉了。`surfaceRole="dialog"` 是刻意的：內容是輸入框與對話卡片，不是
 * role="menuitem" 的清單，宣告成 menu 等於對讀屏承諾了沒實作的方向鍵模型。
 *
 * ## 範圍（scope）
 *
 * 目前一律是「組級」——teamAssistant 的視野本來就是跨專案的組內全貌。
 * 使用者在專案頁裡叫出助手，看到的仍是組級視角而不是該專案的助手
 * （專案助手在工作台裡，另一個入口）。這件事現在由 MenuSurface 的
 * `label="AI 助手"`（＝對話框的 aria-label）承擔，畫面上不再放說明 chip。
 * 「在專案頁自動聚焦該專案」是下一階段的事，需要先把兩個核心收斂成一個，
 * 現在硬做只會變成第三套問答框。
 *
 * ## 兩個入口，同一張面板
 *
 * 手機是底部導覽正中央那顆球（MobileNavigation），桌機是頂欄的
 * AssistantLauncher——`.mobile-nav` 在 >820 是 display:none，所以在補上頂欄
 * 入口之前，桌機**完全叫不出助手**（球在 DOM 裡但按不到）。
 * 兩邊各自持有自己的開闔狀態，但因為兩顆觸發器互斥（一個只在 ≤820 顯示、
 * 另一個只在 >820 渲染），同一時間只有一張面板打得開。
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
  const [, navigate] = useLocation();

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
      {/* 可見標題與「範圍：整個組」的 chip 拿掉了：畫面上只留輸入框與四周的感知光。
          範圍資訊沒有消失——MenuSurface 的 label="AI 助手" 仍是這張對話框的
          aria-label，助手的視野本來就一律是組級，沒有第二種可選。 */}
      {groupId ? (
        <Suspense fallback={<Meta as="p">助手載入中…</Meta>}>
        {/* 調度面板放在問答上面：「叫 AI 去做一整件事」比「問 AI 一個問題」是更重的意圖，
            而它在自己不可用時（權限不足）完全不渲染，不會白佔一般組員的畫面。 */}
        <GroupCampaignPanel groupId={groupId} />
        <AICreativeCopilot
          groupId={groupId}
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
        </Suspense>
      ) : (
        <Meta as="p">還沒有選定的組——到頂欄選一個組之後，助手才知道要看誰的專案。</Meta>
      )}
    </MenuSurface>
  );
}
