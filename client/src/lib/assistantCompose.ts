import { useEffect } from "react";

/**
 * 「把這句話交給 Aios」的單一接縫。
 *
 * 為什麼是事件而不是 context：助手面板的開關狀態分別握在兩個擁有者手上
 * （桌機 `AssistantLauncher`、手機 `MobileNavigation`），而發話端可能是任何一個
 * 表面（創作台的情境命令列、手機首頁與專案頁的 AI 輸入列）。用事件的話，發話端
 * 不需要知道現在是哪一個擁有者掛著面板，也不必把 state 提到 App 層。
 *
 * 這個接縫**只送文字**，不送指令、不繞過助手自己的意圖判定與確認流程：
 * 發話端打的字與使用者自己在助手裡打的字，走完全同一條路。
 */
export const ASSISTANT_COMPOSE_EVENT = "aios:assistant-compose";

/**
 * 還沒有人接住的那句話。
 *
 * ## 為什麼需要它（沒有它就是一個必現的 bug）
 *
 * 接住文字的是助手本體（`AICreativeCopilot` / `ProjectAssistant`），而它是
 * **lazy chunk**——面板關著的時候根本沒掛載。發話順序因此是：
 *
 *   1. 發話端 dispatch 事件
 *   2. 面板擁有者（MobileNavigation／AssistantLauncher）收到 → setOpen(true)
 *   3. React 這時才開始載入並掛載助手本體
 *   4. 助手本體掛好、`useAssistantComposeListener` 才裝上監聽器
 *
 * 事件在第 1 步就已經發完了，第 4 步的監聽器永遠等不到它。實際症狀是
 * **面板打開但輸入框是空的**，使用者剛打的那句話憑空消失。
 *
 * 所以文字要留一份在模組層，讓晚掛載的接收端能補領。留最後一句就夠了：
 * 使用者連按兩顆快捷時，想送的是第二句。
 */
let pendingCompose: string | null = null;

export function composeToAssistant(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  pendingCompose = trimmed;
  window.dispatchEvent(new CustomEvent(ASSISTANT_COMPOSE_EVENT, { detail: { text: trimmed } }));
}

/**
 * 訂閱「有人要對 Aios 說話」。
 *
 * @param onCompose 收到文字時做什麼（面板擁有者＝打開面板；助手本體＝填進輸入框）
 * @param replayPending 掛載時補領「開面板之前就送出」的那句話。
 *   **只有真正會把文字放進輸入框的接收端該傳 true**：補領會清掉暫存，
 *   面板擁有者若也補領，等於在助手本體掛好之前就把那句話吃掉，bug 原封不動。
 */
export function useAssistantComposeListener(
  onCompose: (text: string) => void,
  replayPending = false,
): void {
  useEffect(() => {
    function handle(event: Event) {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text !== "string" || !text.trim()) return;
      // 已經掛好、直接收到事件的接收端也要清暫存，否則這句話會在下一次
      // 重掛（切視野、換專案）時再被補領一次，變成「輸入框自己冒出舊句子」。
      if (replayPending) pendingCompose = null;
      onCompose(text.trim());
    }
    window.addEventListener(ASSISTANT_COMPOSE_EVENT, handle);
    return () => window.removeEventListener(ASSISTANT_COMPOSE_EVENT, handle);
  }, [onCompose, replayPending]);

  useEffect(() => {
    if (!replayPending || !pendingCompose) return;
    const text = pendingCompose;
    pendingCompose = null;
    onCompose(text);
    // 只在掛載時補領一次；之後靠上面的事件監聽器。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayPending]);
}

/** 測試用：清掉暫存，避免上一個案例的句子漏到下一個 */
export function resetPendingComposeForTest(): void {
  pendingCompose = null;
}
