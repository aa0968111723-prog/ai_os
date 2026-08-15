import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "../api";
import type { CreationAction } from "../features/creation-workbench/creationActions";
import { SuggestionActions } from "../features/creation-workbench/SuggestionActions";
import { Icon } from "./Icon";
import { ConfirmButton } from "./interactions";
import {
  AssistantTrace,
  LiveAssistantTrace,
  type AssistantActivityEvent,
} from "./AssistantTrace";
import { AskSources, type AskSourcesData } from "./AskSources";
import { requestAssistantStream } from "./assistantStream";
import { focusAndReveal } from "../lib/scrollIntoViewForChrome";
import { useAssistantComposeListener } from "../lib/assistantCompose";
import {
  AGENT_PLANNER_OPTIONS,
  getAgentPlannerOption,
  type AgentPlannerMode,
} from "../../../shared/agentPlanner";
import { plannerCostLabel } from "../../../shared/llmPricing";
import {
  readAgentPlannerMode,
  readAssistantAnswerMode,
  writeAgentPlannerMode,
  writeAssistantAnswerMode,
} from "../lib/agentPlannerPreference";
import { Badge, Button, Card, Chip, Hint, Meta } from "./ui";
import { batchSummaryText } from "./assistantBatch";
import { AiUnderstandingPanel } from "../features/creation-workbench/AiUnderstandingPanel";
import { ProactiveModelConverter } from "../features/creation-workbench/ProactiveModelConverter";
import { AgentRunCard } from "./AgentRunCard";
import { AgentWorkPanel } from "./AgentWorkPanel";
import { isAgentEvent, type AgentEvent, type AgentSourceRecord } from "@shared/agentEvents";
import {
  classifyAssistantRequest,
  type AssistantExecutionPlan,
  type AssistantLatencyMetrics,
} from "@shared/assistantExecution";
import { useAssistantContext } from "../lib/assistantContext";
import { toWirePageContext } from "../lib/assistantQuickActions";
import { detectEditingHandoffRequest } from "../lib/externalEditingIntent";
import { EditingHandoffSheet } from "../features/external-editing/EditingHandoffSheet";
import { EditingResultCard, EditingSessionCard } from "../features/external-editing/EditingSessionCard";
/** 助手提議的動作（與後端 assistant.ask 回傳對齊）：確認後原樣送 runAction 執行 */
type Action =
  // sceneNo/sceneTitle 只給前端顯示用（換模型後重建「為第 N 鏡「標題」」），toPayload 會丟掉
  | { type: "generate"; label: string; prompt: string; modelId: string; sceneId?: string; sceneNo?: number; sceneTitle?: string }
  | { type: "update_scene"; label: string; sceneId: string; field: "title" | "voiceover" | "durationSec"; value: string }
  | { type: "create_scene"; label: string; title: string; voiceover?: string; durationSec?: number; prompt?: string }
  | { type: "run_workflow"; label: string; presetId: string; prompt: string }
  // direct_shot：只調這一鏡的鏡頭語言／表演；changes＝伺服器算好的 before→after 差異行（確認前看得到改什麼）
  | {
      type: "direct_shot";
      label: string;
      sceneId: string;
      camera?: Record<string, string | undefined>;
      performance?: Record<string, string | undefined>;
      changes?: string[];
    }
  | { type: "split_script"; label: string; script?: string }
  // plan_agent：把目標交給 AI 創作助手排計畫；plannerMode 由使用者在確認前選擇
  | { type: "plan_agent"; label: string; goal: string; plannerMode?: AgentPlannerMode }
  | { type: "prepare_external_generation"; label: string; sceneId: string; sceneNo: number; externalTool: string; prompt: string }
  // 套用世界觀 chips（確認後寫入專案基調）
  | { type: "apply_worldview_chips"; label: string; themes?: string[]; tones?: string[]; styles?: string[] }
  | { type: "add_database_row"; label: string; tableId: string; tableName: string; data: Record<string, string>; preview: string };

/**
 * SSE 串流的安全活動事件：只描述「正在讀哪類資料／執行哪個查詢／完成哪一步」，
 * 不保存也不展示模型的隱藏 chain-of-thought。
 */
type ThinkEvent = AssistantActivityEvent;

type Turn = {
  role: "you" | "ai";
  text: string;
  actions?: Action[];
  steps?: string[];
  /** 可驗證的工具／查詢活動軌跡；回答完成後保留，預設收合。 */
  activity?: ThinkEvent[];
  /** 統一 Agent 事件流與真的讀過的來源（伺服器權威版本；串流不完整時以它為準） */
  agentEvents?: AgentEvent[];
  agentSources?: AgentSourceRecord[];
  elapsedMs?: number;
  fallback?: boolean;
  /** 這一則回答動用了付費備援（auto 模式 NIM 失敗）。不標出來，
   *  「花到基金會的錢」這件事在畫面上就與免費回答毫無差別。 */
  paid?: boolean;
  paidModel?: string;
  /** 本次依據（P5）：這則回答實際讀了哪些知識、各自完整度、有無被上限截斷 */
  sources?: AskSourcesData;
  executionPlan?: AssistantExecutionPlan;
  runStatus?: "completed" | "failed" | "stopped" | "waiting";
  latency?: AssistantLatencyMetrics;
  retryText?: string;
  directResults?: ProjectDirectResult[];
  editingSessionId?: string;
  editingResult?: { sessionId: string; assetId: string };
};

// Project Assistant already lives in a sheet that unmounts when closed. Keep
// each project's conversation in the module for the life of the tab, matching
// the global Assistant's Conversation-is-Home behavior.
const projectConversationTurns = new Map<string, Turn[]>();
const MAX_PROJECT_CONVERSATIONS = 12;
const MAX_PROJECT_TURNS = 100;

function persistProjectTurns(projectId: string, turns: Turn[]): Turn[] {
  const bounded = turns.length > MAX_PROJECT_TURNS ? turns.slice(-MAX_PROJECT_TURNS) : turns;
  projectConversationTurns.delete(projectId);
  projectConversationTurns.set(projectId, bounded);
  while (projectConversationTurns.size > MAX_PROJECT_CONVERSATIONS) {
    const oldest = projectConversationTurns.keys().next().value as string | undefined;
    if (!oldest) break;
    projectConversationTurns.delete(oldest);
  }
  return bounded;
}

type ProjectDirectResult = {
  kind: string;
  message: string;
  createdScenes?: number;
  sceneIds?: string[];
  verification?: { status: "verified" | "unverified"; message: string };
  externalUrl?: string;
  prompt?: string;
};

