/**
 * Agent UX 的快速路由器。
 *
 * 這一層刻意不呼叫模型：使用者送出後可以立刻得到可預測的執行卡，真正的
 * 模型／工具工作仍由既有 Assistant Core 與 Runner 負責。這不是 chain-of-thought，
 * 只描述可公開稽核的意圖、能力與執行狀態。
 */
export const ASSISTANT_INTENTS = ["ASK", "ACT", "PLAN", "WATCH"] as const;
export type AssistantIntent = typeof ASSISTANT_INTENTS[number];

export const ASSISTANT_ACTION_RISKS = [
  "READ",
  "SAFE_WRITE",
  "COSTFUL",
  "EXTERNAL",
  "DESTRUCTIVE",
] as const;
export type AssistantActionRisk = typeof ASSISTANT_ACTION_RISKS[number];

export interface AssistantExecutionPlan {
  intent: AssistantIntent;
  confidence: "high" | "medium";
  title: string;
  steps: string[];
}

export interface AssistantRunOpen {
  ok: true;
  runId: string;
  receivedAt: string;
  plan: AssistantExecutionPlan;
}

/** 皆為相對 requestReceived 的毫秒；底層供應商未串 token 時 firstTokenMs 誠實回 null。 */
export interface AssistantLatencyMetrics {
  requestReceivedMs: 0;
  contextReadyMs: number | null;
  modelStartedMs: number | null;
  firstTokenMs: number | null;
  firstToolCallMs: number | null;
  toolFinishedMs: number | null;
  finalAnswerMs: number;
  totalMs: number;
}

export interface AssistantCapability {
  id: string;
  label: string;
  domain: "PROJECT" | "TASK" | "NOTE" | "MEMORY" | "STORYBOARD" | "SCRIPT" | "ASSET" | "DATABASE" | "SCHEDULE" | "MEMBER" | "COLLABORATION" | "GENERATION";
  access: "READ" | "WRITE";
  risk: AssistantActionRisk;
  direct: boolean;
}

/** 與目前已接好的 core／command 能力一一對應；不是產品願望清單。 */
export const ASSISTANT_CAPABILITIES: readonly AssistantCapability[] = [
  { id: "read_context", domain: "PROJECT", access: "READ", label: "讀取目前頁面與專案資料", risk: "READ", direct: true },
  { id: "create_project", domain: "PROJECT", access: "WRITE", label: "建立專案", risk: "SAFE_WRITE", direct: false },
  { id: "read_tasks", domain: "TASK", access: "READ", label: "讀取任務", risk: "READ", direct: true },
  { id: "create_task", domain: "TASK", access: "WRITE", label: "建立未指派專案任務", risk: "SAFE_WRITE", direct: true },
  { id: "read_notes", domain: "NOTE", access: "READ", label: "讀取筆記", risk: "READ", direct: true },
  { id: "add_note", domain: "NOTE", access: "WRITE", label: "建立內部筆記", risk: "SAFE_WRITE", direct: true },
  { id: "save_decision", domain: "MEMORY", access: "WRITE", label: "保存已確認的專案決策", risk: "SAFE_WRITE", direct: true },
  { id: "create_watch", domain: "COLLABORATION", access: "WRITE", label: "建立持久專案監看", risk: "SAFE_WRITE", direct: false },
  { id: "read_storyboard", domain: "STORYBOARD", access: "READ", label: "讀取分鏡", risk: "READ", direct: true },
  { id: "split_script", domain: "STORYBOARD", access: "WRITE", label: "將目前腳本拆成持久化分鏡", risk: "SAFE_WRITE", direct: true },
  { id: "read_script", domain: "SCRIPT", access: "READ", label: "讀取目前腳本", risk: "READ", direct: true },
  { id: "read_assets", domain: "ASSET", access: "READ", label: "讀取素材庫", risk: "READ", direct: true },
  { id: "read_database", domain: "DATABASE", access: "READ", label: "讀取 AI 可見資料庫", risk: "READ", direct: true },
  { id: "add_database_row", domain: "DATABASE", access: "WRITE", label: "寫入資料庫", risk: "SAFE_WRITE", direct: false },
  { id: "read_schedule", domain: "SCHEDULE", access: "READ", label: "讀取排程", risk: "READ", direct: true },
  // 排程可能經既有同步器寫到 Google Calendar，因此按 EXTERNAL 處理，不自動送出。
  { id: "add_schedule_item", domain: "SCHEDULE", access: "WRITE", label: "建立排程", risk: "EXTERNAL", direct: false },
  { id: "read_members", domain: "MEMBER", access: "READ", label: "讀取組員與工作負荷", risk: "READ", direct: true },
  { id: "read_collaboration", domain: "COLLABORATION", access: "READ", label: "讀取阻塞與代理狀態", risk: "READ", direct: true },
  { id: "send_dm", domain: "COLLABORATION", access: "WRITE", label: "傳送私訊", risk: "EXTERNAL", direct: false },
  { id: "dispatch_agent", domain: "COLLABORATION", access: "WRITE", label: "派工給專案代理", risk: "COSTFUL", direct: false },
  { id: "read_generations", domain: "GENERATION", access: "READ", label: "讀取生成紀錄與模型", risk: "READ", direct: true },
  { id: "generate_media", domain: "GENERATION", access: "WRITE", label: "生成圖片或影片", risk: "COSTFUL", direct: false },
] as const;

