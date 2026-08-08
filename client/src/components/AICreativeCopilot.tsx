import { useState, useRef, useEffect, useMemo } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc, type AppRouter } from "../api";
import { setOrbState } from "../lib/orbState";
import { Icon, type IconName } from "./Icon";
import { Button, Card } from "./ui";
import { requestSiteAssistantStream } from "./assistantStream";
import { AssistantTrace, LiveAssistantTrace, type AssistantActivityEvent } from "./AssistantTrace";
import { AgentRunCard } from "./AgentRunCard";
import { useAssistantContext } from "../lib/assistantContext";
import { formatContextBreadcrumb, getAssistantQuickActions, toWirePageContext } from "../lib/assistantQuickActions";
import {
  classifyAssistantRequest,
  type AssistantExecutionPlan,
  type AssistantLatencyMetrics,
} from "@shared/assistantExecution";

type GlobalAskOutput = inferRouterOutputs<AppRouter>["globalAssistant"]["ask"];
type SiteAction = GlobalAskOutput["siteActions"][number];
type DispatchProposal = GlobalAskOutput["dispatches"][number];
type CommandProposal = GlobalAskOutput["actions"][number];
type ExecutedSiteAction = GlobalAskOutput["executedSiteActions"][number];

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  contextUsed?: string[];
  /** 需確認的站級動作（對外、較大範圍或未允許直寫） */
  siteActions?: SiteAction[];
  /** 派工提議（交給某專案的 AI 代理排計畫） */
  dispatches?: DispatchProposal[];
  /** 監督指令提議（核准／停止／重排／改派） */
  commands?: CommandProposal[];
  executedSiteActions?: ExecutedSiteAction[];
  executionPlan?: AssistantExecutionPlan;
  runStatus?: "completed" | "failed" | "stopped";
  latency?: AssistantLatencyMetrics;
  activity?: AssistantActivityEvent[];
  retryText?: string;
  suggestedActions?: Array<{ label: string; prompt: string }>;
}

/** 已解析動作 → runSiteAction 輸入（逐型別挑欄位；label 等顯示欄位不上送） */
export function toSiteActionInput(a: SiteAction) {
  switch (a.type) {
    case "create_project":
      return { type: a.type, groupId: a.groupId, title: a.title, kind: a.kind, platform: a.platform } as const;
    case "add_note":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, content: a.content } as const;
    case "add_schedule_item":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, note: a.note } as const;
    case "create_task":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, description: a.description, assigneeId: a.assigneeId, dueAt: a.dueAt, priority: a.priority } as const;
    case "send_dm":
      return { type: a.type, peerId: a.peerId, body: a.body } as const;
    case "add_database_row":
      return { type: a.type, tableId: a.tableId, data: a.data } as const;
  }
}

/** 完成後「前往看結果」的落點（沒有合適落點就不給連結） */
export function siteActionDoneLink(a: SiteAction, result: { type: string; projectId?: string }): { href: string; label: string } | null {
  if (a.type === "create_project" && result.projectId) return { href: `/p/${result.projectId}`, label: "前往專案" };
  if (a.type === "add_schedule_item" || a.type === "add_note") return { href: "/planner", label: "查看筆記排程" };
  if (a.type === "create_task") return { href: `/p/${a.projectId}`, label: "前往專案" };
  if (a.type === "send_dm") return { href: "/chat", label: "打開私訊" };
  if (a.type === "add_database_row") return { href: "/databases", label: "查看資料庫" };
  return null;
}

/**
 * 一張站級動作確認卡：提議 → 確認（以本人身分執行）／略過 → 完成或失敗。
 * 執行永遠是使用者按下那一刻的單發 mutation——AI 沒有任何路徑可以代按。
 */
