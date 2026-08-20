/**
 * Companion 即時事件：線路格式與客戶端 reducer。
 *
 * ## 為什麼不是新開一條連線
 *
 * 站內已經有 `/ws`（見 server/services/realtime.ts）：專案房 `p:<projectId>`、
 * 組房 `g:<groupId>`，附帶認證、心跳、連線上限、跨實例 bus。Companion 需要的
 * 是**同一條線上多一種訊息**，不是第二套 realtime——後者要重做認證與重連，
 * 而且兩條線在弱網下會各自斷各自重連，使用者看到的是兩份互相矛盾的狀態。
 *
 * 所以這裡定義的是一則新的 message type（`companion-event`），發到既有房間。
 * 舊客戶端收到不認得的 type 會忽略（既有 onmessage 是 switch，default 不做事），
 * 因此對桌面版是零影響。
 *
 * ## 為什麼要 reducer 而不是「收到就 refetch」
 *
 * 生成完成一次來十筆，每筆都 refetch 等於十次往返；而 Companion 首頁那幾個
 * 數字（跑幾個、等幾個、壞幾個）本來就是計數，能直接從事件推。
 * 所以：**數字用事件推（畫面立刻動），真相仍以查詢為準**（下一次 refetch 覆蓋）。
 * 這一層永遠不是權威——它只負責讓球在 200ms 內轉起來。
 */
import type { CompanionEventKind } from "./companionNotifications";

export const COMPANION_WS_MESSAGE_TYPE = "companion-event";

export interface CompanionWireEvent {
  type: typeof COMPANION_WS_MESSAGE_TYPE;
  kind: CompanionEventKind;
  /** 事件發生在哪個專案；站級事件（額度用盡）可以沒有 */
  projectId?: string | null;
  groupId?: string | null;
  /** 生成 id／分鏡 id 等，用來組深連結；不參與授權 */
  entityId?: string | null;
  /** 給使用者看的短標籤（「A07」） */
  entityLabel?: string | null;
  /** 批次事件的筆數 */
  count?: number;
  /** 0–1 */
  progress?: number;
  occurredAt: string;
}

/** 執行期驗形（WS 訊息不可信；欄位缺了就當成不是這種事件）。 */
export function parseCompanionWireEvent(raw: unknown): CompanionWireEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type !== COMPANION_WS_MESSAGE_TYPE) return null;
  if (typeof msg.kind !== "string") return null;
  const occurredAt = typeof msg.occurredAt === "string" ? msg.occurredAt : "";
  if (!occurredAt) return null;
  return {
    type: COMPANION_WS_MESSAGE_TYPE,
    kind: msg.kind as CompanionEventKind,
    projectId: typeof msg.projectId === "string" ? msg.projectId : null,
    groupId: typeof msg.groupId === "string" ? msg.groupId : null,
    entityId: typeof msg.entityId === "string" ? msg.entityId : null,
    entityLabel: typeof msg.entityLabel === "string" ? msg.entityLabel.slice(0, 40) : null,
    ...(typeof msg.count === "number" && Number.isFinite(msg.count)
      ? { count: Math.max(0, Math.trunc(msg.count)) }
      : {}),
    ...(typeof msg.progress === "number" && Number.isFinite(msg.progress)
      ? { progress: Math.min(1, Math.max(0, msg.progress)) }
      : {}),
    occurredAt,
  };
}

export interface CompanionLiveState {
  running: number;
  awaiting: number;
  failed: number;
  completed: number;
  /** 最近一則事件（給 Orb 與提醒條用） */
  last?: CompanionWireEvent;
  /** 最近一次進度（0–1）；沒有進行中的任務時 undefined */
  progress?: number;
}

export const EMPTY_COMPANION_LIVE_STATE: CompanionLiveState = {
  running: 0,
  awaiting: 0,
  failed: 0,
  completed: 0,
};

/**
 * 事件 → 樂觀計數。
 *
 * 計數一律夾在 0 以上：漏收一則 `generation_started`（斷線期間）之後再收到
 * `generation_completed`，running 會被減成 -1，而畫面上會顯示「-1 個生成中」。
 * 那種數字比沒有數字更傷信任。
 */
export function reduceCompanionEvent(
  state: CompanionLiveState,
  event: CompanionWireEvent,
): CompanionLiveState {
  const n = Math.max(1, event.count ?? 1);
  const next: CompanionLiveState = { ...state, last: event };
  switch (event.kind) {
    case "generation_started":
      next.running = state.running + n;
      break;
    case "generation_progress":
      next.progress = event.progress;
      break;
    case "generation_completed":
      next.running = Math.max(0, state.running - n);
      next.completed = state.completed + n;
      if (next.running === 0) delete next.progress;
      break;
    case "generation_failed":
      next.running = Math.max(0, state.running - n);
      next.failed = state.failed + n;
      if (next.running === 0) delete next.progress;
      break;
    case "approval_required":
      next.awaiting = state.awaiting + n;
      break;
    case "batch_completed":
      next.running = 0;
      delete next.progress;
      break;
    default:
      break;
  }
  return next;
}

/**
 * 哪些事件值得打斷正在顯示的查詢快取。
 *
 * 進度事件**不**觸發 refetch：它每幾秒來一次，一次 refetch 等於把輪詢換個名字
 * 重新發明一遍（任務書 §15 明列「不要每 1 秒暴力 polling」）。
 * 只有離散的狀態轉換才值得回伺服器對一次答案。
 */
const REFETCH_KINDS = new Set<CompanionEventKind>([
  "generation_completed",
  "generation_failed",
  "approval_required",
  "batch_completed",
  "agent_action_completed",
  "quota_exhausted",
]);

export function companionEventNeedsRefetch(kind: CompanionEventKind): boolean {
  return REFETCH_KINDS.has(kind);
}

/** 事件 → Orb 訊號片段（呼叫端再與語音／助手狀態合併）。 */
export function companionEventOrbSignals(state: CompanionLiveState): {
  executing: boolean;
  progress?: number;
  awaitingConfirmation: boolean;
  failed: boolean;
} {
  return {
    executing: state.running > 0,
    ...(typeof state.progress === "number" ? { progress: state.progress } : {}),
    awaitingConfirmation: state.awaiting > 0,
    failed: state.failed > 0,
  };
}