function ProjectDirectResultCard({ projectId, result }: { projectId: string; result: ProjectDirectResult }) {
  const utils = trpc.useUtils();
  const undo = trpc.assistant.undoCreatedScenes.useMutation();
  const canUndo = result.kind === "split_script" && Boolean(result.sceneIds?.length);
  return (
    <div className="ai-copilot-action-card is-done" data-fb="專案動作結果卡" style={{ marginTop: 8 }}>
      <Icon name={undo.isSuccess ? "Undo2" : result.verification?.status === "unverified" ? "TriangleAlert" : "Check"} size={14} />
      <span className="ai-copilot-action-card__label">
        {undo.isSuccess ? "已復原這次建立的分鏡" : result.message}
      </span>
      {!undo.isSuccess && result.kind === "split_script" ? (
        <Button variant="ghost" size="sm" onClick={() => { window.location.hash = "sec-scenes"; }}>查看分鏡</Button>
      ) : null}
      {!undo.isSuccess && canUndo ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={undo.isPending}
          onClick={() => undo.mutate(
            { projectId, sceneIds: result.sceneIds! },
            { onSuccess: () => { void utils.scenes.invalidate(); } },
          )}
        >
          <Icon name="Undo2" size={12} /> {undo.isPending ? "復原中…" : "復原"}
        </Button>
      ) : null}
      {undo.error ? <span className="ai-copilot-action-card__error">{undo.error.message}</span> : null}
    </div>
  );
}

function ProjectEditingSessionCard({ projectId, sessionId, onReturned, onReview }: {
  projectId: string;
  sessionId: string;
  onReturned: (assetIds: string[]) => void;
  onReview: (assetId: string) => void;
}) {
  const sessions = trpc.externalEditing.list.useQuery({ projectId });
  const session = sessions.data?.find((item) => item.id === sessionId);
  if (!session) return <Meta as="p">正在讀取剪輯工作階段…</Meta>;
  return <EditingSessionCard session={session} onChanged={() => void sessions.refetch()} onResultReturned={onReturned} onReview={onReview} />;
}

/** assistant.generateModels 的一筆（助手可代操、免來源的多模態生成模型） */
type GenModel = {
  id: string;
  label: string;
  category: string;
  categoryLabel: string;
  kind: string;
  tierLabel: string;
  points: number;
  strengths: string;
  bestFor: string;
  verified: boolean;
  recommended: boolean;
};

/** 送 runAction 的乾淨 payload（去掉只給人看的 label／sceneNo／sceneTitle） */
function toPayload(a: Action) {
  if (a.type === "generate") return { type: "generate" as const, prompt: a.prompt, modelId: a.modelId, sceneId: a.sceneId };
  if (a.type === "update_scene") return { type: "update_scene" as const, sceneId: a.sceneId, field: a.field, value: a.value };
  if (a.type === "plan_agent") return { type: "plan_agent" as const, goal: a.goal, plannerMode: a.plannerMode };
  if (a.type === "prepare_external_generation") return {
    type: "prepare_external_generation" as const,
    sceneId: a.sceneId,
    externalTool: a.externalTool,
    prompt: a.prompt,
  };
  if (a.type === "create_scene") return { type: "create_scene" as const, title: a.title, voiceover: a.voiceover, durationSec: a.durationSec, prompt: a.prompt };
  if (a.type === "run_workflow") return { type: "run_workflow" as const, presetId: a.presetId, prompt: a.prompt };
  if (a.type === "split_script") return { type: "split_script" as const, script: a.script };
  // changes/label 是給人看的預覽，不回送——伺服器會用「現值」重新合併並重算差異
  if (a.type === "direct_shot") return { type: "direct_shot" as const, sceneId: a.sceneId, camera: a.camera, performance: a.performance };
  if (a.type === "add_database_row") return { type: "add_database_row" as const, tableId: a.tableId, data: a.data };
  return {
    type: "apply_worldview_chips" as const,
    themes: a.themes,
    tones: a.tones,
    styles: a.styles,
  };
}

/** 綁分鏡的生成只允許「能填進分鏡格」的模型：文字（LLM）成品不入分鏡、配樂（text-to-audio）沒有專屬槽會覆蓋旁白 */
const sceneFillable = (m: GenModel) => m.kind !== "text" && m.category !== "text-to-audio";

/** 依模態（categoryLabel）把模型聚合成下拉分組（保留後端已排好的 flagship→economy→budget 次序） */
function buildGroups(list: GenModel[]): Array<{ label: string; items: GenModel[] }> {
  const groups: Array<{ label: string; items: GenModel[] }> = [];
  for (const m of list) {
    let g = groups.find((x) => x.label === m.categoryLabel);
    if (!g) { g = { label: m.categoryLabel, items: [] }; groups.push(g); }
    g.items.push(m);
  }
  return groups;
}

/**
 * AI 專案助手（進階版）：問專案進度/生成/分鏡，並可「提議」動作。
 * 安全：明確 ACT 的免費可逆拆分可直接執行＋Undo；付費、外部與其餘寫入仍用 ConfirmButton。
 * 思考過程：問答走 SSE 串流，把「思考中／正在查什麼／查到什麼」即時逐筆呈現；串流不可用時自動退回 tRPC 一次性問答。
 * 收起／清除：對話可整段收起（省版面、不丟執行中狀態）或一鍵清空重來；生成動作可在執行前自己換模型（多模態）。
 *
 * WB-03：onCreationAction 提供「帶入直接出圖／建立多步開拍」等跨模式帶入（只填草稿、不扣點、不送出）。
 * 執行仍走既有 ConfirmButton → runAction；帶入走工作台 CreationAction 契約。
 */