function SiteActionCard({ action, onNavigate }: { action: SiteAction; onNavigate?: (href: string) => void }) {
  const run = trpc.globalAssistant.runSiteAction.useMutation();
  const [skipped, setSkipped] = useState(false);
  if (skipped) return null;

  if (run.isSuccess) {
    const link = siteActionDoneLink(action, run.data);
    return (
      <div className="ai-copilot-action-card is-done" data-fb="站級動作卡">
        <Icon name="Check" size={14} />
        <span className="ai-copilot-action-card__label">已完成：{action.label}</span>
        {link && onNavigate && (
          <Button variant="ghost" size="sm" onClick={() => onNavigate(link.href)}>{link.label}</Button>
        )}
      </div>
    );
  }
  // 以本人名義送出的內容必須全文可見再確認：label 只有摘要——私訊本文、筆記內容、
  // 資料列的每一欄值整段亮出來
  const fullText =
    action.type === "send_dm" ? action.body
    : action.type === "add_note" ? action.content
    : action.type === "add_database_row" ? action.preview
    : null;
  return (
    <div className="ai-copilot-action-card" data-fb="站級動作卡">
      <span className="ai-copilot-action-card__label">{action.label}</span>
      {fullText && <span className="ai-copilot-action-card__detail">{fullText}</span>}
      {run.error && <span className="ai-copilot-action-card__error">{run.error.message}</span>}
      <div className="ai-copilot-action-card__buttons">
        <Button
          size="sm"
          disabled={run.isPending}
          onClick={() => run.mutate(toSiteActionInput(action))}
        >
          {run.isPending ? "執行中…" : run.error ? "重試" : "確認執行"}
        </Button>
        <Button variant="ghost" size="sm" disabled={run.isPending} onClick={() => setSkipped(true)}>
          略過
        </Button>
      </div>
    </div>
  );
}

function undoSiteActionInput(item: ExecutedSiteAction) {
  if (item.result.type === "add_note") return { type: "add_note", id: item.result.noteId } as const;
  if (item.result.type === "add_schedule_item") return { type: "add_schedule_item", id: item.result.scheduleItemId } as const;
  if (item.result.type === "create_task") return { type: "create_task", id: item.result.taskId } as const;
  return null;
}

/** 模型明確 ACT 後已由後端完成的結果卡；Undo 仍重走原 core 權限守門。 */
function DirectActionResultCard({ item, onNavigate }: { item: ExecutedSiteAction; onNavigate?: (href: string) => void }) {
  const undo = trpc.globalAssistant.undoSiteAction.useMutation();
  const undoInput = undoSiteActionInput(item);
  const link = siteActionDoneLink(item.action, item.result);
  const verified = item.result.verification?.status !== "unverified";
  return (
    <div className="ai-copilot-action-card is-done" data-fb="直接執行結果卡">
      <Icon name={undo.isSuccess ? "Undo2" : verified ? "Check" : "TriangleAlert"} size={14} />
      <span className="ai-copilot-action-card__label">
        {undo.isSuccess
          ? `已撤銷：${item.action.label}`
          : verified
            ? `已完成：${item.action.label}（已驗證）`
            : `操作已送出，但驗證未通過：${item.action.label}`}
      </span>
      {undo.error ? <span className="ai-copilot-action-card__error">{undo.error.message}</span> : null}
      {!undo.isSuccess && link && onNavigate ? (
        <Button variant="ghost" size="sm" onClick={() => onNavigate(link.href)}>{link.label}</Button>
      ) : null}
      {!undo.isSuccess && undoInput ? (
        <Button variant="ghost" size="sm" disabled={undo.isPending} onClick={() => undo.mutate(undoInput)}>
          <Icon name="Undo2" size={12} /> {undo.isPending ? "撤銷中…" : "復原"}
        </Button>
      ) : null}
    </div>
  );
}

