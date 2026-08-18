/**
 * Agent UX 的快速路由器。
 *
 * 這一層刻意不呼叫模型：使用者送出後可以立刻得到可預測的執行卡，真正的
 * 模型／工具工作仍由既有 Assistant Core 與 Runner 負責。這不是 chain-of-thought，
 * 只描述可公開稽核的意圖、能力與執行狀態。
 */
export const ASSISTANT_INTENTS = ["ASK", "DIRECT", "AGENT", "PLAN", "WATCH"] as const;
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
  /** Capability-first routing result.  It is a stable registry id, never a UI component. */
  capabilityId?: string;
  executionMode?: AssistantCapability["executionMode"];
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
  domain: "PROJECT" | "TASK" | "NOTE" | "MEMORY" | "STORYBOARD" | "SCRIPT" | "ASSET" | "INTAKE" | "DATABASE" | "SCHEDULE" | "MEMBER" | "COLLABORATION" | "COMPUTER" | "GENERATION";
  access: "READ" | "WRITE";
  risk: AssistantActionRisk;
  direct: boolean;
  requiredContextSlots: readonly ("projectId" | "sceneId" | "shotId" | "personId" | "assetIds" | "modelId" | "executionMode")[];
  executionMode: "DIRECT_TOOL" | "PROJECT_AGENT" | "GROUP_CAMPAIGN" | "BROWSER_FALLBACK";
  /** Stable backend command/service identifier; never a React component. */
  handler: string;
  resultType: "none" | "import" | "create_project" | "create_task" | "generation" | "schedule" | "generic";
  verificationStrategy: "none" | "read_back" | "job_registered" | "external_confirmation";
}

/** 與目前已接好的 core／command 能力一一對應；不是產品願望清單。 */
const capability = (
  value: Omit<AssistantCapability, "requiredContextSlots" | "executionMode" | "handler" | "resultType" | "verificationStrategy"> &
    Partial<Pick<AssistantCapability, "requiredContextSlots" | "executionMode" | "handler" | "resultType" | "verificationStrategy">>,
): AssistantCapability => ({
  requiredContextSlots: [],
  executionMode: value.direct ? "DIRECT_TOOL" : "PROJECT_AGENT",
  handler: `assistant.${value.id}`,
  resultType: "generic",
  verificationStrategy: value.access === "WRITE" ? "read_back" : "none",
  ...value,
});