export function ProjectAssistant({
  projectId,
  embedded = false,
  onCreationAction,
  onSavePromptSuggestion,
  onSaveSceneDraft,
  askFillRequest = null,
  knowledgeIds,
  canInspectAi = false,
  /** G2 共創：覆寫冷啟動快捷句（階段相關） */
  quickPrompts,
  /** G2 共創：此 phase 建議主 CTA 的 action.type，UI 標「這一步建議」 */
  primaryActionTypes,
  /** G2：Confirm → runAction 成功後回報（phase 推進／invalidate 由上層） */
  onRunActionSuccess,
}: {
  projectId: string;
  embedded?: boolean;
  /** Workbench bring-in: fill draft / switch mode only (no submit, no charge). */
  onCreationAction?: (action: CreationAction) => void;
  /** Optional: 存進提示詞庫 from suggestion strip. */
  onSavePromptSuggestion?: (text: string, modelId?: string) => void;
  /** Optional: 存成分鏡草稿 from suggestion strip. */
  onSaveSceneDraft?: (text: string) => void;
  /**
   * Workbench CreationAction type:"ask" / apply_prompt→ask: fill chat input without sending.
   * nonce bumps so the same message can re-apply.
   */
  askFillRequest?: { nonce: number; message: string; autoSend?: boolean } | null;
  /** 本次問答優先注入的知識 id（工作台勾選） */
  knowledgeIds?: string[];
  /** Full prompt/trace inspection is editor-only. */
  canInspectAi?: boolean;
  /** 空對話時的快捷句；未傳則用一般「一起想」預設 */
  quickPrompts?: readonly string[];
  /** 標成 phase 主按鈕的 action type 列表 */
  primaryActionTypes?: readonly string[];
  onRunActionSuccess?: (info: {
    actionType: string;
    kind: string;
    message: string;
  }) => void;
}) {
  const utils = trpc.useUtils();
  const pageContext = useAssistantContext();
  const [input, setInput] = useState("");
  /**
   * 別的表面把話丟過來時填進輸入框，**不自動送出**——與 AICreativeCopilot 同一條契約。
   * 在專案路徑（/p/:id、/studio/:id）下，全站助手渲染的是這張卡而不是 Copilot；
   * 少了這行，手機專案頁 AI 輸入列送出的句子會在專案視野裡整句掉光。
   * replayPending=true：這張卡是 lazy chunk，事件發出時它還沒掛載（見 assistantCompose 檔頭）。
   */
  useAssistantComposeListener(setInput, true);
  const [turns, setTurnsState] = useState<Turn[]>(() => projectConversationTurns.get(projectId) ?? []);
  const setTurns = (next: Turn[] | ((previous: Turn[]) => Turn[])) => {
    setTurnsState((previous) => {
      const resolved = typeof next === "function" ? next(previous) : next;
      return persistProjectTurns(projectId, resolved);
    });
  };
  const [collapsed, setCollapsed] = useState(false);
  const [liveTraceOpen, setLiveTraceOpen] = useState(true);
  // 思考過程串流狀態：active＝正在問答中，events＝已收到的思考步驟（逐筆追加即時顯示）
  const [thinking, setThinking] = useState<{ active: boolean; events: ThinkEvent[] }>({ active: false, events: [] });
  const [fallbackPending, setFallbackPending] = useState(false);
  const [activePlan, setActivePlan] = useState<AssistantExecutionPlan | null>(null);
  /** 串流事件中結構化的那些（新協定）。舊伺服器只吐 {phase,text} 時是空陣列，畫面自動退回舊軌跡元件。 */
  const liveAgentEvents = useMemo(() => thinking.events.filter(isAgentEvent), [thinking.events]);
  // 已執行的提議動作鍵（turnIndex:actionIndex）＋正在執行中的鍵——停用「已執行」的按鈕，避免重複點擊
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // 使用者在執行前自選的模型（動作鍵 → 模型 id）：只影響 generate 動作，覆蓋助手原提議的 modelId
  const [modelOverride, setModelOverride] = useState<Record<string, string>>({});
  // 代理規劃供應商／用量策略；保留使用者上次選擇，個別提議仍可覆蓋。
  const [defaultPlannerMode, setDefaultPlannerMode] = useState<AgentPlannerMode>(readAgentPlannerMode);
  const [plannerModeOverride, setPlannerModeOverride] = useState<Record<string, AgentPlannerMode>>({});
  // 回答這則提問要用的模型：與代理規劃檔位分開存（聊天預設免費，規劃預設高品質＋計點）
  const [answerMode, setAnswerMode] = useState<AgentPlannerMode>(readAssistantAnswerMode);
  const [traceSessionId, setTraceSessionId] = useState<string | null>(null);
  const [editingSheetOpen, setEditingSheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const push = (t: Turn) => {
    setTurns((prev) => [...prev, t]);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  };
  const bumpScroll = () => requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
  // 進行中串流的中止控制：元件卸載、切換專案、送下一題前都 abort，讓伺服器端 res.on('close') 停掉在途 LLM 呼叫（不白燒免費額度）
  const abortRef = useRef<AbortController | null>(null);
  // React state 更新是非同步的；用 ref 同步累積本題活動，確保 done 與 fallback 都能完整保存。
  const traceRef = useRef<ThinkEvent[]>([]);
  const requestStartedAtRef = useRef(0);
  // prop 變更不一定會 remount；所有非同步 callback 都以「目前專案＋請求世代」雙重守門，
  // 避免舊專案的 SSE/tRPC/動作結果在導航後落進新專案。
  const activeProjectIdRef = useRef(projectId);
  activeProjectIdRef.current = projectId;
  const requestEpochRef = useRef(0);
  const projectGenerationRef = useRef(0);
  const previousProjectIdRef = useRef(projectId);
  const requestIsCurrent = (requestProjectId: string, epoch: number) =>
    activeProjectIdRef.current === requestProjectId && requestEpochRef.current === epoch;

  // 助手可代操的多模態生成模型（免來源），供「換模型」下拉；載入失敗就沿用助手原提議，不擋流程
  const genModels = trpc.assistant.generateModels.useQuery(undefined, { staleTime: 5 * 60_000 });
  const allModels = useMemo(() => (genModels.data ?? []) as GenModel[], [genModels.data]);
  const modelById = useMemo(() => {
    const map = new Map<string, GenModel>();
    for (const m of allModels) map.set(m.id, m);
    return map;
  }, [allModels]);
  // 下拉分組：全部（未綁分鏡的 generate 可用）／可填分鏡（綁分鏡時只露這些，排除 LLM／配樂）
  const allGroups = useMemo(() => buildGroups(allModels), [allModels]);
  const sceneGroups = useMemo(() => buildGroups(allModels.filter(sceneFillable)), [allModels]);

  const run = trpc.assistant.runAction.useMutation();
  const undoCreatedScenes = trpc.assistant.undoCreatedScenes.useMutation();

  // tRPC 一次性問答：串流不可用時的退路。每次呼叫使用帶 request epoch 的局部 callback，
  // mutation 本身不能取消時也能丟棄過期答案。
  const ask = trpc.assistant.ask.useMutation();
  const preview = trpc.assistant.preview?.useMutation?.() ?? {
    data: undefined,
    error: null,
    isPending: false,
    mutate: (_input: unknown) => undefined,
  };

  const busy = thinking.active || fallbackPending || pendingKey?.startsWith("auto:") === true;

  const runDirectProjectActions = async (
    actions: Action[],
    plan: AssistantExecutionPlan,
    requestProjectId: string,
    epoch: number,
    signal: AbortSignal,
  ) => {
    const direct = plan.intent === "DIRECT" && plan.confidence === "high"
      ? actions.filter((action) => action.type === "split_script")
      : [];
    if (!direct.length) return new Set<Action>();
    const directSet = new Set(direct);
    setPendingKey(`auto:${epoch}`);
    for (const action of direct) {
      if (signal.aborted || !requestIsCurrent(requestProjectId, epoch)) break;
      try {
        const result = await run.mutateAsync({ projectId: requestProjectId, action: toPayload(action) });
        // Stop 可能在目前工具已送出後發生；若是可逆的拆分鏡，立即補做 Undo，不留下半套結果。
        if (signal.aborted || !requestIsCurrent(requestProjectId, epoch)) {
          if (result.kind === "split_script" && result.sceneIds.length) {
            await undoCreatedScenes.mutateAsync({ projectId: requestProjectId, sceneIds: result.sceneIds });
            void utils.scenes.invalidate();
          }
          break;
        }
        void utils.scenes.invalidate();
        void utils.quota.invalidate();
        push({ role: "ai", text: "已完成專案操作。", directResults: [result] });
        onRunActionSuccess?.({ actionType: action.type, kind: result.kind, message: result.message });
      } catch (error) {
        if (requestIsCurrent(requestProjectId, epoch)) {
          // 失敗不謊報成功；把原動作留成確認卡，使用者可在看過錯誤後重試。
          push({
            role: "ai",
            text: `動作沒成功：${error instanceof Error ? error.message : "未知錯誤"}`,
            actions: [action],
          });
        }
      }
    }
    if (requestIsCurrent(requestProjectId, epoch)) setPendingKey(null);
    return directSet;
  };

  /** 串流問答：讀 SSE 逐筆更新思考過程，done 補上 AI 回覆。回傳 true＝已處理（含 error／主動中止），false＝請退回 tRPC。 */
  async function askViaStream(
    message: string,
    nonce: string,
    signal: AbortSignal,
    requestProjectId: string,
    epoch: number,
  ): Promise<boolean> {
    const history = turns.slice(-8).map((turn) => ({
      role: turn.role === "you" ? "user" as const : "assistant" as const,
      text: turn.text,
    }));
    return requestAssistantStream({
      projectId: requestProjectId,
      message,
      nonce,
      // 使用者為「回答模型」選的檔位；預設 nim＝免費，選 fal 檔位平台才付費
      mode: answerMode,
      knowledgeIds: knowledgeIds?.length ? knowledgeIds : undefined,
      history: history.length ? history : undefined,
      pageContext: toWirePageContext(pageContext),
      signal,
      handlers: {
        onOpen: (opened) => {
          if (requestIsCurrent(requestProjectId, epoch)) setActivePlan(opened.plan);
        },
        onStep: (event) => {
          if (!requestIsCurrent(requestProjectId, epoch)) return;
          traceRef.current = [...traceRef.current, event];
          setThinking((state) => ({ active: true, events: [...state.events, event] }));
          bumpScroll();
        },
        onDone: (result) => {
          if (!requestIsCurrent(requestProjectId, epoch)) return;
          setTraceSessionId(result.traceSessionId ?? null);
          const plan = activePlan ?? classifyAssistantRequest(message);
          const actions = result.actions as Action[];
          const directlyRunnable = plan.intent === "DIRECT" && plan.confidence === "high"
            ? new Set(actions.filter((action) => action.type === "split_script"))
            : new Set<Action>();
          const pendingActions = actions.filter((action) => !directlyRunnable.has(action));
          const events = result.agentEvents ?? traceRef.current.filter(isAgentEvent);
          const hasFailure = events.some((event) => event.type === "agent.failed" && event.status === "failed");
          const hasVerifiedCompletion = events.some((event) => event.type === "agent.completed" && event.status === "ok");
          // Pending confirmation / proposed writes are not "Aios 已完成".
          const runStatus: Turn["runStatus"] = hasFailure
            ? "failed"
            : pendingActions.length > 0
              ? "waiting"
              : hasVerifiedCompletion
                ? "completed"
                : "waiting";
          push({
            role: "ai",
            text: result.answer,
            actions: pendingActions,
            steps: result.steps,
            activity: [...traceRef.current],
            // 事件與來源以伺服器最終版本為準；串流掉封包時前端累積的那份會不完整
            agentEvents: events,
            agentSources: result.agentSources,
            elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
            fallback: result.fallback,
            paid: result.fellBackToPaid === true,
            paidModel: result.model,
            sources: result.sources,
            executionPlan: plan,
            latency: result.latency,
            runStatus,
          });
          if (directlyRunnable.size) {
            void runDirectProjectActions(actions, plan, requestProjectId, epoch, signal);
          }
        },
        onError: (errorMessage) => {
          if (!requestIsCurrent(requestProjectId, epoch)) return;
          push({
            role: "ai",
            text: errorMessage,
            activity: [...traceRef.current],
            // 失敗也要留下已經跑過的事件：使用者最需要知道的正是「卡在哪一步」
            agentEvents: traceRef.current.filter(isAgentEvent),
            elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
            executionPlan: activePlan ?? classifyAssistantRequest(message),
            runStatus: "failed",
            retryText: message,
          });
        },
      },
    });
  }

  /**
   * override＝從工作台「目標」框直接送出（QA 2026-08-01：那個框先前只鏡射不能送，看起來像壞的）。
   * 不吃 input state 是因為呼叫端剛 setInput，state 這一輪還沒更新。
   */
  const send = async (override?: string) => {
    const m = (override ?? input).trim();
    if (!m || busy) return;
    if (detectEditingHandoffRequest(m)) {
      push({ role: "you", text: m });
      push({ role: "ai", text: "我會在這段專案對話中準備正式的 LumaFusion 交接。請先確認範圍與主要素材。" });
      setInput("");
      setEditingSheetOpen(true);
      return;
    }
    abortRef.current?.abort(); // 保險：中止任何殘留串流（busy 守門通常已擋住並行）
    const requestProjectId = projectId;
    const epoch = ++requestEpochRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    traceRef.current = [];
    requestStartedAtRef.current = Date.now();
    setLiveTraceOpen(true);
    setActivePlan(classifyAssistantRequest(m));
    // 串流與退回 tRPC 共用的請求關聯鍵；伺服器仍會對每個外部呼叫各自計次。
    const nonce = (crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
    push({ role: "you", text: m });
    setInput("");
    setThinking({ active: true, events: [] });
    const handled = await askViaStream(m, nonce, ctrl.signal, requestProjectId, epoch);
    if (!requestIsCurrent(requestProjectId, epoch)) return;
    setThinking({ active: false, events: [] });
    setActivePlan(null);
    // 主動中止不退回；串流沒完成才用一次性問答補上（帶同一 nonce 方便追蹤）。
    if (!handled && !ctrl.signal.aborted) {
      setFallbackPending(true);
      ask.mutate(
        {
          projectId: requestProjectId,
          message: m,
          nonce,
          mode: answerMode,
          knowledgeIds: knowledgeIds?.length ? knowledgeIds : undefined,
          history: turns.slice(-8).map((turn) => ({
            role: turn.role === "you" ? "user" as const : "assistant" as const,
            text: turn.text,
          })),
          pageContext: toWirePageContext(pageContext),
        },
        {
          onSuccess: (result) => {
            if (!requestIsCurrent(requestProjectId, epoch)) return;
            setTraceSessionId(result.traceSessionId ?? null);
            const fallbackActivity = result.steps.map((text) => ({ phase: "step" as const, text }));
            const actions = result.actions as Action[];
            const events = result.agentEvents ?? traceRef.current.filter(isAgentEvent);
            const hasFailure = events.some((event) => event.type === "agent.failed" && event.status === "failed");
            const hasVerifiedCompletion = events.some((event) => event.type === "agent.completed" && event.status === "ok");
            const runStatus: Turn["runStatus"] = hasFailure
              ? "failed"
              : actions.length > 0
                ? "waiting"
                : hasVerifiedCompletion
                  ? "completed"
                  : "waiting";
            push({
              role: "ai",
              text: result.answer,
              actions,
              steps: result.steps,
              activity: traceRef.current.length > 0 ? [...traceRef.current] : fallbackActivity,
              agentEvents: events,
              agentSources: result.agentSources,
              elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
              fallback: true,
              paid: result.fellBackToPaid === true,
              paidModel: result.model,
              sources: result.sources,
              executionPlan: classifyAssistantRequest(m),
              runStatus,
            });
          },
          onError: (error) => {
            if (!requestIsCurrent(requestProjectId, epoch)) return;
            push({
              role: "ai",
              text: error.message,
              activity: [...traceRef.current],
              elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
              fallback: true,
              executionPlan: classifyAssistantRequest(m),
              runStatus: "failed",
              retryText: m,
            });
          },
          onSettled: () => {
            if (requestIsCurrent(requestProjectId, epoch)) setFallbackPending(false);
          },
        },
      );
    }
  };

  const cancelCurrent = () => {
    if (!thinking.active && !pendingKey?.startsWith("auto:")) return;
    abortRef.current?.abort();
    requestEpochRef.current += 1;
    setThinking({ active: false, events: [] });
    setFallbackPending(false);
    setActivePlan(null);
    setPendingKey(null);
    push({
      role: "ai",
      text: "已停止；未開始的步驟不再執行。若拆分鏡已送出，完成後會自動移回回收桶。",
      activity: [...traceRef.current],
      elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
      executionPlan: activePlan ?? undefined,
      runStatus: "stopped",
    });
  };

  // 卸載時中止在途串流；切換專案時中止並清空（避免前一專案的答案落進新專案的對話）
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      requestEpochRef.current += 1;
      projectGenerationRef.current += 1;
    };
  }, []);
  useEffect(() => {
    // projectId 變更：中止舊串流並重置對話狀態（本元件在 /p/A→/p/B 只換 prop 不 remount）
    if (previousProjectIdRef.current === projectId) return;
    previousProjectIdRef.current = projectId;
    abortRef.current?.abort();
    requestEpochRef.current += 1;
    projectGenerationRef.current += 1;
    setTurns(projectConversationTurns.get(projectId) ?? []);
    setThinking({ active: false, events: [] });
    setFallbackPending(false);
    setActivePlan(null);
    setExecuted(new Set());
    setModelOverride({});
    setPlannerModeOverride({});
    setPendingKey(null);
    setInput("");
    setTraceSessionId(null);
    traceRef.current = [];
    requestStartedAtRef.current = 0;
    setLiveTraceOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // WB-03: CreationAction ask / apply_prompt→ask fills input without sending (no charge).
  useEffect(() => {
    if (!askFillRequest) return;
    setInput(askFillRequest.message);
    setCollapsed(false);
    // autoSend＝使用者在工作台按了「送出」；提問本身免費，不需要再確認一次
    if (askFillRequest.autoSend) void send(askFillRequest.message);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askFillRequest]);

  // 一鍵清除：清對話與所有連帶暫存（已執行標記、換模型選擇），回到冷啟動可再問
  const clear = () => {
    setTurns([]);
    setExecuted(new Set());
    setModelOverride({});
    setPendingKey(null);
  };

  /** generate 動作套上使用者選的模型（沒選就用助手原提議）；回傳實際要送出的動作與展示用模型資訊 */
  const effectiveGenerate = (act: Extract<Action, { type: "generate" }>, actKey: string) => {
    const chosenId = modelOverride[actKey] ?? act.modelId;
    const info = modelById.get(chosenId);
    return { action: { ...act, modelId: chosenId }, info };
  };

  /** 生成動作的完整說明（按鈕臉＋確認框共用，換模型後三者一致）：有 info 就用實際會送的模型與估點重建；否則退回後端原 label */
  const genLabel = (act: Extract<Action, { type: "generate" }>, info?: GenModel): string => {
    if (!info) return act.label;
    return act.sceneNo
      ? `用 ${info.label} 為第 ${act.sceneNo} 鏡${act.sceneTitle ? `「${act.sceneTitle}」` : ""}生成（${info.points} 點）`
      : `用 ${info.label} 生成：${act.prompt.slice(0, 24)}…（${info.points} 點）`;
  };

  // embedded：外殼由 CreationWorkbench / AskAiMode（或 legacy AiHub 測試）提供；「收起」由模式切換取代
  const showCollapse = !embedded;
  const body = (
    <>
      {(!embedded || turns.length > 0) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          {!embedded && (
            <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
              <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> AI 專案助手
            </h2>
          )}
          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            {turns.length > 0 && (
              <Button variant="ghost" size="sm"
                type="button"
                title="清空這段對話，重新開始"
                onClick={clear}
                disabled={busy || pendingKey !== null}>
                <Icon name="Trash2" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />清除
              </Button>
            )}
            {showCollapse && (
              <Button variant="ghost" size="sm"
                type="button"
                aria-expanded={!collapsed}
                aria-controls="sec-assistant-body"
                title={collapsed ? "展開助手" : "收起助手（省版面）"}
                onClick={() => setCollapsed((c) => !c)}>
                <Icon name={collapsed ? "ChevronDown" : "ChevronUp"} size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
                {collapsed ? "展開" : "收起"}
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 收起時顯示提示；本體恆掛在 DOM（用 hidden 切換）——aria-controls 不懸空，執行中/展開中的動作狀態也不會被卸載清掉 */}
      {showCollapse && collapsed && (
        <Meta as="p" style={{ marginTop: 8 }}>
          助手已收起{turns.length > 0 ? `（保留 ${turns.length} 則對話）` : ""}{busy ? "・仍在思考中" : ""}。點「展開」繼續。
        </Meta>
      )}

      <div id="sec-assistant-body" hidden={collapsed}>
        <Hint style={{ marginTop: 4 }}>
          一個對話統包：<b>問</b>（進度、分鏡、素材與資料庫）、<b>發想</b>、<b>拆分鏡</b>與<b>下目標</b>。明確要求拆分目前腳本時會直接建立真正分鏡並提供復原；付費生成、對外或較高風險動作仍會先確認。提問本身預設用 NVIDIA NIM 免費額度、不扣點。
        </Hint>

        <ProactiveModelConverter intent={input} onCreationAction={onCreationAction} />

        {/* 快速開場：點一顆帶入輸入框，按「問」才送出。共創 G2 可覆寫為 phase 快捷句 */}
        {turns.length === 0 && !thinking.active && (
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}
            data-testid="assistant-quick-prompts"
          >
            {(quickPrompts ?? [
              "這個專案進度到哪？",
              "給我 3 個分鏡 idea",
              "把知識庫的腳本拆成分鏡，並為每一鏡生成畫面",
              "幫我推薦適合本專案的生成模型",
            ]).map((q) => (
              <Button size="sm"
                key={q}
                type="button"
                title="點了帶入輸入框，按「問」才送出（免費）"
                onClick={() => setInput(q)}>
                {q}
              </Button>
            ))}
          </div>
        )}

        {(turns.length > 0 || thinking.active) && (
          // role="log"＋aria-live：AI 回覆與思考步驟都是非同步 push 進來的，沒有活躍區報讀器會完全靜音
          <div
            ref={scrollRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="AI 專案助手對話"
            tabIndex={0}
            style={{ maxHeight: 320, overflowY: "auto", margin: "12px 0", display: "flex", flexDirection: "column", gap: 10 }}
          >
            {turns.map((t, i) => {
              const activity = t.activity?.length
                ? t.activity
                : (t.steps ?? []).map((text) => ({ phase: "step" as const, text }));
              return (
              <div key={i} style={{ alignSelf: t.role === "you" ? "flex-end" : "flex-start", maxWidth: "90%" }}>
                <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", marginBottom: 2, textAlign: t.role === "you" ? "right" : "left" }}>
                  {t.role === "you" ? "你" : "助手"}
                  {/* 付費備援標示：送出前的靜態提示只說「可能」，這裡標的是「真的發生了」。
                      成本透明是站方不變式（伺服器端特意送出 fellBackToPaid 就是為了這裡）。 */}
                  {t.role === "ai" && t.paid && (
                    <Badge
                      style={{ marginLeft: 6 }}
                      title={t.paidModel ? `NIM 無回應，這一題已自動改用付費模型 ${t.paidModel}` : "NIM 無回應，這一題已自動改用付費模型"}
                    >
                      已用付費備援{t.paidModel ? ` · ${t.paidModel.split("/").pop()}` : ""}
                    </Badge>
                  )}
                </div>
                {/* 回答完成後保留安全的活動軌跡，預設收合以免長對話把工作台撐爆。 */}
                {t.role === "ai" && (
                  t.executionPlan ? (
                    <AgentRunCard
                      plan={t.executionPlan}
                      active={false}
                      outcome={t.runStatus}
                      events={t.agentEvents}
                      latency={t.latency}
                    />
                  ) : null
                )}
                {/* 工作過程＋來源（新協定）。舊伺服器沒有結構化事件時退回原本的軌跡元件，
                    這樣灰度部署期間兩種伺服器都有東西可看，而不是一片空白。 */}
                {t.role === "ai" && (t.agentEvents?.length || t.agentSources?.length) ? (
                  <AgentWorkPanel events={t.agentEvents ?? []} sources={t.agentSources ?? []} />
                ) : t.role === "ai" ? (
                  <AssistantTrace
                    events={activity}
                    elapsedMs={t.elapsedMs}
                    fallback={t.fallback}
                  />
                ) : null}
                {/* 本次依據（P5）：這則回答讀了什麼、有沒有因為上限沒讀完 */}
                {t.role === "ai" && <AskSources sources={t.sources} />}
                <div
                  style={{
                    background: t.role === "you" ? "var(--primary-tint)" : "var(--card2)",
                    color: t.role === "you" ? "var(--primary-ink)" : "var(--fg)",
                    border: "1px solid var(--border-soft)",
                    borderRadius: "var(--r-12)",
                    padding: "8px 12px",
                    fontSize: "var(--fs-14)",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    lineHeight: 1.6,
                  }}
                >
                  {t.text}
                </div>
                {t.directResults?.map((result, resultIndex) => (
                  <ProjectDirectResultCard key={`${result.kind}:${resultIndex}`} projectId={projectId} result={result} />
                ))}
                {t.editingSessionId ? (
                  <ProjectEditingSessionCard projectId={projectId} sessionId={t.editingSessionId} onReturned={(assetIds) => {
                    if (!assetIds[0]) return;
                    push({
                      role: "ai",
                      text: "✓ LumaFusion 剪輯成果已回到原工作階段，版本來源與專案位置都已保留。",
                      editingResult: { sessionId: t.editingSessionId!, assetId: assetIds[0] },
                    });
                  }} onReview={(assetId) => void send(`幫我審查剛從 LumaFusion 帶回的成片（Asset ${assetId}），比較目前專案腳本與分鏡，並清楚標示可驗證的來源；如果無法取得精確 timecode，請直接說明。`)} />
                ) : null}
                {t.editingResult ? <EditingResultCard assetId={t.editingResult.assetId} sessionId={t.editingResult.sessionId}
                  onReview={(assetId) => void send(`幫我審查剛從 LumaFusion 帶回的成片（Asset ${assetId}），比較目前專案腳本與分鏡，並清楚標示可驗證的來源；如果無法取得精確 timecode，請直接說明。`)} /> : null}
                {t.retryText ? (
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void send(t.retryText)}>
                    <Icon name="Play" size={12} /> 繼續
                  </Button>
                ) : null}
                {/* §33 批次總帳：一次提議多個動作時，先讓人看懂全貌與費用，再逐顆確認 */}
                {t.actions && batchSummaryText(t.actions) && (
                  <Hint as="p" role="status" style={{ margin: "8px 0 0" }}>
                    <Icon name="List" size={12} style={{ verticalAlign: "-1px", marginRight: 4 }} />
                    {batchSummaryText(t.actions)}
                  </Hint>
                )}
                {t.actions && t.actions.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                    {t.actions.map((act, j) => {
                      const actKey = `${i}:${j}`;
                      const isDone = executed.has(actKey);
                      const isRunning = pendingKey === actKey;
                      // generate 動作套上使用者可能換過的模型；其餘動作照原樣
                      const gen = act.type === "generate" ? effectiveGenerate(act, actKey) : null;
                      const chosenPlannerMode = plannerModeOverride[actKey] ?? defaultPlannerMode;
                      const payloadAct = gen
                        ? gen.action
                        : act.type === "plan_agent"
                          ? { ...act, plannerMode: chosenPlannerMode }
                          : act;
                      const plannerOption = getAgentPlannerOption(chosenPlannerMode);
                      // 綁分鏡的 generate 只讓換到「能填進分鏡格」的模型；未綁分鏡可換任何多模態模型
                      const groups = gen ? (gen.action.sceneId ? sceneGroups : allGroups) : [];
                      const chosenId = gen?.action.modelId ?? "";
                      const chosenInGroups = groups.some((g) => g.items.some((m) => m.id === chosenId));
                      // 生成動作的顯示文字：換模型後由 genLabel 依實際會送的模型＋估點重建（按鈕臉＋確認框同源）
                      const faceLabel = gen ? genLabel(gen.action, gen.info) : payloadAct.label;
                      const isPhasePrimary =
                        Boolean(primaryActionTypes?.length) &&
                        primaryActionTypes!.includes(payloadAct.type);
                      const confirmMsg =
                        payloadAct.type === "generate"
                          ? `執行「${gen ? genLabel(gen.action, gen.info) : payloadAct.label}」？${gen?.info ? "" : "（點數見上方說明）"}`
                          : payloadAct.type === "run_workflow"
                            ? `執行「${payloadAct.label}」？各步驟會分別扣點。`
                            : payloadAct.type === "split_script"
                              ? `執行「${payloadAct.label}」？會呼叫 AI 導演拆分鏡（免費）。`
                              : payloadAct.type === "plan_agent"
                                ? `把這個目標交給 AI 創作助手，並使用「${plannerOption.shortLabel}」？規劃本身${plannerCostLabel(chosenPlannerMode)}。這一步只排計畫，你在「AI 執行計畫」核准後才會開始花執行點數。`
                                : payloadAct.type === "apply_worldview_chips"
                                  ? `套用世界觀基調「${payloadAct.label.replace(/^套用基調：/, "")}」？會覆寫你有選到的主軸／調性／風格欄位（未列的欄位不動）。可之後在專案基調區再改。`
                                  : payloadAct.type === "direct_shot"
                                    ? `套用這一鏡的調整？${payloadAct.changes?.length ? `會改：${payloadAct.changes.join("、")}。` : ""}沒列到的欄位不動，免費。`
                                    : payloadAct.type === "add_database_row"
                                      ? `在資料庫「${payloadAct.tableName}」新增這一列？\n${payloadAct.preview}`
                                    : `執行「${payloadAct.label}」？`;
                      return (
                        <div
                          key={j}
                          style={{ display: "flex", flexDirection: "column", gap: 4 }}
                          data-phase-primary={isPhasePrimary ? "true" : undefined}
                          data-testid={isPhasePrimary ? "co-create-primary-action" : undefined}
                        >
                          {/* 換模型（多模態）：只在 generate 動作出現，執行前可改用哪個模型／模態 */}
                          {gen && !isDone && (
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--fs-11)", color: "var(--fg-secondary)" }}>
                              <Icon name="SlidersHorizontal" size={12} /> 模型
                              <select
                                aria-label="選擇生成模型"
                                value={chosenId}
                                disabled={isRunning || genModels.isLoading || groups.length === 0}
                                onChange={(e) => setModelOverride((prev) => ({ ...prev, [actKey]: e.target.value }))}
                                style={{ fontSize: "var(--fs-11)", padding: "2px 4px", maxWidth: 260 }}
                              >
                                {/* 目前選定的 id 不在可選清單（助手提議了不適用此分鏡的模型／清單未載入）時補一顆，確保 select 不空白 */}
                                {!chosenInGroups && (
                                  <option value={chosenId}>
                                    {modelById.get(chosenId)?.label ?? chosenId}{gen.action.sceneId ? "（不適用此分鏡）" : ""}
                                  </option>
                                )}
                                {groups.map((g) => (
                                  <optgroup key={g.label} label={g.label}>
                                    {g.items.map((m) => (
                                      <option key={m.id} value={m.id}>
                                        {m.tierLabel}・{m.label} — {m.points} 點{m.recommended ? " 推薦" : ""}{m.verified ? "" : " 未驗證"}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </label>
                          )}
                          {/* 選定模型的特性一行說明（幫使用者判斷該不該換；含推薦／未驗證標示，與挑選器一致） */}
                          {gen?.info && !isDone && (
                            <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", maxWidth: 320, lineHeight: 1.4 }}>
                              {gen.info.recommended && <Chip selected style={{ marginRight: 4 }}>推薦</Chip>}
                              {gen.info.strengths}
                              {!gen.info.verified && <span style={{ color: "var(--gold-ink)" }}>（新模型 ID，首跑校準；失敗自動退點）</span>}
                            </div>
                          )}
                          {payloadAct.type === "plan_agent" && !isDone && (
                            <label style={{ display: "grid", gap: 3, fontSize: "var(--fs-11)", color: "var(--fg-secondary)", maxWidth: 360 }}>
                              {/* 這個選擇同時決定「問答」與「代理規劃」用哪個模型——
                                * 兩者共用同一個偏好鍵。標籤要講清楚，否則使用者以為只在調規劃。 */}
                              <span>
                                <Icon name="SlidersHorizontal" size={12} /> 規劃模型與用量（也會套用到問答）
                              </span>
                              <select
                                aria-label="選擇代理規劃模型與用量"
                                value={chosenPlannerMode}
                                disabled={isRunning}
                                onChange={(event) => {
                                  const mode = event.target.value as AgentPlannerMode;
                                  setPlannerModeOverride((prev) => ({ ...prev, [actKey]: mode }));
                                  setDefaultPlannerMode(mode);
                                  writeAgentPlannerMode(mode);
                                }}
                                style={{ fontSize: "var(--fs-12)", padding: "4px 6px", maxWidth: 360 }}
                              >
                                {AGENT_PLANNER_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label} — {plannerCostLabel(option.value)}
                                  </option>
                                ))}
                              </select>
                              <span>
                                {plannerOption.description}
                                {(chosenPlannerMode === "auto" || chosenPlannerMode.startsWith("fal_"))
                                  ? " 可能會把本次規劃所需的專案內容傳給 fal.ai。"
                                  : ""}
                              </span>
                            </label>
                          )}
                          {isPhasePrimary && !isDone && (
                            <Meta as="span" style={{ fontSize: 11, margin: 0 }} data-testid="co-create-primary-badge">
                              這一步建議
                            </Meta>
                          )}
                          <ConfirmButton
                            triggerClassName={
                              isPhasePrimary ? "primary btn-sm" : "btn-tonal btn-sm"
                            }
                            disabled={isDone || isRunning}
                            title={
                              isDone
                                ? "此動作已執行"
                                : isPhasePrimary
                                  ? "這一步建議動作：確認後才執行（扣點／寫入）"
                                  : "確認執行助手提議的動作"
                            }
                            message={confirmMsg}
                            confirmLabel="執行"
                            onConfirm={async () => {
                              const actionProjectId = projectId;
                              const actionProjectGeneration = projectGenerationRef.current;
                              const actionIsCurrent = () =>
                                activeProjectIdRef.current === actionProjectId
                                && projectGenerationRef.current === actionProjectGeneration;
                              const externalWindow = payloadAct.type === "prepare_external_generation"
                                ? window.open("about:blank", "_blank")
                                : null;
                              if (externalWindow) externalWindow.opener = null;
                              setPendingKey(actKey);
                              try {
                                const result = await run.mutateAsync({
                                  projectId: actionProjectId,
                                  action: toPayload(payloadAct),
                                });
                                if (result.kind === "prepare_external_generation") {
                                  await navigator.clipboard?.writeText(result.prompt).catch(() => undefined);
                                  if (externalWindow) externalWindow.location.replace(result.externalUrl);
                                  else window.open(result.externalUrl, "_blank", "noopener,noreferrer");
                                }
                                // 動作已在原專案執行；快取失效不依目前畫面，讓回到原專案時能取到新資料。
                                utils.generation.invalidate();
                                utils.scenes.invalidate();
                                utils.quota.invalidate();
                                if (result.kind === "run_workflow") utils.workflows.invalidate();
                                if (result.kind === "plan_agent") utils.agents.invalidate();
                                if (result.kind === "apply_worldview_chips") {
                                  utils.projects.get.invalidate({ id: actionProjectId });
                                  utils.projects.list.invalidate();
                                }
                                if (result.kind === "add_database_row") {
                                  utils.databases.list.invalidate();
                                }
                                if (!actionIsCurrent()) return;
                                push({ role: "ai", text: `✓ ${result.message}` });
                                setExecuted((prev) => new Set(prev).add(actKey));
                                onRunActionSuccess?.({
                                  actionType: payloadAct.type,
                                  kind: result.kind,
                                  message: result.message,
                                });
                              } catch (error) {
                                externalWindow?.close();
                                if (actionIsCurrent()) {
                                  push({
                                    role: "ai",
                                    text: `動作沒成功：${error instanceof Error ? error.message : "未知錯誤"}`,
                                  });
                                }
                              } finally {
                                if (actionIsCurrent()) {
                                  setPendingKey((key) => (key === actKey ? null : key));
                                }
                              }
                            }}
                          >
                            <Icon
                              name={
                                payloadAct.type === "generate" ? "Sparkles"
                                  : payloadAct.type === "create_scene" ? "Plus"
                                    : payloadAct.type === "run_workflow" ? "Play"
                                      : payloadAct.type === "split_script" ? "Clapperboard"
                                        : payloadAct.type === "plan_agent" ? "Film"
                                          : payloadAct.type === "prepare_external_generation" ? "ArrowRight"
                                          : payloadAct.type === "apply_worldview_chips" ? "Palette"
                                            : payloadAct.type === "direct_shot" ? "Camera"
                                              : payloadAct.type === "add_database_row" ? "Database"
                                              : "Pencil"
                              }
                              size={13}
                              style={{ verticalAlign: "-2px", marginRight: 4 }}
                            />
                            {isDone ? "已執行" : faceLabel}
                          </ConfirmButton>
                          {/* WB-03 bring-in：只填草稿／切模式，不走 runAction、不扣點 */}
                          {onCreationAction && payloadAct.type === "generate" && !isDone && (
                            <SuggestionActions
                              suggestionText={payloadAct.prompt}
                              modelId={payloadAct.modelId}
                              onAction={onCreationAction}
                              onSavePrompt={onSavePromptSuggestion}
                              onSaveSceneDraft={onSaveSceneDraft}
                              disabled={isRunning}
                            />
                          )}
                          {onCreationAction && payloadAct.type === "plan_agent" && !isDone && (
                            <Button size="sm"
                              type="button"
                              disabled={isRunning}
                              title="帶入多步開拍目標並切換模式，不自動排程、不扣點"
                              onClick={() =>
                                onCreationAction({
                                  type: "create_plan",
                                  goal: payloadAct.goal,
                                })
                              }>
                              帶入多步開拍
                            </Button>
                          )}
                          {onCreationAction && payloadAct.type === "run_workflow" && !isDone && (
                            <Button size="sm"
                              type="button"
                              disabled={isRunning}
                              title="帶入套用範本模式，不自動啟動工作流"
                              onClick={() =>
                                onCreationAction({
                                  type: "run_template",
                                  templateId: payloadAct.presetId,
                                  goal: payloadAct.prompt,
                                })
                              }>
                              帶入套用範本
                            </Button>
                          )}
                          {onCreationAction &&
                            payloadAct.type === "create_scene" &&
                            payloadAct.prompt &&
                            !isDone && (
                              <SuggestionActions
                                suggestionText={payloadAct.prompt}
                                onAction={onCreationAction}
                                showSideEffects={false}
                                disabled={isRunning}
                              />
                            )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })}

            {/* 即時執行軌跡：只呈現安全的資料來源／工具步驟，不展示模型隱藏推理。 */}
            {thinking.active && (
              <div style={{ alignSelf: "flex-start", maxWidth: "90%" }} role="status">
                <div style={{ fontSize: "var(--fs-11)", color: "var(--fg-secondary)", marginBottom: 2 }}>助手</div>
                {activePlan ? (
                  <AgentRunCard plan={activePlan} active events={liveAgentEvents} />
                ) : null}
                {liveAgentEvents.length ? (
                  <AgentWorkPanel events={liveAgentEvents} live onCancel={cancelCurrent} />
                ) : (
                  <LiveAssistantTrace
                    events={thinking.events}
                    open={liveTraceOpen}
                    onToggle={() => setLiveTraceOpen((value) => !value)}
                    onCancel={cancelCurrent}
                  />
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}>
          <input
            aria-label="問 AI 專案助手"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => focusAndReveal(e.currentTarget)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
            placeholder="問進度、要 idea、貼腳本、下目標…例：把腳本拆成分鏡並逐鏡出圖"
            disabled={false}
            style={{ flex: 1 }}
          />
          <Button variant="primary" onClick={busy ? cancelCurrent : () => void send()} disabled={!busy && !input.trim()}>
            {busy ? <><Icon name="Square" size={12} /> 停止</> : "問"}
          </Button>
        </div>

        {canInspectAi ? <AiUnderstandingPanel
          projectId={projectId}
          preview={preview.data}
          previewPending={preview.isPending}
          previewError={preview.error?.message ?? (!input.trim() ? "請先輸入想問的內容。" : undefined)}
          onPreview={() => {
            if (!input.trim()) return;
            preview.mutate({
              projectId,
              message: input.trim(),
              // 預覽要跟「按下問之後真的會用的模型」一致——用規劃檔位的話，預覽出來的
              // 注入量與模型都不是待會兒實際跑的那個
              mode: answerMode,
              knowledgeIds: knowledgeIds?.length ? knowledgeIds : undefined,
            });
          }}
          traceSessionId={traceSessionId}
        /> : null}

        {/* 回答模型選擇：先前只有「確認 plan_agent 動作」時才選得到，一般問答沒得選。
         * 這裡把它提到輸入框旁邊，並且明講代價——NIM 走免費額度，fal 是平台實付 USD，
         * 使用者有權在按下「問」之前就知道這一次會不會花到基金會的錢。 */}
        <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, fontSize: "var(--fs-11)" }}>
            <Icon name="SlidersHorizontal" size={12} />
            回答模型
            <select
              aria-label="選擇回答這則提問的模型"
              value={answerMode}
              disabled={busy}
              onChange={(event) => {
                const mode = event.target.value as AgentPlannerMode;
                setAnswerMode(mode);
                writeAssistantAnswerMode(mode);
              }}
              style={{ fontSize: "var(--fs-12)", padding: "2px 6px", width: "auto" }}
            >
              {AGENT_PLANNER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.shortLabel}
                </option>
              ))}
            </select>
          </label>
          <Hint as="span">
            {answerMode === "nim"
              ? "NVIDIA NIM 免費額度，站內 0 點、平台 0 成本。"
              : answerMode === "auto"
                ? "先用免費的 NIM；它沒回應時才改用 fal.ai（那次平台會付費）。"
                : "走 fal.ai：站內仍是 0 點，但平台會實付 USD。專案內容也會傳給 fal.ai。"}
          </Hint>
        </div>
        {editingSheetOpen ? <EditingHandoffSheet
          open={editingSheetOpen}
          projectId={projectId}
          originConversationId={`project-${projectId}`}
          originSurface="project"
          onClose={() => setEditingSheetOpen(false)}
          onPrepared={(sessionId) => push({
            role: "ai",
            text: "✓ LumaFusion 剪輯工作階段已建立；你可以直接下載交接包，完成後也從這張卡回傳。",
            editingSessionId: sessionId,
          })}
        /> : null}
      </div>
    </>
  );

  if (embedded) return <div data-fb="AI 助手">{body}</div>;
  return (
    <Card as="section" data-fb="AI 助手" id="sec-assistant">
      {body}
    </Card>
  );
}
