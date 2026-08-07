/**
 * 「以此靈感開新專案」的跨頁交棒（AI 助手 → Launchpad 建立表單）。
 *
 * 為什麼不能只派一顆 CustomEvent：Launchpad 是 lazy route——使用者在別頁的助手
 * sheet 按下按鈕時，Launchpad **還沒掛載**，事件會發進真空，然後永遠消失。
 * 這正是上一版的實況：GlobalAssistantSheet 派了 `aios:new-project-idea`，
 * 全站沒有任何監聽者，使用者按了按鈕、跳到 dashboard、然後什麼都沒發生。
 *
 * 修法照 discuss.ts 的雙軌範本（sessionStorage 先寫、事件後派）：
 *  - Launchpad 已掛載（人就在 dashboard）→ 事件路徑即時生效，handler 先把暫存燒掉。
 *  - Launchpad 未掛載 → 掛載時 takePendingNewProjectIdea() 補收。
 * 寫入順序是關鍵：先暫存後派發，晚一步掛載的元件才撿得到。
 */
const PENDING_KEY = "aios:new-project-idea";

export const NEW_PROJECT_IDEA_EVENT = "aios:new-project-idea";

export function proposeNewProjectIdea(ideaTitle: string): void {
  const title = ideaTitle.trim();
  if (!title) return;
  try {
    sessionStorage.setItem(PENDING_KEY, title);
  } catch {
    /* 隱私模式：僅事件路徑（人在 dashboard 時仍可用） */
  }
  window.dispatchEvent(new CustomEvent<{ ideaTitle: string }>(NEW_PROJECT_IDEA_EVENT, { detail: { ideaTitle: title } }));
}

export function takePendingNewProjectIdea(): string | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (raw) sessionStorage.removeItem(PENDING_KEY);
    return raw?.trim() || null;
  } catch {
    return null;
  }
}
