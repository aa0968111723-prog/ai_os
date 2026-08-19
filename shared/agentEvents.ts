/**
 * 統一 Agent 事件流（Agent Event Stream）。
 *
 * ## 為什麼需要這一層
 *
 * 助手原本只有 `{ phase, text }` 兩個欄位可以描述「我在做什麼」——那不足以回答
 * 使用者真正在問的問題：**「你到底讀到了什麼？」**
 *
 * 「讀取全組現況…」這一行字沒有告訴任何人：讀了哪些專案、找到幾筆、用哪個工具、
 * 花了多久、哪些沒有權限、哪些讀失敗。前端只好自己補一組預測步驟（理解→查證→整理）
 * 並在收到任何事件時把它們打勾——那是**假進度**：畫面上打勾的步驟從來沒有真的發生過。
 *
 * 這個模組把事件變成可驗證的事實。三條不變式：
 *
 * 1. **事件只由真實執行產生。** 每一個 `tool.*`／`source.*`／`action.*` 事件都必須
 *    對應一次真的 tool / core / DB 呼叫。沒有發生的事不准有事件，前端也就畫不出來。
 * 2. **不是 chain-of-thought。** 這裡描述的是系統做過的事（工具名、來源、筆數、耗時、
 *    錯誤），不是模型的私密推理。`agent.thinking` 只准帶「目前在整理哪些已取得的資料」，
 *    而那份清單來自 sources，不是模型自述。
 * 3. **來源不可捏造。** `AgentSourceRecord` 一律由執行端在拿到結果的那一刻登記，
 *    帶著真實 id。LLM 沒有任何路徑可以新增或改寫來源。
 *
 * ## 與舊協定的關係
 *
 * SSE 線上格式是**疊加**而不是取代：事件仍帶 `phase`／`text`（舊前端照舊可讀），
 * 新欄位是選填的擴充。伺服器與前端可以分別部署。
 */

/* ── 事件型別 ── */

export const AGENT_EVENT_TYPES = [
  "agent.started",
  "plan.created",
  "tool.started",
  "tool.progress",
  "tool.completed",
  "tool.failed",
  "source.searching",
  "source.found",
  "source.reading",
  "source.read",
  "source.failed",
  "action.started",
  "action.progress",
  "action.completed",
  "action.failed",
  "verification.started",
  "verification.completed",
  "agent.thinking",
  "agent.completed",
  "agent.failed",
  "waiting.permission",
  "waiting.user_input",
  "interaction.requested",
  "interaction.presented",
  "interaction.submitted",
  "interaction.cancelled",
  "interaction.expired",
  "handoff.opened",
  "handoff.returned",
  "agent.resumed",
] as const;
export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/** 事件的執行狀態；UI 只靠這個決定圖示，不靠字串比對中文文案。 */
export const AGENT_EVENT_STATUSES = ["running", "ok", "empty", "failed", "waiting", "skipped"] as const;
export type AgentEventStatus = (typeof AGENT_EVENT_STATUSES)[number];

/**
 * 來源大類。刻意與站內既有的資料域對齊（專案／資料庫／分鏡／素材…），
 * 不另造一套詞彙——使用者在側欄看到的名字就是這裡的名字。
 */
export const AGENT_SOURCE_TYPES = [
  "project",
  "database",
  "document",
  "script",
  "storyboard",
  "asset",
  "generation",
  "task",
  "schedule",
  "note",
  "decision",
  "knowledge",
  "member",
  "activity",
  "agent_run",
  "collaboration",
  "model_catalog",
  "external",
] as const;
export type AgentSourceType = (typeof AGENT_SOURCE_TYPES)[number];

/** 舊線上協定的三種 phase（保留給尚未升級的前端） */
export type LegacyAgentPhase = "thinking" | "lookup" | "step";

/**
 * 一則 Agent 事件。
 *
 * 除了 `type`／`title` 之外全部選填：一個事件只描述它**真的知道**的事。
 * 不知道筆數就不要填 resultCount——空著代表「沒量到」，填 0 代表「真的是 0 筆」，
 * 這兩件事對使用者的意義完全不同。
 */
export interface AgentEvent {
  /** 本次 run 內唯一（伺服器產生；前端用來 dedupe 與 React key） */
  eventId: string;
  /** 這一次 Agent 執行（跨頁重開時用它把軌跡接回來） */
  runId: string;
  /** 同一件事的 started/completed 共用一個 stepId，UI 據此摺疊成一列 */
  stepId?: string;
  /** 伺服器時間（ISO 8601） */
  timestamp: string;
  type: AgentEventType;
  status: AgentEventStatus;
  /** 給一般使用者看的一行字（中文、不含工具名與 id） */
  title: string;
  /** 展開後的補充說明（仍是人話） */
  description?: string;
  /** 工具真名（只在「詳細資訊」層顯示） */
  toolName?: string;
  sourceType?: AgentSourceType;
  sourceName?: string;
  sourceId?: string;
  /** 動作對象的人話名字（例：「中秋活動影片」的第 3 鏡） */
  target?: string;
  /** 實測毫秒（started 事件不填；completed/failed 才填） */
  durationMs?: number;
  /** 真的查到幾筆。0 是有意義的值，undefined 代表沒量到。 */
  resultCount?: number;
  /** 結果的結構化摘要（例：{ 專案: 1, 分鏡: 12, 素材: 16 }）——UI 直接排版成「1 個專案・12 個分鏡」 */
  resultSummary?: AgentResultSummary;
  /** 失敗原因（人話；不含 stack） */
  error?: string;
  /** 詳細資訊層的補充欄位（不得放敏感資料，會直接送到前端） */
  metadata?: Record<string, string | number | boolean>;
  /** Structured payload carried by waiting.user_input events. */
  question?: import("./agentQuestions").AgentQuestionDefinition & {
    questionId: string;
    resumeToken: string;
  };

