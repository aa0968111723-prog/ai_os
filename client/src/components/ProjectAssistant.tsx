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
import { requestAssistantStream } from "./assistantStream";
import {
  AGENT_PLANNER_OPTIONS,
  getAgentPlannerOption,
  type AgentPlannerMode,
} from "../../../shared/agentPlanner";
import {
  readAgentPlannerMode,
  writeAgentPlannerMode,
} from "../lib/agentPlannerPreference";
import { Button, Card, Chip, Hint, Meta } from "./ui";
/** 助手提議的動作（與後端 assistant.ask 回傳對齊）：確認後原樣送 runAction 執行 */
type Action =
  // sceneNo/sceneTitle 只給前端顯示用（換模型後重建「為第 N 鏡「標題」」），toPayload 會丟掉
  | { type: "generate"; label: string; prompt: string; modelId: string; sceneId?: string; sceneNo?: number; sceneTitle?: string }
  | { type: "update_scene"; label: string; sceneId: string; field: "title" | "voiceover" | "durationSec"; value: string }
  | { type: "submit_approval"; label: string; sceneId: string }
  | { type: "create_scene"; label: string; title: string; voiceover?: string; durationSec?: number; prompt?: string }
  | { type: "run_workflow"; label: string; presetId: string; prompt: string }
  | { type: "split_script"; label: string; script: string }
  // plan_agent：把目標交給 AI 創作助手排計畫；plannerMode 由使用者在確認前選擇
  | { type: "plan_agent"; label: string; goal: string; plannerMode?: AgentPlannerMode };

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
  elapsedMs?: number;
  fallback?: boolean;
};

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
  if (a.type === "create_scene") return { type: "create_scene" as const, title: a.title, voiceover: a.voiceover, durationSec: a.durationSec, prompt: a.prompt };
  if (a.type === "run_workflow") return { type: "run_workflow" as const, presetId: a.presetId, prompt: a.prompt };
  if (a.type === "split_script") return { type: "split_script" as const, script: a.script };
  if (a.type === "plan_agent") {
    return { type: "plan_agent" as const, goal: a.goal, plannerMode: a.plannerMode };
  }
  return { type: "submit_approval" as const, sceneId: a.sceneId };
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
 * AI 專案助手（進階版）：問專案進度/生成/分鏡/審批，並可「提議」動作。
 * 安全：任何花點數或改資料的動作都用 ConfirmButton，使用者按確認才真的執行。
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
  askFillRequest?: { nonce: number; message: string } | null;
}) {
  const utils = trpc.useUtils();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [liveTraceOpen, setLiveTraceOpen] = useState(true);
  // 思考過程串流狀態：active＝正在問答中，events＝已收到的思考步驟（逐筆追加即時顯示）
  const [thinking, setThinking] = useState<{ active: boolean; events: ThinkEvent[] }>({ active: false, events: [] });
  const [fallbackPending, setFallbackPending] = useState(false);
  // 已執行的提議動作鍵（turnIndex:actionIndex）＋正在執行中的鍵——停用「已執行」的按鈕，避免重複點擊
  const [executed, setExecuted] = useState<Set<string>>(new Set());
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // 使用者在執行前自選的模型（動作鍵 → 模型 id）：只影響 generate 動作，覆蓋助手原提議的 modelId
  const [modelOverride, setModelOverride] = useState<Record<string, string>>({});
  // 代理規劃供應商／用量策略；保留使用者上次選擇，個別提議仍可覆蓋。
  const [defaultPlannerMode, setDefaultPlannerMode] = useState<AgentPlannerMode>(readAgentPlannerMode);
  const [plannerModeOverride, setPlannerModeOverride] = useState<Record<string, AgentPlannerMode>>({});
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

  // tRPC 一次性問答：串流不可用時的退路。每次呼叫使用帶 request epoch 的局部 callback，
  // mutation 本身不能取消時也能丟棄過期答案。
  const ask = trpc.assistant.ask.useMutation();

  const busy = thinking.active || fallbackPending;

  /** 串流問答：讀 SSE 逐筆更新思考過程，done 補上 AI 回覆。回傳 true＝已處理（含 error／主動中止），false＝請退回 tRPC。 */
  async function askViaStream(
    message: string,
    nonce: string,
    signal: AbortSignal,
    requestProjectId: string,
    epoch: number,
  ): Promise<boolean> {
    return requestAssistantStream({
      projectId: requestProjectId,
      message,
      nonce,
      // 使用者在代理卡選的模型檔位；預設 nim＝免費，選 fal 檔位平台才付費
      mode: defaultPlannerMode,
      signal,
      handlers: {
        onStep: (event) => {
          if (!requestIsCurrent(requestProjectId, epoch)) return;
          traceRef.current = [...traceRef.current, event];
          setThinking((state) => ({ active: true, events: [...state.events, event] }));
          bumpScroll();
        },
        onDone: (result) => {
          if (!requestIsCurrent(requestProjectId, epoch)) return;
          push({
            role: "ai",
            text: result.answer,
            actions: result.actions as Action[],
            steps: result.steps,
            activity: [...traceRef.current],
            elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
            fallback: result.fallback,
          });
        },
        onError: (message) => {
          if (!requestIsCurrent(requestProjectId, epoch)) return;
          push({
            role: "ai",
            text: message,
            activity: [...traceRef.current],
            elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
          });
        },
      },
    });
  }

  const send = async () => {
    const m = input.trim();
    if (!m || busy) return;
    abortRef.current?.abort(); // 保險：中止任何殘留串流（busy 守門通常已擋住並行）
    const requestProjectId = projectId;
    const epoch = ++requestEpochRef.current;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    traceRef.current = [];
    requestStartedAtRef.current = Date.now();
    setLiveTraceOpen(true);
    // 串流與退回 tRPC 共用的請求關聯鍵；伺服器仍會對每個外部呼叫各自計次。
    const nonce = (crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
    push({ role: "you", text: m });
    setInput("");
    setThinking({ active: true, events: [] });
    const handled = await askViaStream(m, nonce, ctrl.signal, requestProjectId, epoch);
    if (!requestIsCurrent(requestProjectId, epoch)) return;
    setThinking({ active: false, events: [] });
    // 主動中止不退回；串流沒完成才用一次性問答補上（帶同一 nonce 方便追蹤）。
    if (!handled && !ctrl.signal.aborted) {
      setFallbackPending(true);
      ask.mutate(
        { projectId: requestProjectId, message: m, nonce, mode: defaultPlannerMode },
        {
          onSuccess: (result) => {
            if (!requestIsCurrent(requestProjectId, epoch)) return;
            const fallbackActivity = result.steps.map((text) => ({ phase: "step" as const, text }));
            push({
              role: "ai",
              text: result.answer,
              actions: result.actions as Action[],
              steps: result.steps,
              activity: traceRef.current.length > 0 ? [...traceRef.current] : fallbackActivity,
              elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
              fallback: true,
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
    if (!thinking.active) return;
    abortRef.current?.abort();
    requestEpochRef.current += 1;
    setThinking({ active: false, events: [] });
    setFallbackPending(false);
    push({
      role: "ai",
      text: "已取消這次查詢；尚未執行任何需確認或扣點的動作。",
      activity: [...traceRef.current],
      elapsedMs: requestStartedAtRef.current ? Date.now() - requestStartedAtRef.current : undefined,
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
    abortRef.current?.abort();
    requestEpochRef.current += 1;
    projectGenerationRef.current += 1;
    setTurns([]);
    setThinking({ active: false, events: [] });
    setFallbackPending(false);
    setExecuted(new Set());
    setModelOverride({});
    setPlannerModeOverride({});
    setPendingKey(null);
    setInput("");
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
          一個對話統包：<b>問</b>（進度、還沒審的分鏡、該用哪個模型…，我會<b>邊想邊查</b>素材庫／分鏡／生成紀錄／模型目錄／<b>資料庫</b>，唯讀）、<b>發想</b>（要分鏡 idea 我直接給，並可一鍵存成草稿）、<b>拆分鏡</b>（貼腳本進來）、<b>下目標</b>（多步驟目標我會交給代理排計畫，你核准估點後由伺服器背景逐步執行）。任何花點數或改資料的動作都要你按確認；提問本身由 NVIDIA NIM 免費額度驅動，不扣點。
        </Hint>

        {/* 快速開場：問答／發想／下目標都從同一個入口——點一顆帶入輸入框，按「問」才送出 */}
        {turns.length === 0 && !thinking.active && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {[
              "這個專案進度到哪？",
              "給我 3 個分鏡 idea",
              "把知識庫的腳本拆成分鏡，並為每一鏡生成畫面",
              "幫我推薦適合本專案的生成模型",
            ].map((q) => (
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
                </div>
                {/* 回答完成後保留安全的活動軌跡，預設收合以免長對話把工作台撐爆。 */}
                {t.role === "ai" && (
                  <AssistantTrace
                    events={activity}
                    elapsedMs={t.elapsedMs}
                    fallback={t.fallback}
                  />
                )}
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
                      const confirmMsg =
                        payloadAct.type === "generate"
                          ? `執行「${gen ? genLabel(gen.action, gen.info) : payloadAct.label}」？${gen?.info ? "" : "（點數見上方說明）"}`
                          : payloadAct.type === "run_workflow"
                            ? `執行「${payloadAct.label}」？各步驟會分別扣點。`
                            : payloadAct.type === "split_script"
                              ? `執行「${payloadAct.label}」？會呼叫 AI 導演拆分鏡（免費）。`
                              : payloadAct.type === "plan_agent"
                                ? `把這個目標交給 AI 創作助手，並使用「${plannerOption.shortLabel}」？規劃不扣站內點數；fal.ai 模式依實際 token 計費。這一步只排計畫，你在「AI 執行計畫」核准後才會開始花執行點數。`
                                : `執行「${payloadAct.label}」？`;
                      return (
                        <div key={j} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
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
                                    {option.label} — {option.usageLabel}
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
                          <ConfirmButton
                            triggerClassName="btn-tonal btn-sm"
                            disabled={isDone || isRunning}
                            title={isDone ? "此動作已執行" : "確認執行助手提議的動作"}
                            message={confirmMsg}
                            confirmLabel="執行"
                            onConfirm={async () => {
                              const actionProjectId = projectId;
                              const actionProjectGeneration = projectGenerationRef.current;
                              const actionIsCurrent = () =>
                                activeProjectIdRef.current === actionProjectId
                                && projectGenerationRef.current === actionProjectGeneration;
                              setPendingKey(actKey);
                              try {
                                const result = await run.mutateAsync({
                                  projectId: actionProjectId,
                                  action: toPayload(payloadAct),
                                });
                                // 動作已在原專案執行；快取失效不依目前畫面，讓回到原專案時能取到新資料。
                                utils.generation.invalidate();
                                utils.scenes.invalidate();
                                utils.approvals.invalidate();
                                utils.quota.invalidate();
                                if (result.kind === "run_workflow") utils.workflows.invalidate();
                                if (result.kind === "plan_agent") utils.agents.invalidate();
                                if (!actionIsCurrent()) return;
                                push({ role: "ai", text: `✓ ${result.message}` });
                                setExecuted((prev) => new Set(prev).add(actKey));
                              } catch (error) {
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
                                  : payloadAct.type === "submit_approval" ? "Check"
                                    : payloadAct.type === "create_scene" ? "Plus"
                                      : payloadAct.type === "run_workflow" ? "Play"
                                        : payloadAct.type === "split_script" ? "Clapperboard"
                                          : payloadAct.type === "plan_agent" ? "Film"
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
                <LiveAssistantTrace
                  events={thinking.events}
                  open={liveTraceOpen}
                  onToggle={() => setLiveTraceOpen((value) => !value)}
                  onCancel={cancelCurrent}
                />
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}>
          <input
            aria-label="問 AI 專案助手"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void send(); } }}
            placeholder="問進度、要 idea、貼腳本、下目標…例：把腳本拆成分鏡並逐鏡出圖"
            disabled={busy}
            style={{ flex: 1 }}
          />
          <Button variant="primary" onClick={() => void send()} disabled={busy || !input.trim()}>
            {busy ? "思考中…" : "問"}
          </Button>
        </div>

        {/* 回答模型選擇：先前只有「確認 plan_agent 動作」時才選得到，一般問答沒得選。
         * 這裡把它提到輸入框旁邊，並且明講代價——NIM 走免費額度，fal 是平台實付 USD，
         * 使用者有權在按下「問」之前就知道這一次會不會花到基金會的錢。 */}
        <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: 0, fontSize: "var(--fs-11)" }}>
            <Icon name="SlidersHorizontal" size={12} />
            回答模型
            <select
              aria-label="選擇回答這則提問的模型"
              value={defaultPlannerMode}
              disabled={busy}
              onChange={(event) => {
                const mode = event.target.value as AgentPlannerMode;
                setDefaultPlannerMode(mode);
                writeAgentPlannerMode(mode);
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
          <Hint as="span" layer="always">
            {defaultPlannerMode === "nim"
              ? "NVIDIA NIM 免費額度，站內 0 點、平台 0 成本。"
              : defaultPlannerMode === "auto"
                ? "先用免費的 NIM；它沒回應時才改用 fal.ai（那次平台會付費）。"
                : "走 fal.ai：站內仍是 0 點，但平台會實付 USD。專案內容也會傳給 fal.ai。"}
          </Hint>
        </div>
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
