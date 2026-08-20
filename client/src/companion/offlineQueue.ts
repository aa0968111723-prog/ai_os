/**
 * 離線指令佇列。
 *
 * ## 唯一的規則：不要假裝已經做完了
 *
 * 離線時最糟的設計是把指令收下、給一個打勾、然後永遠不送出。使用者以為
 * 交代完了，隔天回來發現什麼都沒發生——而且他不會記得是哪一句沒送成功。
 *
 * 所以這裡的合約很窄：
 * 1. 收下的東西叫「待送出」，不叫「已完成」。UI 必須照這個字面顯示。
 * 2. 只排隊**使用者說的那句話**，不排隊已解析的動作。連線後仍走完整的
 *    意圖判定／確認流程——離線時決定的「安全」在半小時後可能已經不安全了
 *    （那個素材可能已經被別人刪了）。
 * 3. 佇列有上限，且**先進先出**。手機離線半天不該累積四十句話，
 *    然後在連上網的那一刻一次全部送出去燒點數。
 *
 * ## 為什麼放 localStorage 而不是 IndexedDB
 *
 * 存的是幾句話，總量以 KB 計。IndexedDB 要處理版本、交易與非同步開啟，
 * 換來的是這個場景用不到的容量。localStorage 寫不進去（無痕模式）時
 * 退化成「這次不排隊」——UI 會照實說離線送不出去。
 */

export const COMPANION_QUEUE_KEY = "aios.companion.outbox";
/** 佇列上限；超過就丟掉最舊的。 */
export const MAX_QUEUED_COMMANDS = 10;
/** 超過這個時間還沒送出的就不要送了——半天前的「重跑失敗的那些」很可能已經沒有意義。 */
export const QUEUE_TTL_MS = 6 * 60 * 60 * 1000;

export interface QueuedCommand {
  id: string;
  text: string;
  /** 當時的專案（連線後組上下文用） */
  projectId?: string;
  queuedAt: number;
}

function read(): QueuedCommand[] {
  try {
    const raw = localStorage.getItem(COMPANION_QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedCommand);
  } catch {
    return [];
  }
}

function isQueuedCommand(value: unknown): value is QueuedCommand {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string"
    && typeof item.text === "string"
    && typeof item.queuedAt === "number";
}

function write(items: QueuedCommand[]): void {
  try {
    localStorage.setItem(COMPANION_QUEUE_KEY, JSON.stringify(items));
  } catch {
    /* 寫不進去就只是這次不排隊；呼叫端會照實顯示 */
  }
  notify();
}

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function subscribeQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 目前待送出的指令（已濾掉過期的）。 */
export function listQueuedCommands(now = Date.now()): QueuedCommand[] {
  const fresh = read().filter((item) => now - item.queuedAt < QUEUE_TTL_MS);
  return fresh.slice(-MAX_QUEUED_COMMANDS);
}

/**
 * 收下一句話。回傳排隊後的清單，讓呼叫端直接顯示「還有幾句等著送」。
 *
 * `id` 由呼叫端給（測試要可重現，而 crypto.randomUUID 在舊 WebView 上也不保證有）。
 */
export function enqueueCommand(command: Omit<QueuedCommand, "queuedAt"> & { queuedAt?: number }): QueuedCommand[] {
  const text = command.text.trim();
  if (!text) return listQueuedCommands();
  const now = command.queuedAt ?? Date.now();
  const items = [...listQueuedCommands(now), { ...command, text, queuedAt: now }];
  // 超過上限丟最舊的：新的那句是使用者剛剛說的，一定比半天前那句重要。
  const trimmed = items.slice(-MAX_QUEUED_COMMANDS);
  write(trimmed);
  return trimmed;
}

/** 送出成功後把那一句拿掉。 */
export function dequeueCommand(id: string): QueuedCommand[] {
  const remaining = listQueuedCommands().filter((item) => item.id !== id);
  write(remaining);
  return remaining;
}

export function clearQueue(): void {
  write([]);
}

/**
 * 「我先記住這句，連上網再送」的那句話。
 *
 * 文案是產品合約的一部分：它必須說**還沒送出**。
 */
export function offlineAcknowledgement(pending: number): string {
  if (pending <= 1) return "目前離線，我先記住這句，連線後再送出。";
  return `目前離線，我先記住這句（還有 ${pending - 1} 句等著送），連線後一起送出。`;
}
