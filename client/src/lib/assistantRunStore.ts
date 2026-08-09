import type { AgentEvent, AgentSourceRecord } from "@shared/agentEvents";
import {
  boundAssistantActionResults,
  type AssistantActionResult,
  type AssistantReturnContext,
} from "@shared/assistantActions";

/**
 * 全站助手對話與執行軌跡的模組級存放區。
 *
 * ## 為什麼不能只放在元件 state
 *
 * 助手活在 MenuSurface 裡：關掉面板、切換視野、換頁都會把元件整棵卸載。
 * 對話與「剛剛那次執行做了什麼」是 React state 的話，這些動作等於把使用者的
 * 工作紀錄丟掉——而使用者在手機上關掉面板去看一眼專案再回來，是最自然不過的操作。
 *
 * 所以狀態掛在模組層（與 lib/orbState 同一個理由與同一種做法）：元件只是它的檢視。
 * 這裡刻意**不**進 localStorage——軌跡可能含只有本人有權看到的資料庫內容，
 * 留在記憶體隨分頁生命週期結束是正確的保存期限；要看更久以前的，站內已有
 * `globalAssistant.traces` 落庫軌跡可查。
 *
 * ## 為什麼不是 React Context
 *
 * Context 的 Provider 一樣會被卸載鏈影響，而且會把整棵訂閱樹綁在助手的生命週期上。
 * 這裡只需要「一份資料 ＋ 訂閱」，`useSyncExternalStore` 直接就位。
 */

export interface AssistantRunSnapshot {
  runId: string;
  events: AgentEvent[];
  sources: AgentSourceRecord[];
  /** 執行中（串流未收尾）；換頁回來時據此決定要不要繼續顯示「執行中」 */
  active: boolean;
  startedAt: number;
}

export interface AssistantConversationState<TMessage> {
  messages: TMessage[];
  /** 目前這一次執行；沒有在跑就是 null */
  run: AssistantRunSnapshot | null;
  /** Conversation is Home: every worker action knows where to return. */
  returnContext?: AssistantReturnContext;
  /** Bounded typed references for "這些資料／剛建立的專案". */
  recentActionResults?: AssistantActionResult[];
}

type Listener = () => void;

/** 每個組一份：切組時不該看到別組的對話 */
const byGroup = new Map<string, AssistantConversationState<unknown>>();
const listeners = new Set<Listener>();
/**
 * 在途請求的中止把手，同樣掛在模組層。
 *
 * 放在元件 ref 裡會有一個很難察覺的洞：使用者送出後關掉面板再打開，元件是新的一份，
 * ref 是空的——「停止」鍵按下去什麼也不會發生，而執行還在跑。把手跟著執行走，不跟著檢視走。
 */
const controllers = new Map<string, AbortController>();

const EMPTY: AssistantConversationState<unknown> = Object.freeze({ messages: [], run: null });

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeAssistantRun(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getAssistantConversation<TMessage>(groupId: string | undefined): AssistantConversationState<TMessage> {
  if (!groupId) return EMPTY as AssistantConversationState<TMessage>;
  return (byGroup.get(groupId) ?? EMPTY) as AssistantConversationState<TMessage>;
}

/**
 * 覆寫某一組的對話狀態。
 *
 * 傳入 updater 而不是整包物件：兩個掛載中的檢視（例如手機球與桌機頂欄）同時寫入時，
 * 後者才不會用一份過期的快照覆蓋前者剛加進去的訊息。
 */
export function setAssistantConversation<TMessage>(
  groupId: string,
  update: (previous: AssistantConversationState<TMessage>) => AssistantConversationState<TMessage>,
): void {
  const previous = getAssistantConversation<TMessage>(groupId);
  const next = update(previous);
  if (next === previous) return;
  byGroup.set(groupId, next as AssistantConversationState<unknown>);
  notify();
}

export function clearAssistantConversation(groupId: string): void {
  if (!byGroup.has(groupId)) return;
  byGroup.delete(groupId);
  notify();
}

/**
 * 測試用重置（與 lib/assistantContext 的 resetAssistantContextForTest 同一慣例）。
 *
 * 模組級狀態在單元測試裡會跨案例存活——一個測試留下的對話會讓下一個測試看到
 * 「已經有訊息」的助手，零狀態畫面因此消失。這在正式環境是**正確行為**
 * （那正是跨頁不消失的來源），所以解法是給測試一個明確的重置點，而不是弱化狀態。
 */
export function resetAssistantRunStoreForTest(): void {
  byGroup.clear();
  controllers.clear();
  notify();
}

/** 登記這一次執行的中止把手（送出時呼叫；收尾時由 endAssistantRun 清掉） */
export function registerAssistantRunController(groupId: string, controller: AbortController): void {
  controllers.set(groupId, controller);
}

/** 中止進行中的執行。回傳是否真的有東西被中止（沒有在跑時不該假裝停了什麼）。 */
export function abortAssistantRun(groupId: string): boolean {
  const controller = controllers.get(groupId);
  if (!controller) return false;
  controllers.delete(groupId);
  controller.abort();
  return true;
}

/** 執行中的 run 收尾（串流結束／失敗／中止都要呼叫，否則畫面會永遠停在「執行中」） */
export function endAssistantRun(groupId: string): void {
  controllers.delete(groupId);
  setAssistantConversation(groupId, (previous) =>
    previous.run?.active ? { ...previous, run: { ...previous.run, active: false } } : previous,
  );
}

function newConversationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `conversation-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function captureAssistantReturnContext(input: {
  groupId: string;
  projectId?: string;
  runId?: string;
  originRoute: string;
  originScrollY?: number;
  focusAnchor?: string;
}): AssistantReturnContext {
  let captured!: AssistantReturnContext;
  setAssistantConversation(input.groupId, (previous) => {
    captured = {
      assistantSurface: "global",
      conversationId: previous.returnContext?.conversationId ?? newConversationId(),
      runId: input.runId ?? previous.returnContext?.runId,
      originRoute: input.originRoute,
      originScrollY: input.originScrollY,
      focusAnchor: input.focusAnchor,
      projectId: input.projectId,
      groupId: input.groupId,
    };
    return { ...previous, returnContext: captured };
  });
  return captured;
}

export function recordAssistantActionResults(groupId: string, results: readonly AssistantActionResult[]): void {
  if (!results.length) return;
  setAssistantConversation(groupId, (previous) => ({
    ...previous,
    recentActionResults: boundAssistantActionResults([
      ...(previous.recentActionResults ?? []),
      ...results,
    ]),
  }));
}

/** Unified return hook for pages/mini-workspaces; it restores state, never
 * invents browser history. The shell may navigate only after an explicit click. */
export function returnToAssistantConversation(groupId: string, runId?: string): AssistantReturnContext | null {
  const state = getAssistantConversation(groupId);
  const context = state.returnContext;
  if (!context) return null;
  if (runId && context.runId && context.runId !== runId) return null;
  return context;
}
