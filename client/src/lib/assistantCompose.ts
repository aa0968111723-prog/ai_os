import { useEffect } from "react";

/**
 * 「把這句話交給 Aios」的單一接縫。
 *
 * 為什麼是事件而不是 context：助手面板的開關狀態分別握在兩個擁有者手上
 * （桌機 `AssistantLauncher`、手機 `MobileNavigation`），而發話端可能是任何一個
 * 表面（目前是 Visible Creative Workspace 的情境命令列）。用事件的話，發話端
 * 不需要知道現在是哪一個擁有者掛著面板，也不必把 state 提到 App 層。
 *
 * 這個接縫**只送文字**，不送指令、不繞過助手自己的意圖判定與確認流程：
 * 命令列打的字與使用者自己在助手裡打的字，走完全同一條路。
 */
export const ASSISTANT_COMPOSE_EVENT = "aios:assistant-compose";

export function composeToAssistant(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  window.dispatchEvent(new CustomEvent(ASSISTANT_COMPOSE_EVENT, { detail: { text: trimmed } }));
}

/**
 * 訂閱「有人要對 Aios 說話」。
 * 面板擁有者用它打開面板；助手本體用它把文字填進輸入框。
 */
export function useAssistantComposeListener(onCompose: (text: string) => void): void {
  useEffect(() => {
    function handle(event: Event) {
      const text = (event as CustomEvent<{ text?: unknown }>).detail?.text;
      if (typeof text === "string" && text.trim()) onCompose(text.trim());
    }
    window.addEventListener(ASSISTANT_COMPOSE_EVENT, handle);
    return () => window.removeEventListener(ASSISTANT_COMPOSE_EVENT, handle);
  }, [onCompose]);
}