  /* ── 舊協定相容欄位（伺服器一律填，前端可忽略） ── */
  phase: LegacyAgentPhase;
  text: string;
}

/** 「1 個專案・12 個分鏡・16 個素材」的結構化來源；label 已是中文，value 是真實計數。 */
export type AgentResultSummary = Array<{ label: string; value: number; unit?: string }>;

/**
 * 這次 run 實際讀過的一筆來源。
 *
 * 只有「執行端拿到結果」才登記——`status` 誠實記錄 empty / denied / failed，
 * 因為「查了但沒有」與「沒權限」與「壞了」對使用者是三件不同的事。
 */
export interface AgentSourceRecord {
  id: string;
  type: AgentSourceType;
  /** 顯示名（專案名、資料庫名、文件標題） */
  name: string;
  /** 站內真實 id（可點進去看）；沒有可指的實體時省略 */
  entityId?: string;
  /** 可導航的站內路徑（由登記端決定；沒有合適落點就省略） */
  href?: string;
  /** 讀到幾筆 */
  itemCount?: number;
  /** 補充計量（12 鏡、3842 字…） */
  detail?: string;
  toolName?: string;
  durationMs?: number;
  status: "ok" | "empty" | "denied" | "failed";
  error?: string;
}

/* ── 摘要（前端與伺服器共用；純函式，可單元測試） ── */

export interface AgentRunSummary {
  /** 真的執行過的工具次數 */
  toolCalls: number;
  /** 真的讀成功的來源數 */
  sourcesRead: number;
  /** 所有來源的筆數總和（沒量到的不計） */
  itemsRead: number;
  /** 真的執行過的寫入動作數 */
  actionsCompleted: number;
  failures: number;
  /** 目前是否卡在等待（權限／使用者選擇） */
  waiting: boolean;
  /** 尚未收到 completed 的最後一則事件標題——「現在在做什麼」 */
  currentTitle?: string;
}

const TOOL_DONE: ReadonlySet<AgentEventType> = new Set(["tool.completed"]);
const SOURCE_DONE: ReadonlySet<AgentEventType> = new Set(["source.read", "source.found"]);
const FAILED: ReadonlySet<AgentEventType> = new Set([
  "tool.failed",
  "source.failed",
  "action.failed",
  "agent.failed",
]);
const WAITING: ReadonlySet<AgentEventType> = new Set(["waiting.permission", "waiting.user_input"]);

/** 事件流 → 可顯示的計量。只數真的發生過的事；沒有事件就是全 0（不補預設步驟）。 */
export function summarizeAgentEvents(events: readonly AgentEvent[]): AgentRunSummary {
  let toolCalls = 0;
  let sourcesRead = 0;
  let itemsRead = 0;
  let actionsCompleted = 0;
  let failures = 0;
  let waiting = false;
  let currentTitle: string | undefined;

  for (const event of events) {
    if (TOOL_DONE.has(event.type)) toolCalls += 1;
    if (SOURCE_DONE.has(event.type) && event.status === "ok") {
      sourcesRead += 1;
      if (typeof event.resultCount === "number") itemsRead += event.resultCount;
    }
    if (event.type === "action.completed") actionsCompleted += 1;
    if (FAILED.has(event.type)) failures += 1;
    if (WAITING.has(event.type)) waiting = true;
    if (event.status === "running" || event.status === "waiting") currentTitle = event.title;
    else if (currentTitle && event.stepId && isTerminalFor(event)) currentTitle = undefined;
  }
  return { toolCalls, sourcesRead, itemsRead, actionsCompleted, failures, waiting, currentTitle };
}

function isTerminalFor(event: AgentEvent): boolean {
  return event.status === "ok" || event.status === "failed" || event.status === "empty" || event.status === "skipped";
}

/**
 * 事件流 → 使用者層的「工作過程」清單（第一層）。
 *
 * 同一個 stepId 的 started/completed 摺疊成一列，最終狀態以最後一則為準。
 * 沒有 stepId 的事件各自成列。**不補任何沒發生過的步驟。**
 */