const ASSISTANT_CAPABILITY_DEFINITIONS = [
  { id: "read_context", domain: "PROJECT", access: "READ", label: "讀取目前頁面與專案資料", risk: "READ", direct: true },
  capability({ id: "create_project", domain: "PROJECT", access: "WRITE", label: "建立專案", risk: "SAFE_WRITE", direct: true, resultType: "create_project", verificationStrategy: "read_back" }),
  { id: "read_tasks", domain: "TASK", access: "READ", label: "讀取任務", risk: "READ", direct: true },
  capability({ id: "create_task", domain: "TASK", access: "WRITE", label: "建立未指派專案任務", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], resultType: "create_task", verificationStrategy: "read_back" }),
  { id: "read_notes", domain: "NOTE", access: "READ", label: "讀取筆記", risk: "READ", direct: true },
  { id: "add_note", domain: "NOTE", access: "WRITE", label: "建立內部筆記", risk: "SAFE_WRITE", direct: true },
  { id: "save_decision", domain: "MEMORY", access: "WRITE", label: "保存已確認的專案決策", risk: "SAFE_WRITE", direct: true },
  { id: "create_watch", domain: "COLLABORATION", access: "WRITE", label: "建立持久專案監看", risk: "SAFE_WRITE", direct: false },
  { id: "read_storyboard", domain: "STORYBOARD", access: "READ", label: "讀取分鏡", risk: "READ", direct: true },
  { id: "split_script", domain: "STORYBOARD", access: "WRITE", label: "將目前腳本拆成持久化分鏡", risk: "SAFE_WRITE", direct: true },
  { id: "read_script", domain: "SCRIPT", access: "READ", label: "讀取目前腳本", risk: "READ", direct: true },
  { id: "read_assets", domain: "ASSET", access: "READ", label: "讀取素材庫", risk: "READ", direct: true },
  capability({ id: "import_local_file", domain: "INTAKE", access: "WRITE", label: "加入檔案", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], handler: "universalIntake.ingestTmpAsset", resultType: "import", verificationStrategy: "job_registered" }),
  capability({ id: "import_url", domain: "INTAKE", access: "WRITE", label: "加入網址", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], handler: "universalIntake.importUrlIntoProject", resultType: "import", verificationStrategy: "job_registered" }),
  capability({ id: "import_google_drive", domain: "INTAKE", access: "WRITE", label: "加入 Google Drive", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], handler: "universalIntake.importDriveFileIntoProject", resultType: "import", verificationStrategy: "job_registered" }),
  capability({ id: "import_folder", domain: "INTAKE", access: "WRITE", label: "加入資料夾", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], handler: "folderImport.createFolderImportSession", resultType: "import", verificationStrategy: "job_registered" }),
  capability({ id: "import_external_result", domain: "INTAKE", access: "WRITE", label: "帶回外部 AI 成果", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], handler: "universalIntake.ingestTmpAsset", resultType: "import", verificationStrategy: "job_registered" }),
  capability({ id: "attach_asset_to_project", domain: "ASSET", access: "WRITE", label: "把素材加入專案脈絡", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId", "assetIds"], handler: "contextBindings.createBinding", verificationStrategy: "read_back" }),
  capability({ id: "attach_asset_to_scene", domain: "ASSET", access: "WRITE", label: "把素材加入場景", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId", "sceneId", "assetIds"], handler: "contextBindings.createBinding", verificationStrategy: "read_back" }),
  capability({ id: "attach_asset_to_shot", domain: "ASSET", access: "WRITE", label: "把素材加入分鏡", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId", "shotId", "assetIds"], handler: "contextBindings.createBinding", verificationStrategy: "read_back" }),
  capability({ id: "classify_asset", domain: "ASSET", access: "WRITE", label: "整理素材", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["assetIds"], handler: "intelligence.reprocess", verificationStrategy: "job_registered" }),
  capability({ id: "add_project_context", domain: "PROJECT", access: "WRITE", label: "加入專案資料脈絡", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId", "assetIds"], handler: "contextBindings.createBinding", verificationStrategy: "read_back" }),
  { id: "read_database", domain: "DATABASE", access: "READ", label: "讀取 AI 可見資料庫", risk: "READ", direct: true },
  { id: "add_database_row", domain: "DATABASE", access: "WRITE", label: "寫入資料庫", risk: "SAFE_WRITE", direct: false },
  { id: "read_schedule", domain: "SCHEDULE", access: "READ", label: "讀取排程", risk: "READ", direct: true },
  // 排程可能經既有同步器寫到 Google Calendar，因此按 EXTERNAL 處理，不自動送出。
  { id: "add_schedule_item", domain: "SCHEDULE", access: "WRITE", label: "建立排程", risk: "EXTERNAL", direct: false },
  { id: "read_members", domain: "MEMBER", access: "READ", label: "讀取組員與工作負荷", risk: "READ", direct: true },
  { id: "read_collaboration", domain: "COLLABORATION", access: "READ", label: "讀取阻塞與代理狀態", risk: "READ", direct: true },
  capability({ id: "inspect_computer_runtime", domain: "COMPUTER", access: "READ", label: "確認 Browser / Desktop Runtime 能力", risk: "READ", direct: true, executionMode: "DIRECT_TOOL", handler: "computerRuntime.status", resultType: "generic", verificationStrategy: "read_back" }),
  capability({ id: "open_browser_runtime", domain: "COMPUTER", access: "WRITE", label: "開啟隔離瀏覽器", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], executionMode: "BROWSER_FALLBACK", handler: "computerRuntime.createSession", resultType: "generic", verificationStrategy: "read_back" }),
  { id: "send_dm", domain: "COLLABORATION", access: "WRITE", label: "傳送私訊", risk: "EXTERNAL", direct: false },
  { id: "dispatch_agent", domain: "COLLABORATION", access: "WRITE", label: "派工給專案代理", risk: "COSTFUL", direct: false },
  capability({ id: "orchestrate_group_campaign", domain: "COLLABORATION", access: "WRITE", label: "規劃跨專案活動", risk: "COSTFUL", direct: false, executionMode: "GROUP_CAMPAIGN", handler: "groupAgent.planCampaign", resultType: "generic", verificationStrategy: "read_back" }),
  { id: "read_generations", domain: "GENERATION", access: "READ", label: "讀取生成紀錄與模型", risk: "READ", direct: true },
  { id: "animation_review_summary", domain: "GENERATION", access: "READ", label: "讀取動畫製作檢查摘要", risk: "READ", direct: true },
  { id: "animation_list_findings", domain: "GENERATION", access: "READ", label: "列出動畫製作問題", risk: "READ", direct: true },
  { id: "animation_plan_repair", domain: "GENERATION", access: "READ", label: "規劃動畫 targeted repair", risk: "READ", direct: true },
  capability({ id: "animation_execute_repair", domain: "GENERATION", access: "WRITE", label: "執行動畫修復階段", risk: "COSTFUL", direct: false, handler: "creativeContext.executeAnimationStage", verificationStrategy: "job_registered" }),
  { id: "animation_compare_candidate", domain: "GENERATION", access: "READ", label: "比較動畫修復候選", risk: "READ", direct: true },
  capability({ id: "animation_adopt_candidate", domain: "GENERATION", access: "WRITE", label: "採用動畫修復候選", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], handler: "consistencyAdopt.adoptGenerationCurrent", verificationStrategy: "read_back" }),
  capability({ id: "animation_keep_current", domain: "GENERATION", access: "WRITE", label: "保留動畫現用版本", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], handler: "scenes.review", verificationStrategy: "read_back" }),
  { id: "generate_media", domain: "GENERATION", access: "WRITE", label: "生成圖片或影片", risk: "COSTFUL", direct: false },
  capability({ id: "prepare_external_generation", domain: "GENERATION", access: "WRITE", label: "開啟外部 AI 生成", risk: "EXTERNAL", direct: false, requiredContextSlots: ["projectId", "shotId"], executionMode: "DIRECT_TOOL", handler: "externalIntake.prepareExternalGeneration", resultType: "generation", verificationStrategy: "external_confirmation" }),
  capability({ id: "prepare_editing_handoff", domain: "ASSET", access: "WRITE", label: "準備外部剪輯交接", risk: "EXTERNAL", direct: false, requiredContextSlots: ["projectId"], executionMode: "DIRECT_TOOL", handler: "externalEditing.prepare", resultType: "generic", verificationStrategy: "read_back" }),
  capability({ id: "open_editing_session", domain: "ASSET", access: "READ", label: "開啟剪輯工作階段", risk: "READ", direct: true, requiredContextSlots: ["projectId"], executionMode: "DIRECT_TOOL", handler: "externalEditing.list", resultType: "generic", verificationStrategy: "read_back" }),
  capability({ id: "return_editing_result", domain: "INTAKE", access: "WRITE", label: "回傳外部剪輯成果", risk: "SAFE_WRITE", direct: true, requiredContextSlots: ["projectId"], executionMode: "DIRECT_TOOL", handler: "universalIntake.ingestTmpAsset", resultType: "import", verificationStrategy: "job_registered" }),
  capability({ id: "review_editing_result", domain: "ASSET", access: "READ", label: "AI 審查外部剪輯成果", risk: "READ", direct: true, requiredContextSlots: ["projectId", "assetIds"], executionMode: "DIRECT_TOOL", handler: "globalAssistant.siteAsk", resultType: "generic", verificationStrategy: "none" }),
] as const;

export const ASSISTANT_CAPABILITIES: readonly AssistantCapability[] =
  ASSISTANT_CAPABILITY_DEFINITIONS.map((item) => capability(item));

/**
 * 疑問句：這些詞本身就代表「在問」，即使句子裡有寫入動詞也是問句
 * （「如何建立任務？」是問，不是要你去建）。命中即走 ASK。
 */
const QUESTION_RE = /(?:為什麼|怎麼|如何|是否|能不能|可不可以|能否|哪些|哪一個|哪個|什麼|何時|哪裡|分析|評估|比較|解釋|告訴我|嗎|\?|？)/i;

/**
 * 唯讀查詢動詞（#663）。與 QUESTION_RE 分開的理由：
 * 「列出／顯示／查看」是動詞不是疑問詞，單獨出現時是查詢（「幫我列出專案」→ ASK，
 * 不該燒規劃點數也不該開寫入），但它們**經常出現在複合寫入的後半段**
 * （「幫我建立專案，然後顯示結果」「產生第 3 鏡並列出候選」）。
 * 若比照疑問詞無條件短路成 ASK，這些請求會變成只回答、不執行——那是靜默失效。
 * 因此唯讀查詢只有在「句中沒有任何寫入動詞」時才算問句。
 */
const READ_QUERY_RE = /(?:列出|清單|有幾個|有多少|總共|有誰|誰是|顯示|查看)/i;
const WATCH_RE = /(?:持續|監控|監看|追蹤|盯著|有變化|一有.*就|定期|每天|每週|提醒我)/i;
const PLAN_RE = /(?:規劃|計畫|排步驟|拆解|分解|排程規劃|roadmap|執行方案)/i;
const ACTION_RE = /(?:幫我|替我|直接|立刻|現在|請|新增|建立|創建|記下|紀錄|記錄|加入|安排|排入|指派|更新|修改|套用|執行|產生|生成|拆成|切成)/i;
const COMPOUND_RE = /(?:然後|接著|再把|並(?:且|逐|再|重新)|同時|之後|逐鏡|每一鏡|每個|批次|全部.*(?:生成|建立|修改))/i;
const ACTION_VERB_RE = /(?:建立|新增|修改|更新|拆|生成|產生|指派|綁定|移動|排序|審核|核准|準備)/gi;
const CROSS_PROJECT_PLAN_RE = /(?:跨專案|多個專案|所有專案|整個團隊|活動專案.*(?:分工|交付|監控)|(?:開|建立).{0,20}專案.{0,30}(?:分工|派工|交付|持續監控)|(?:分工|派工).{0,30}(?:交付|監控))/i;
const PROJECT_AGENT_RE = /(?:完整分鏡|腳本.{0,20}(?:整理|拆).{0,20}分鏡|逐鏡|每一鏡|人物與場景|整支影片|這支影片.{0,20}(?:完成|製作)|多步(?:驟)?)/i;

const CAPABILITY_GOAL_PATTERNS: ReadonlyArray<{ id: string; pattern: RegExp }> = [
  { id: "animation_execute_repair", pattern: /(?:確認執行|照這個計畫執行|開始修復).{0,8}(?:修復|計畫)?/i },
  { id: "animation_adopt_candidate", pattern: /(?:採用這版|用修好的|採用這一鏡)/i },
  { id: "animation_keep_current", pattern: /(?:保留現用|原本比較好)/i },
  { id: "animation_compare_candidate", pattern: /(?:開始檢查|比較候選|看看候選)/i },
  { id: "animation_plan_repair", pattern: /(?:幫我修|只修|先修|規劃修復).{0,16}(?:人物|連戲|畫風|動作|鏡頭|問題)?/i },
  { id: "animation_list_findings", pattern: /(?:哪些鏡頭|哪幾鏡).{0,12}(?:不一致|有問題)|人物不一致/i },
  { id: "animation_review_summary", pattern: /(?:這一幕|這幕|這一場).{0,8}(?:有什麼問題|哪裡有問題|還有什麼問題)|動畫檢查/i },
  { id: "open_browser_runtime", pattern: /(?:開啟|打開|啟動).{0,10}(?:瀏覽器|browser)|(?:瀏覽器|browser).{0,10}(?:開啟|打開|啟動)/i },
  { id: "import_url", pattern: /(?:https?:\/\/[^\s]+).*(?:加入|匯入|帶進|帶入|放進|存到|素材庫)|(?:加入|匯入|帶進|帶入|放進|存到).*(?:https?:\/\/[^\s]+)/i },
  { id: "import_google_drive", pattern: /(?:google\s*drive|雲端硬碟|雲端磁碟).*(?:匯入|帶進|帶入|加入|放進)|(?:匯入|帶進|帶入|加入|放進).*(?:google\s*drive|雲端硬碟|雲端磁碟)/i },
  { id: "import_folder", pattern: /(?:資料夾|文件夾|\bfolder\b).*(?:匯入|帶進|帶入|加入|放進)|(?:匯入|帶進|帶入|加入|放進).*(?:資料夾|文件夾|\bfolder\b)/i },
  { id: "import_local_file", pattern: /(?:檔案|文件|照片|圖片|影片|\bpdf\b|\bfile\b).*(?:匯入|帶進|帶入|加入|放進|上傳)|(?:匯入|帶進|帶入|加入|放進|上傳).*(?:檔案|文件|照片|圖片|影片|\bpdf\b|\bfile\b)/i },
  { id: "import_external_result", pattern: /(?:外部\s*AI|Flow|Runway|Kling).*(?:成果|結果).*(?:帶回|匯入|加入)|(?:帶回|匯入).*(?:外部\s*AI|Flow|Runway|Kling)/i },
  { id: "add_note", pattern: /(?:新增|建立|記下|紀錄|記錄).{0,12}(?:筆記|note)|(?:筆記|note).{0,12}(?:新增|建立|記下|紀錄|記錄)/i },
  { id: "add_schedule_item", pattern: /(?:安排|排|建立|新增).{0,16}(?:會議|開會|行程|約會|schedule|meeting)|(?:會議|開會|行程).{0,12}(?:安排|排|建立)/i },
  { id: "create_task", pattern: /(?:新增|建立|創建).{0,12}(?:任務|待辦|task)|(?:任務|待辦|task).{0,12}(?:新增|建立|創建)/i },
  { id: "create_project", pattern: /(?:新增|建立|創建|開).{0,16}(?:專案|project)/i },
  { id: "attach_asset_to_shot", pattern: /(?:素材|圖片|影片).*(?:綁定|放進|加入).*(?:鏡|shot)|(?:鏡|shot).*(?:綁定|放進|加入).*(?:素材|圖片|影片)/i },
  { id: "split_script", pattern: /(?:腳本|故事).{0,12}(?:拆成|切成).{0,8}分鏡/i },
  { id: "dispatch_agent", pattern: /(?:做到|交付|交件).{0,16}(?:今天|今日|可以交)|(?:把).{0,12}專案.{0,20}(?:可以交|交付|完成)/i },
];

/** Match a concrete, already-registered capability before considering planning. */
export function capabilityForAssistantGoal(message: string): AssistantCapability | undefined {
  const matched = CAPABILITY_GOAL_PATTERNS.find((entry) => entry.pattern.test(message));
  return matched ? ASSISTANT_CAPABILITIES.find((item) => item.id === matched.id) : undefined;
}

function compactTitle(message: string): string {
  const title = message.replace(/\s+/g, " ").trim();
  return title.length > 34 ? `${title.slice(0, 34)}…` : title;
}

export function classifyAssistantRequest(message: string): AssistantExecutionPlan {
  const text = message.trim();
  const title = compactTitle(text) || "處理這項請求";
  const asksAction = ACTION_RE.test(text);
  const actionVerbCount = new Set(text.match(ACTION_VERB_RE) ?? []).size;
  // 唯讀查詢只有在句中沒有任何寫入動詞時才算問句——見 READ_QUERY_RE 的說明。
  const asksQuestion = QUESTION_RE.test(text) || (actionVerbCount === 0 && READ_QUERY_RE.test(text));
  const matchedCapability = capabilityForAssistantGoal(text);

  if (asksQuestion) {
    const browserCapability = /(?:瀏覽器|browser)/i.test(text)
      ? ASSISTANT_CAPABILITIES.find((item) => item.id === "inspect_computer_runtime")
      : undefined;
    const questionCapability = browserCapability ?? matchedCapability;
    return {
      intent: "ASK",
      confidence: "high",
      title,
      steps: ["讀取目前上下文", "查證需要的資料", "整理結論與下一步"],
      ...(questionCapability ? { capabilityId: questionCapability.id, executionMode: questionCapability.executionMode } : {}),
    };
  }
  if (CROSS_PROJECT_PLAN_RE.test(text) && (asksAction || PLAN_RE.test(text))) {
    return {
      intent: "PLAN",
      confidence: "high",
      title,
      steps: ["確認跨專案範圍", "建立協作計畫", "持續驗證與回報"],
      capabilityId: "orchestrate_group_campaign",
      executionMode: "GROUP_CAMPAIGN",
    };
  }
  if (WATCH_RE.test(text)) {
    return {
      intent: "WATCH",
      confidence: asksAction ? "high" : "medium",
      title,
      steps: ["確認監看範圍", "檢查既有事件與提醒能力", "回報監看狀態"],
    };
  }
  // Capability-first: a bounded URL/file/note/task/project action never becomes
  // a campaign merely because the sentence mentions a project or a folder. A
  // genuinely cross-project/team delivery was already caught above.
  if (matchedCapability && asksAction && !COMPOUND_RE.test(text) && actionVerbCount < 2) {
    return {
      intent: "DIRECT",
      confidence: "high",
      title,
      steps: ["確認必要資訊", "執行", "驗證結果"],
      capabilityId: matchedCapability.id,
      executionMode: matchedCapability.executionMode,
    };
  }
  if ((PROJECT_AGENT_RE.test(text) || (asksAction && (COMPOUND_RE.test(text) || actionVerbCount >= 2)) || (PLAN_RE.test(text) && asksAction))) {
    return {
      intent: "AGENT",
      confidence: "high",
      title,
      steps: ["確認專案上下文", "交給專案 Agent 執行", "驗證成果"],
      executionMode: "PROJECT_AGENT",
    };
  }
  // 「如何建立任務」是詢問；「幫我建立任務」才是執行。這道差異直接決定是否允許寫入。
  if (asksAction && !(asksQuestion && /(?:如何|怎麼|能不能|可不可以)/i.test(text))) {
    return {
      intent: "DIRECT",
      confidence: "high",
      title,
      steps: ["確認必要資訊", "執行", "驗證結果"],
      executionMode: "DIRECT_TOOL",
    };
  }
  return {
    intent: "ASK",
    confidence: text.length >= 4 ? "high" : "medium",
    title,
    steps: ["讀取目前上下文", "查證需要的資料", "整理結論與下一步"],
    ...(matchedCapability ? { capabilityId: matchedCapability.id, executionMode: matchedCapability.executionMode } : {}),
  };
}

/** 只有明確 DIRECT 才能自動寫入；短詞、問句、Agent、規劃與監看都不會誤觸發。 */
export function canDirectlyExecuteCapability(
  plan: AssistantExecutionPlan,
  capabilityId: string,
): boolean {
  if (plan.intent !== "DIRECT" || plan.confidence !== "high") return false;
  const capability = ASSISTANT_CAPABILITIES.find((item) => item.id === capabilityId);
  return capability?.risk === "SAFE_WRITE" && capability.direct;
}