/** 派工確認卡：把目標交給某專案的 AI 代理排計畫（計畫仍需在該專案核准才會花點） */
function DispatchCard({ groupId, dispatch, onNavigate }: { groupId: string; dispatch: DispatchProposal; onNavigate?: (href: string) => void }) {
  const run = trpc.teamAssistant.dispatch.useMutation();
  const [skipped, setSkipped] = useState(false);
  if (skipped) return null;
  if (run.isSuccess) {
    return (
      <div className="ai-copilot-action-card is-done" data-fb="派工卡">
        <Icon name="Check" size={14} />
        <span className="ai-copilot-action-card__label">已建立待核准的代理計畫（估 {run.data.estPoints} 點）</span>
        {onNavigate && (
          <Button variant="ghost" size="sm" onClick={() => onNavigate(`/p/${dispatch.projectId}`)}>前往核准</Button>
        )}
      </div>
    );
  }
  return (
    <div className="ai-copilot-action-card" data-fb="派工卡">
      <span className="ai-copilot-action-card__label">{dispatch.label}</span>
      {run.error && <span className="ai-copilot-action-card__error">{run.error.message}</span>}
      <div className="ai-copilot-action-card__buttons">
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ groupId, projectId: dispatch.projectId, goal: dispatch.goal })}>
          {run.isPending ? "規劃中…" : run.error ? "重試" : "確認派工"}
        </Button>
        <Button variant="ghost" size="sm" disabled={run.isPending} onClick={() => setSkipped(true)}>略過</Button>
      </div>
    </div>
  );
}

/** 監督指令確認卡：核准／停止／放棄／重排子計畫、調整任務（權限在後端 runGroupCommand 內再驗一次） */
function CommandCard({ groupId, command }: { groupId: string; command: CommandProposal }) {
  const run = trpc.teamAssistant.command.useMutation();
  const [skipped, setSkipped] = useState(false);
  if (skipped) return null;
  if (run.isSuccess) {
    return (
      <div className="ai-copilot-action-card is-done" data-fb="指令卡">
        <Icon name="Check" size={14} />
        <span className="ai-copilot-action-card__label">已執行：{command.label}</span>
      </div>
    );
  }
  return (
    <div className="ai-copilot-action-card" data-fb="指令卡">
      <span className="ai-copilot-action-card__label">{command.label}</span>
      {command.reason && <span className="ai-copilot-action-card__reason">{command.reason}</span>}
      {run.error && <span className="ai-copilot-action-card__error">{run.error.message}</span>}
      <div className="ai-copilot-action-card__buttons">
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate({ groupId, command: command.command })}>
          {run.isPending ? "執行中…" : run.error ? "重試" : "確認"}
        </Button>
        <Button variant="ghost" size="sm" disabled={run.isPending} onClick={() => setSkipped(true)}>略過</Button>
      </div>
    </div>
  );
}

/**
 * WATCH foundation：開 sheet 還沒開口問之前，先把「需要你注意」遞過來。
 *
 * 全部重用既有唯讀查詢（groupInsights＝阻塞與逾期、agentOverview＝代理計畫動態），
 * 不新建掃描器、不加後端——這是 event-driven 的第一層：資料本來就在，缺的只是
 * 一個把它主動端到眼前的位置。全部健康時整塊不渲染（沒事就不要出聲）。
 */
function WatchDigest({ groupId, onNavigate }: { groupId: string; onNavigate?: (href: string) => void }) {
  const insights = trpc.teamAssistant.groupInsights.useQuery({ groupId });
  const overview = trpc.teamAssistant.agentOverview.useQuery({ groupId });
  const items: Array<{ key: string; text: string }> = [];
  const s = overview.data?.summary;
  if (s?.awaitingApproval) items.push({ key: "approve", text: `${s.awaitingApproval} 份代理計畫等你核准` });
  if (s?.failedRecent) items.push({ key: "failed", text: `近 7 天有 ${s.failedRecent} 份代理計畫失敗` });
  if (s?.waiting) items.push({ key: "waiting", text: `${s.waiting} 份代理計畫停在人類關卡等人` });
  const ins = insights.data;
  if (ins?.overdueTasks) items.push({ key: "overdue", text: `${ins.overdueTasks} 件人員任務已逾期` });
  for (const b of (ins?.blockers ?? []).filter((x) => x.severity === "critical").slice(0, 2)) {
    items.push({ key: `b:${b.label}`, text: b.label });
  }
  if (!items.length) return null;
  return (
    <div className="ai-copilot-watch" data-fb="需要你注意">
      <div className="ai-copilot-watch__title">
        <Icon name="Bell" size={13} />
        <span>需要你注意</span>
      </div>
      {items.slice(0, 5).map((item) => (
        <div key={item.key} className="ai-copilot-watch__row">{item.text}</div>
      ))}
      {onNavigate && (
        <Button variant="ghost" size="sm" onClick={() => onNavigate("/dashboard")}>
          去工作台處理
        </Button>
      )}
    </div>
  );
}