export interface AgentWorkStep {
  key: string;
  title: string;
  description?: string;
  status: AgentEventStatus;
  durationMs?: number;
  resultCount?: number;
  resultSummary?: AgentResultSummary;
  error?: string;
  /** 這一列底下的原始事件（第二層「詳細資訊」展開用） */
  events: AgentEvent[];
}

export function buildAgentWorkSteps(events: readonly AgentEvent[]): AgentWorkStep[] {
  const steps: AgentWorkStep[] = [];
  const byKey = new Map<string, AgentWorkStep>();
  for (const event of events) {
    const key = event.stepId ?? event.eventId;
    const existing = byKey.get(key);
    if (!existing) {
      const step: AgentWorkStep = {
        key,
        title: event.title,
        description: event.description,
        status: event.status,
        durationMs: event.durationMs,
        resultCount: event.resultCount,
        resultSummary: event.resultSummary,
        error: event.error,
        events: [event],
      };
      byKey.set(key, step);
      steps.push(step);
      continue;
    }
    existing.events.push(event);
    // 後到的事件是同一件事的後續狀態：標題與計量以「有值的最後一則」為準，
    // 這樣 started 的「正在讀取專案」會被 completed 的「已讀取專案」取代。
    existing.title = event.title;
    existing.status = event.status;
    if (event.description !== undefined) existing.description = event.description;
    if (event.durationMs !== undefined) existing.durationMs = event.durationMs;
    if (event.resultCount !== undefined) existing.resultCount = event.resultCount;
    if (event.resultSummary !== undefined) existing.resultSummary = event.resultSummary;
    if (event.error !== undefined) existing.error = event.error;
  }
  return steps;
}

/** 「1 個專案・12 個分鏡・16 個素材」 */
export function formatResultSummary(summary: AgentResultSummary | undefined): string {
  if (!summary?.length) return "";
  return summary
    .filter((entry) => Number.isFinite(entry.value))
    .map((entry) => `${entry.value} ${entry.unit ?? "個"}${entry.label}`)
    .join("・");
}

/**
 * 把使用者問題壓成一句「目前在做什麼」的語意標題（onRound 用）。
 *
 * #669 U7：onRound 原本只列出 stream 已登記的來源名稱，導致「列出專案」與
 * 「比較專案」顯示完全相同的「整理已取得的資料」——使用者無法判斷 AI 現在
 * 具體在處理哪一個請求。這裡把**使用者問的那句話**收進標題，不同查詢的
 * 工作過程就不再長得一模一樣。只取第一個句子、截到 18 字，避免長問題
 * 把整條軌跡撐爆。
 */
/** Mid-run only — never 「已取得來源」 (that reads as a completed-inventory chip). */
export function roundAcquiredSourcesDescription(names: readonly string[]): string | undefined {
  if (!names.length) return undefined;
  const shown = names.slice(0, 5);
  return `讀取中：${shown.join("、")}${names.length > 5 ? ` 等 ${names.length} 項` : ""}`;
}

export function roundThinkingTitle(round: number, message: string): string {
  const label = queryGoalLabel(message);
  return round === 0
    ? `整理「${label}」相關資料`
    : `比對「${label}」相關資料，繼續分析`;
}

/** 使用者問題 → 一句簡短的目標標籤；空白或只有標點時退回通用語。 */
export function queryGoalLabel(message: string): string {
  const text = message.trim().replace(/\s+/g, " ");
  if (!text) return "你的請求";
  const first = text.split(/[。！？!?；;，,\n]/)[0]?.trim() ?? "";
  // 句子分割後可能是空字串（例如整句只有一個「？」）——退回整段原文，不要標成「你的請求」
  const label = first || text;
  return label.length > 18 ? `${label.slice(0, 18)}…` : label;
}

/** 「1.8 秒」／「523 毫秒」——秒以下不要顯示 0.0 秒（看起來像沒發生） */
export function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "";
  return ms < 1000 ? `${Math.round(ms)} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

/** 來源大類 → 中文標籤（提示詞、來源面板與軌跡共用一份） */
export const AGENT_SOURCE_LABEL: Record<AgentSourceType, string> = {
  project: "專案",
  database: "資料庫",
  document: "文件",
  script: "腳本",
  storyboard: "分鏡",
  asset: "素材",
  generation: "生成紀錄",
  task: "任務",
  schedule: "行程",
  note: "筆記",
  decision: "決策",
  knowledge: "知識庫",
  member: "成員",
  activity: "近期活動",
  agent_run: "AI 計畫",
  collaboration: "協作",
  model_catalog: "模型目錄",
  external: "外部來源",
};

/** 型別守衛：SSE 收到的 JSON 是不是一則新版事件（舊事件只有 phase/text，會回 false） */
export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.eventId === "string"
    && typeof candidate.runId === "string"
    && typeof candidate.timestamp === "string"
    && typeof candidate.title === "string"
    && typeof candidate.type === "string"
    && (AGENT_EVENT_TYPES as readonly string[]).includes(candidate.type)
    && typeof candidate.status === "string"
    && (AGENT_EVENT_STATUSES as readonly string[]).includes(candidate.status)
  );
}
