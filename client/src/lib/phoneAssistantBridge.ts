import { useSyncExternalStore } from "react";
import type { AgentEvent } from "@shared/agentEvents";
import type { AssistantActionResult } from "@shared/assistantActions";
import type { AssistantActiveGoal } from "@shared/assistantGoalFrame";
import type { AssistantInteractionRequest } from "@shared/assistantInteractions";

/**
 * 助手 → 手機動作卡的單向投影接縫。
 *
 * ## 為什麼需要一條接縫（而不是「手機自己去讀助手的 state」）
 *
 * 助手本體活在 sheet 裡：關掉面板就整棵卸載（`GlobalAssistantSheet` 是 lazy chunk）。
 * 而手機 Action-first 的重點正是**面板關著的時候**——使用者說完一句話、把面板收起來、
 * 在首頁看那張「做到哪了／要不要確認／完成了幾件」的卡片。那張卡不能靠一個已經
 * 卸載的元件的 React state。
 *
 * 另一個現實是站內有**兩個**助手實作（組級 `AICreativeCopilot` 走
 * `lib/assistantRunStore`；專案級 `ProjectAssistant` 走自己的 turns map），而且
 * 它們在桌機也在用。要讓手機同時看得懂兩邊，若不是加一條共用接縫，就是把兩個
 * 助手改成同一份 state——後者會動到桌面版，違反 `>=768px` 不重構的紅線。
 *
 * ## 這不是第二份真相
 *
 * 這裡存的是**已經渲染過的那一輪的投影**：事件流、待確認提議的標題、已驗證的收據、
 * 作用中目標。全部由助手在它自己完成一輪之後 push 過來，手機端只讀不寫。
 *
 * 具體的不變式：
 *
 * 1. **不落地**：記憶體而已，沒有 localStorage、沒有 IndexedDB。分頁關掉就沒了，
 *    真正的持久狀態在既有的 `globalAssistant.conversationState` 檢查點。
 * 2. **不授權**：這裡的 id 只用來組深連結與組下一句話；任何寫入仍由伺服器
 *    重新過 ACL／CAS／確認政策。偽造這份投影不會多出任何權限。
 * 3. **不判定完成**：`verified` 由發布端從既有收據原樣帶過來，這裡不推導、不升級。
 * 4. **每個 scope 只留最後一輪**：這是「現在怎麼樣」的看板，不是對話歷史。
 */

export type PhoneAssistantScope = "group" | "project";

export interface PhoneAssistantTurn {
  scope: PhoneAssistantScope;
  /** groupId 或 projectId——換組／換專案時舊的那份就不再被讀到 */
  scopeId: string;
  /** 使用者這一輪說了什麼（用來當卡片標題的退路；不做任何加工） */
  goalText?: string;
  answer?: string;
  events?: AgentEvent[];
  /** 待使用者確認的提議標題（不含 payload——手機不重建確認卡） */
  pendingProposals?: { id: string; label: string; capabilityId?: string }[];
  activeGoal?: AssistantActiveGoal;
  pendingInteraction?: AssistantInteractionRequest;
  /** 已通過驗證的收據；未驗證的一律不得出現在這裡 */
  results?: AssistantActionResult[];
  running: boolean;
  updatedAt: number;
}

/** 事件流上限：手機只顯示最後幾列，多留只是佔記憶體 */
const MAX_TURN_EVENTS = 60;

const byScope = new Map<string, PhoneAssistantTurn>();
const listeners = new Set<() => void>();
/** useSyncExternalStore 要求同一份資料回同一個參照，否則會無限重繪 */
let snapshotVersion = 0;

function key(scope: PhoneAssistantScope, scopeId: string): string {
  return `${scope}:${scopeId}`;
}

function notify(): void {
  snapshotVersion += 1;
  for (const listener of listeners) listener();
}

/**
 * 助手完成（或推進）一輪之後呼叫。
 *
 * 只保留最後一輪：後一次 publish 覆寫前一次。呼叫端傳的是自己**已經渲染出來的**
 * 那份狀態，所以不會出現「卡片說完成、面板說待確認」這種分岔。
 */
export function publishPhoneAssistantTurn(turn: PhoneAssistantTurn): void {
  const events = turn.events && turn.events.length > MAX_TURN_EVENTS
    ? turn.events.slice(-MAX_TURN_EVENTS)
    : turn.events;
  byScope.set(key(turn.scope, turn.scopeId), {
    ...turn,
    ...(events ? { events } : {}),
    // 未驗證的收據不得進入投影：手機卡片會把它讀成「已完成」。
    ...(turn.results
      ? { results: turn.results.filter((result) => result.verification.status === "verified") }
      : {}),
  });
  notify();
}

/** 換專案／換組時清掉舊投影（避免上一個專案的結果卡出現在新專案首屏） */
export function clearPhoneAssistantTurn(scope: PhoneAssistantScope, scopeId: string): void {
  if (byScope.delete(key(scope, scopeId))) notify();
}

export function getPhoneAssistantTurn(
  scope: PhoneAssistantScope,
  scopeId: string | undefined,
): PhoneAssistantTurn | undefined {
  if (!scopeId) return undefined;
  return byScope.get(key(scope, scopeId));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/**
 * 訂閱目前 scope 的最後一輪。
 *
 * 專案 scope 優先於組 scope：使用者在專案頁說的話由 `ProjectAssistant` 處理，
 * 那一輪才是他正在等的東西；組級的舊卡片不該蓋在上面。
 */
export function usePhoneAssistantTurn(input: {
  groupId?: string;
  projectId?: string;
}): PhoneAssistantTurn | undefined {
  const version = useSyncExternalStore(subscribe, () => snapshotVersion, () => 0);
  void version; // 訂閱用；實際資料每次重讀 Map（規模是 O(scope 數)，個位數）
  return getPhoneAssistantTurn("project", input.projectId)
    ?? getPhoneAssistantTurn("group", input.groupId);
}

/** 測試用重置（比照 lib/assistantRunStore 的 resetAssistantRunStoreForTest） */
export function resetPhoneAssistantBridgeForTest(): void {
  byScope.clear();
  notify();
}