interface AICreativeCopilotProps {
  groupId?: string;
  /** 發問當下所在的專案頁（脈絡提示；只影響 trace 與伺服器端提示，不是授權） */
  projectId?: string;
  onUseIdeaForNewProject?: (ideaTitle: string) => void;
  /** 動作完成後「前往看結果」：由外殼決定怎麼導航（sheet 會先關閉自己再導） */
  onNavigate?: (href: string) => void;
}

export function AICreativeCopilot({ groupId, projectId, onUseIdeaForNewProject, onNavigate }: AICreativeCopilotProps) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // SSE 即時軌跡：這一題進行中的活動事件（thinking／lookup／step），答完清空
  const [liveEvents, setLiveEvents] = useState<AssistantActivityEvent[]>([]);
  // 軌跡預設收合：進行中的那一行摘要（正在查什麼）已經在氣泡上，
  // 展開的完整事件流是「想知道細節才點」的東西——預設展開會把回答推到看不見。
  const [liveOpen, setLiveOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [activePlan, setActivePlan] = useState<AssistantExecutionPlan | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const liveEventsRef = useRef<AssistantActivityEvent[]>([]);
  const stopRecordedRef = useRef(false);
  const activeGoalRef = useRef("");
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // 一次性 fallback：串流根本沒開始（舊代理、網路攔 SSE）才用；串流已吐過事件絕不重跑
  const ask = trpc.globalAssistant.ask.useMutation();
  /* 頁面感知：快捷動作、麵包屑與送給後端的 pageContext 都由這一份推導 */
  const pageCtx = useAssistantContext();
  const quickActions = useMemo(() => getAssistantQuickActions(pageCtx), [pageCtx]);
  const breadcrumb = formatContextBreadcrumb(pageCtx);
  const pending = streaming || ask.isPending;

  // 卸載（關 sheet／切 scope）時中止在途串流：後端收到 abort 會提早收工不白燒額度
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text || !groupId || pending) return;

    const newHistory = messages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLiveEvents([]);
    liveEventsRef.current = [];
    stopRecordedRef.current = false;
    activeGoalRef.current = text;
    const localPlan = classifyAssistantRequest(text);
    setActivePlan(localPlan);
    // 底部導覽那顆球與這張卡是同一個助手的兩個身體：卡片在思考時球也要跟著脈動，
    // 否則使用者把 sheet 滑下去之後，畫面上就沒有任何「它還在想」的線索。
    setOrbState("thinking");

    type AskData = {
      answer: string;
      steps: string[];
      contextUsed?: string[];
      siteActions: SiteAction[];
      dispatches: DispatchProposal[];
      actions: CommandProposal[];
      executedSiteActions?: ExecutedSiteAction[];
      executionPlan?: AssistantExecutionPlan;
      latency?: AssistantLatencyMetrics;
    };
    const applyDone = (data: AskData) => {
      setOrbState("speaking");
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: data.answer,
          steps: data.steps,
          contextUsed: data.contextUsed ?? undefined,
          siteActions: data.siteActions.length ? data.siteActions : undefined,
          dispatches: data.dispatches.length ? data.dispatches : undefined,
          commands: data.actions.length ? data.actions : undefined,
          executedSiteActions: data.executedSiteActions?.length ? data.executedSiteActions : undefined,
          executionPlan: data.executionPlan ?? localPlan,
          runStatus: "completed",
          latency: data.latency,
          activity: [...liveEventsRef.current],
          suggestedActions: localPlan.intent === "ASK" && localPlan.confidence === "medium" && text.length <= 6
            ? [
                { label: `建立${text}準備`, prompt: `幫我建立「${text}」準備筆記與待辦。` },
                { label: "查看目前資料", prompt: `請查看目前專案與「${text}」相關的資料。` },
              ]
            : undefined,
        },
      ]);
    };
    const applyError = (message: string) => {
      setOrbState("error");
      setMessages((prev) => [...prev, {
        role: "assistant",
        text: `⚠️ 執行中斷：${message}`,
        executionPlan: localPlan,
        runStatus: "failed",
        activity: [...liveEventsRef.current],
        retryText: text,
      }]);
    };

    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    try {
      const handled = await requestSiteAssistantStream({
        groupId,
        message: text,
        history: newHistory,
        projectId: pageCtx.projectId ?? projectId,
        pageContext: toWirePageContext(pageCtx),
        signal: controller.signal,
        handlers: {
          onOpen: (run) => setActivePlan(run.plan),
          onStep: (e) => {
            liveEventsRef.current = [...liveEventsRef.current, e];
            setLiveEvents([...liveEventsRef.current]);
          },
          // SSE payload 是 GlobalAskResult 的純 JSON（無 superjson）；guard 只驗協定形狀，
          // 欄位型別由 tRPC 推導型別收窄（同一個 router 的回傳值）
          onDone: (d) => applyDone(d as unknown as AskData),
          onError: applyError,
        },
      });
      if (!handled) {
        // 串流沒開始：走一次性 tRPC（同一個核心；只是看不到即時軌跡）
        await new Promise<void>((resolve) => {
          ask.mutate(
            {
              groupId, message: text, history: newHistory,
              projectId: pageCtx.projectId ?? projectId,
              pageContext: toWirePageContext(pageCtx),
            },
            {
              onSuccess: (data) => { applyDone(data); resolve(); },
              onError: (err) => { applyError(err.message); resolve(); },
            },
          );
        });
      }
    } finally {
      setStreaming(false);
      setLiveEvents([]);
      setActivePlan(null);
    }
  };

  const stopCurrent = () => {
    if (!pending || stopRecordedRef.current) return;
    stopRecordedRef.current = true;
    abortRef.current?.abort();
    setOrbState("idle");
    setMessages((prev) => [...prev, {
      role: "assistant",
      text: "已停止；未開始的步驟不會再執行。你可以按「繼續」用同一個目標重試。",
      executionPlan: activePlan ?? undefined,
      runStatus: "stopped",
      activity: [...liveEventsRef.current],
      retryText: activeGoalRef.current || undefined,
    }]);
  };

  useEffect(() => {
    if (messages.length > 0) {
      chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, pending]);

  /** 光暈的強弱只有兩檔：待命時緩慢呼吸，思考時整圈亮起來並加速。
   *  狀態掛在外層 shell 而不是卡片上——光暈是卡片外緣的東西，
   *  卡片本身 overflow: hidden（feed 要能圓角裁切），罩不住自己的外光。 */
  const aiState = pending ? "thinking" : "idle";

  return (
    <div className="ai-copilot-shell" data-ai-state={aiState}>
      {/* 環境光：兩層互相錯開飄移的彩色暈斑，模糊後從卡片四周溢出。
          aria-hidden：它純粹是氛圍，讀屏念出來只會變成噪音。 */}
      <span className="ai-copilot-halo" aria-hidden="true" />

      <Card className="ai-copilot-card" data-fb="AI 創作助理">
        {/* 標頭（名牌、待命點、一行說明、底部的免費宣告）整組移除：那些是說明文字，
            不是助手。畫面上只留「能按的東西」與四周的感知光，其餘交給光自己講。
            清空對話留著但收成圖示鍵——它是功能，不是文案。 */}
        {messages.length > 0 && (
          <div className="ai-copilot-toolbar">
            <button
              type="button"
              className="ai-copilot-clear"
              onClick={() => {
                setMessages([]);
                ask.reset();
              }}
              title="清空對話紀錄"
              aria-label="清空對話紀錄"
            >
              <Icon name="Trash2" size={14} />
            </button>
          </div>
        )}

        {/* 麵包屑：一行說清楚「我現在知道你在哪」。不顯示任何技術 id——
            使用者看不懂 uuid，而看得懂的那個名字（專案名、第 3 鏡）本來就都有。 */}
        {breadcrumb && (
          <div className="ai-copilot-crumb" data-fb="助手上下文">
            <Icon name="Compass" size={12} />
            <span>{breadcrumb}</span>
          </div>
        )}

        {/* ── WATCH：還沒開口之前，先把需要注意的事遞過來（對話開始後讓位給對話） ── */}
        {messages.length === 0 && groupId && <WatchDigest groupId={groupId} onNavigate={onNavigate} />}

        {/* ── 靈感快捷按鈕 ── */}
        {/* 快捷動作隨頁面／選取改變（getAssistantQuickActions）：在分鏡頁盯著第 3 鏡時，
            「爆款短片主題」是最不相關的一件事。最多 3 顆，手機一行放得下。 */}
        <div className="ai-copilot-prompts">
          {quickActions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="ai-copilot-prompt-pill"
              onClick={() => void handleSend(item.prompt)}
              disabled={pending || !groupId}
              title={item.prompt}
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* ── 對話紀錄區域 ── */}
        {messages.length > 0 && (
          <div className="ai-copilot-chat-feed">
            {messages.map((msg, index) => (
              <div key={index} className={`ai-copilot-bubble ai-copilot-bubble--${msg.role}`}>
                <div className="ai-copilot-bubble__avatar">
                  {msg.role === "user" ? (
                    <span>我</span>
                  ) : (
                    <Icon name="Sparkles" size={15} />
                  )}
                </div>
                <div className="ai-copilot-bubble__content">
                  {msg.role === "assistant" && msg.executionPlan ? (
                    <AgentRunCard
                      plan={msg.executionPlan}
                      active={false}
                      outcome={msg.runStatus}
                      eventCount={msg.steps?.length ?? 0}
                      hasToolActivity={(msg.steps?.length ?? 0) > 0}
                      latency={msg.latency}
                    />
                  ) : null}
                  {msg.role === "assistant" && msg.activity?.length ? (
                    <AssistantTrace events={msg.activity} elapsedMs={msg.latency?.totalMs} />
                  ) : null}
                  {msg.steps && msg.steps.length > 0 && (
                    <div className="ai-copilot-bubble__steps">
                      <Icon name="Search" size={11} />
                      <span>檢索了：{msg.steps.join("、")}</span>
                    </div>
                  )}
                  <div className="ai-copilot-bubble__text">{msg.text}</div>

                  {/* 安全直寫顯示結果卡；對外、付費與較大影響動作仍是確認卡。 */}
                  {(msg.siteActions?.length || msg.executedSiteActions?.length || msg.dispatches?.length || msg.commands?.length) ? (
                    <div className="ai-copilot-bubble__cards">
                      {msg.siteActions?.map((a, i) => (
                        <SiteActionCard key={`s${i}`} action={a} onNavigate={onNavigate} />
                      ))}
                      {msg.executedSiteActions?.map((item, i) => (
                        <DirectActionResultCard key={`x${i}`} item={item} onNavigate={onNavigate} />
                      ))}
                      {groupId && msg.dispatches?.map((d, i) => (
                        <DispatchCard key={`d${i}`} groupId={groupId} dispatch={d} onNavigate={onNavigate} />
                      ))}
                      {groupId && msg.commands?.map((c, i) => (
                        <CommandCard key={`c${i}`} groupId={groupId} command={c} />
                      ))}
                    </div>
                  ) : null}
                  {msg.retryText ? (
                    <div className="ai-copilot-bubble__actions">
                      <Button variant="ghost" size="sm" disabled={pending} onClick={() => void handleSend(msg.retryText)}>
                        <Icon name="Play" size={12} /> 繼續
                      </Button>
                    </div>
                  ) : null}
                  {msg.suggestedActions?.length ? (
                    <div className="ai-copilot-bubble__actions">
                      {msg.suggestedActions.map((suggestion) => (
                        <Button key={suggestion.label} variant="tonal" size="sm" disabled={pending} onClick={() => void handleSend(suggestion.prompt)}>
                          {suggestion.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}

                  {/* 如果是 AI 回覆，提供一鍵新專案的按鈕（帶靈感去建立表單；與 create_project
                      確認卡並存：卡是「AI 已擬好欄位」，這顆是「我自己去表單填」） */}
                  {msg.role === "assistant" && onUseIdeaForNewProject && !msg.siteActions?.some((a) => a.type === "create_project") && (
                    <div className="ai-copilot-bubble__actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          // 擷取第一句或主題作為專案名稱建議
                          const firstLine = msg.text.split("\n")[0].replace(/[#*「」]/g, "").trim();
                          onUseIdeaForNewProject(firstLine.slice(0, 30) || "新 AI 影音專案");
                        }}
                      >
                        <Icon name="Plus" size={13} style={{ marginRight: 4 }} />
                        以此靈感開新專案
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {pending && (
              <div className="ai-copilot-bubble ai-copilot-bubble--assistant is-thinking">
                <div className="ai-copilot-bubble__avatar">
                  <Icon name="Sparkles" size={15} />
                </div>
                <div className="ai-copilot-bubble__content">
                  {activePlan ? (
                    <AgentRunCard
                      plan={activePlan}
                      active
                      eventCount={liveEvents.length}
                      hasToolActivity={liveEvents.some((event) => event.phase === "lookup" || event.phase === "step")}
                    />
                  ) : null}
                  {/* 旋轉的 Loader 圖示換成三顆呼吸的光點：轉圈是「系統卡住」的語彙，
                      光點才是「正在想」。文字本身也跑一道光掃過去。 */}
                  <div className="ai-copilot-bubble__text ai-copilot-loading">
                    <span className="ai-copilot-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="ai-copilot-loading__label">
                      {liveEvents.length ? liveEvents[liveEvents.length - 1].text : "AI 正在構思企劃中…"}
                    </span>
                  </div>
                  {/* SSE 即時軌跡：查了什麼、查到什麼，當下就看得到（與專案助手同一個元件）。
                      只在串流路徑渲染——一次性 fallback 沒有事件流，畫空軌跡只是噪音。 */}
                  {streaming && (
                    <LiveAssistantTrace
                      events={liveEvents}
                      open={liveOpen}
                      onToggle={() => setLiveOpen((v) => !v)}
                      onCancel={stopCurrent}
                    />
                  )}
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>
        )}

        {/* ── 輸入工具列 ── */}
        <div className="ai-copilot-input-box">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            /* 兩句都刻意壓在一行內：textarea 是 rows=1、min-height 24px 且外框
               overflow: hidden，字一旦折行就是被硬裁掉半截（原本兩句都會）。
               「Enter 送出」移到送出鍵的 title，那裡本來就寫著同一件事。 */
            placeholder={
              messages.length > 0
                ? "接著追問…（Shift + Enter 換行）"
                : "輸入任何想發想的主題或分鏡疑問…"
            }
            rows={1}
            maxLength={500}
            disabled={!groupId}
            /* 可見標題全部拿掉之後，這是唯一的輸入口——placeholder 不是標籤
               （一打字就消失），讀屏需要一個穩定的名字。 */
            aria-label="向 AI 助手提問"
          />

          <button
            type="button"
            className="ai-copilot-send-btn"
            onClick={() => {
              if (pending) {
                stopCurrent();
              } else {
                void handleSend();
              }
            }}
            disabled={(!pending && !input.trim()) || !groupId}
            title={pending ? "停止" : "發送 (Enter)"}
          >
            {pending ? (
              <Icon name="Square" size={15} />
            ) : (
              <Icon name="Send" size={16} />
            )}
          </button>
        </div>

      </Card>
    </div>
  );
}