const QUESTION_RE = /(?:為什麼|怎麼|如何|是否|能不能|可不可以|哪些|什麼|何時|哪裡|分析|評估|比較|解釋|告訴我|\?|？)/i;
const WATCH_RE = /(?:持續|監控|監看|追蹤|盯著|有變化|一有.*就|定期|每天|每週|提醒我)/i;
const PLAN_RE = /(?:規劃|計畫|排步驟|拆解|分解|排程規劃|roadmap|執行方案)/i;
const ACTION_RE = /(?:幫我|替我|直接|立刻|現在|請|新增|建立|創建|記下|紀錄|記錄|加入|安排|排入|指派|更新|修改|套用|執行|產生|生成|拆成|切成)/i;
const COMPOUND_RE = /(?:然後|接著|再把|並(?:且|逐|再|重新)|同時|之後|逐鏡|每一鏡|每個|批次|全部.*(?:生成|建立|修改))/i;
const ACTION_VERB_RE = /(?:建立|新增|修改|更新|拆|生成|產生|指派|綁定|移動|排序|審核|核准|準備)/gi;

function compactTitle(message: string): string {
  const title = message.replace(/\s+/g, " ").trim();
  return title.length > 34 ? `${title.slice(0, 34)}…` : title;
}

export function classifyAssistantRequest(message: string): AssistantExecutionPlan {
  const text = message.trim();
  const title = compactTitle(text) || "處理這項請求";
  const asksQuestion = QUESTION_RE.test(text);
  const asksAction = ACTION_RE.test(text);
  const actionVerbCount = new Set(text.match(ACTION_VERB_RE) ?? []).size;

  if (WATCH_RE.test(text)) {
    return {
      intent: "WATCH",
      confidence: asksAction ? "high" : "medium",
      title,
      steps: ["確認監看範圍", "檢查既有事件與提醒能力", "回報監看狀態"],
    };
  }
  if (PLAN_RE.test(text) && (asksAction || !asksQuestion)) {
    return {
      intent: "PLAN",
      confidence: asksAction ? "high" : "medium",
      title,
      steps: ["讀取目前上下文", "拆解目標與依賴", "提出可核准的執行計畫"],
    };
  }
  if (asksAction && (COMPOUND_RE.test(text) || actionVerbCount >= 2)) {
    return {
      intent: "PLAN",
      confidence: "high",
      title,
      steps: ["讀取目前上下文", "拆解多步驟目標與依賴", "建立可續跑且可核准的執行計畫"],
    };
  }
  // 「如何建立任務」是詢問；「幫我建立任務」才是執行。這道差異直接決定是否允許寫入。
  if (asksAction && !(asksQuestion && /(?:如何|怎麼|能不能|可不可以)/i.test(text))) {
    return {
      intent: "ACT",
      confidence: "high",
      title,
      steps: ["理解明確指令", "檢查權限與風險", "執行可安全落地的動作"],
    };
  }
  return {
    intent: "ASK",
    confidence: text.length >= 4 ? "high" : "medium",
    title,
    steps: ["讀取目前上下文", "查證需要的資料", "整理結論與下一步"],
  };
}

/** 只有明確 ACT 才能自動寫入；短詞、問句、規劃與監看都不會誤觸發。 */
export function canDirectlyExecuteCapability(
  plan: AssistantExecutionPlan,
  capabilityId: string,
): boolean {
  if (plan.intent !== "ACT" || plan.confidence !== "high") return false;
  const capability = ASSISTANT_CAPABILITIES.find((item) => item.id === capabilityId);
  return capability?.risk === "SAFE_WRITE" && capability.direct;
}
