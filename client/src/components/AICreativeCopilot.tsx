import { useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react";
import type { inferRouterOutputs } from "@trpc/server";
import { trpc, type AppRouter } from "../api";
import { setOrbState } from "../lib/orbState";
import { Icon, type IconName } from "./Icon";
import { Button, Card } from "./ui";
import { isRateLimitMessage, requestSiteAssistantStream } from "./assistantStream";
import { readAssistantAnswerMode } from "../lib/agentPlannerPreference";
import {
  classifyAssistantComputerIntent,
  formatComputerCapabilityAnswer,
  isRealBrowserReady,
} from "../lib/assistantComputerIntent";
import { type AssistantActivityEvent } from "./AssistantTrace";
import { AgentRunCard } from "./AgentRunCard";
import { AgentWorkPanel } from "./AgentWorkPanel";
import { AssistantCapabilityGuide } from "./AssistantCapabilityGuide";
import { useAssistantContext } from "../lib/assistantContext";
import { formatContextBreadcrumb, getAssistantQuickActions, toWirePageContext } from "../lib/assistantQuickActions";
import {
  classifyAssistantRequest,
  type AssistantExecutionPlan,
  type AssistantLatencyMetrics,
} from "@shared/assistantExecution";
import { isAgentEvent, type AgentEvent, type AgentSourceRecord } from "@shared/agentEvents";
import type { AssistantActiveGoal } from "@shared/assistantGoalFrame";
import type { AssistantActionResult } from "@shared/assistantActions";
import { interactionPickerMode, type AssistantInteractionRequest } from "@shared/assistantInteractions";
import {
  ExternalAssetIntake,
  type ExternalImportNotice,
  type ExternalIntakeOpenRequest,
} from "../features/external-intake/ExternalAssetIntake";
import { EditingHandoffSheet } from "../features/external-editing/EditingHandoffSheet";
import { EditingResultCard, EditingSessionCard } from "../features/external-editing/EditingSessionCard";
import { AssistantInteractionCard } from "./AssistantInteractionCard";
import { detectEditingHandoffRequest } from "../lib/externalEditingIntent";
import {
  abortAssistantRun,
  captureAssistantReturnContext,
  clearAssistantConversation,
  endAssistantRun,
  getAssistantConversation,
  isAssistantRunAttemptCurrent,
  rebindAssistantRunId,
  registerAssistantRunController,
  recordAssistantActionResults,
  setAssistantConversation,
  subscribeAssistantRun,
} from "../lib/assistantRunStore";

type GlobalAskOutput = inferRouterOutputs<AppRouter>["globalAssistant"]["ask"];
type SiteAction = GlobalAskOutput["siteActions"][number];
type DispatchProposal = GlobalAskOutput["dispatches"][number];
type CommandProposal = GlobalAskOutput["actions"][number];
type ExecutedSiteAction = GlobalAskOutput["executedSiteActions"][number];
type IntakeFallback = GlobalAskOutput["intakeFallbacks"][number];

export function detectDirectIntakeRequest(text: string): ExternalIntakeOpenRequest["mode"] | null {
  const wantsImport = /(匯入|帶進|帶入|加入|放進|上傳|import|attach|upload)/i.test(text);
  if (!wantsImport) return null;
  if (/(google\s*drive|雲端硬碟|雲端磁碟)/i.test(text)) return "drive";
  if (/(資料夾|文件夾|\bfolder\b)/i.test(text)) return "folder";
  if (/https?:\/\/[^\s]+/i.test(text)) return "url";
  if (/(檔案|檔案|文件|影片|圖片|照片|\bpdf\b|\bfile\b)/i.test(text)) return "files";
  return null;
}

export function assistantActionResultsFromExecuted(items: readonly ExecutedSiteAction[]): AssistantActionResult[] {
  const results: AssistantActionResult[] = [];
  for (const item of items) {
    const result = item.result;
    // Some executed UI actions (for example add_note) have their own result
    // card but are not typed referents. Only consume a verification contract
    // when the result kind participates in recent-reference memory.
    if (!("verification" in result) || result.verification.status !== "verified") continue;
    if (result.type === "import") results.push(result);
    else if (result.type === "create_project") results.push(result);
    else if (result.type === "create_task") {
      results.push({
        type: "create_task",
        taskIds: [result.taskId],
        count: 1,
        projectId: item.action.type === "create_task" ? item.action.projectId : "",
        verification: result.verification,
      });
    }
  }
  return results.filter((result) => result.type !== "create_task" || !!result.projectId);
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  steps?: string[];
  contextUsed?: string[];
  /** 這一輪真的發生過的事件與真的讀過的來源（伺服器權威版本） */
  events?: AgentEvent[];
  sources?: AgentSourceRecord[];
  runId?: string;
  /** 需確認的站級動作（對外、較大範圍或未允許直寫） */
  siteActions?: SiteAction[];
  /** 派工提議（交給某專案的 AI 代理排計畫） */
  dispatches?: DispatchProposal[];
  /** 監督指令提議（核准／停止／重排／改派） */
  commands?: CommandProposal[];
  executedSiteActions?: ExecutedSiteAction[];
  executionPlan?: AssistantExecutionPlan;
  runStatus?: "completed" | "failed" | "stopped" | "waiting";
  latency?: AssistantLatencyMetrics;
  activity?: AssistantActivityEvent[];
  retryText?: string;
  suggestedActions?: Array<{ label: string; prompt: string }>;
  editingSessionId?: string;
  editingResult?: { sessionId: string; assetId: string };
  intakeFallbacks?: IntakeFallback[];
  interactionRequest?: AssistantInteractionRequest;
  /** Explicitly derived from the user's originating ASK turn; never infer it from answer prose. */
  offerIdeaProject?: boolean;
}

/** Tiny picker answers such as "1" are continuation data, not creative topics. */
export function isMeaningfulIdeaSeed(value: string): boolean {
  const text = value.trim();
  if (text.length < 2 || text.length > 40) return false;
  if (/^(?:第)?[\d一二三四五六七八九十]+(?:個|項|筆)?$/u.test(text)) return false;
  if (/^(?:全部|都要|這個|那個|上一個|下一個|確認|取消|是|否)$/u.test(text)) return false;
  return /[\p{L}]/u.test(text);
}

export function shouldOfferIdeaProject(message: ChatMessage): boolean {
  return message.role === "assistant"
    && message.offerIdeaProject === true
    && message.runStatus === "completed"
    && message.executionPlan?.intent === "ASK"
    && !message.intakeFallbacks?.length
    && !message.siteActions?.length
    && !message.dispatches?.length
    && !message.commands?.length
    && !message.executedSiteActions?.length
    && isMeaningfulIdeaSeed(message.text.split("\n")[0] ?? "");
}

function IntakeFallbackCard({
  fallback,
  onChoose,
}: {
  fallback: IntakeFallback;
  onChoose: (projectId: string, mode: "files" | "drive") => void;
}) {
  return (
    <div className="ai-copilot-action-card" data-fb="來源替代方式">
      <span className="ai-copilot-action-card__label">Google Photos 需要原始媒體</span>
      <span className="ai-copilot-action-card__detail">{fallback.message}</span>
      <span className="ai-copilot-action-card__detail">目標專案：{fallback.projectTitle}</span>
      <div className="ai-copilot-action-card__buttons">
        <Button size="sm" onClick={() => onChoose(fallback.projectId, "files")}>選擇檔案</Button>
        <Button variant="tonal" size="sm" onClick={() => onChoose(fallback.projectId, "drive")}>Google Drive</Button>
        <Button variant="ghost" size="sm" onClick={() => onChoose(fallback.projectId, "files")}>下載後上傳</Button>
      </div>
    </div>
  );
}

function AssistantEditingSessionCard({
  projectId,
  sessionId,
  onReturned,
  onReview,
}: {
  projectId: string;
  sessionId: string;
  onReturned: (assetIds: string[]) => void;
  onReview: (assetId: string) => void;
}) {
  const query = trpc.externalEditing.list.useQuery({ projectId });
  const session = query.data?.find((candidate) => candidate.id === sessionId);
  if (!session) return query.isLoading ? <span className="ai-copilot-action-card__label">正在載入剪輯工作階段…</span> : null;
  return <EditingSessionCard session={session} onChanged={() => void query.refetch()} onResultReturned={onReturned} onReview={onReview} />;
}

/** 已解析動作 → runSiteAction 輸入（逐型別挑欄位；label 等顯示欄位不上送） */
export function toSiteActionInput(a: SiteAction) {
  switch (a.type) {
    case "create_project":
      return { type: a.type, groupId: a.groupId, title: a.title, kind: a.kind, platform: a.platform } as const;
    case "add_note":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, content: a.content } as const;
    case "save_decision":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title } as const;
    case "create_watch":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, kind: a.kind, label: a.watchLabel } as const;
    case "add_schedule_item":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, startsAt: a.startsAt, endsAt: a.endsAt, note: a.note } as const;
    case "create_task":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, title: a.title, description: a.description, assigneeId: a.assigneeId, dueAt: a.dueAt, priority: a.priority } as const;
    case "send_dm":
      return { type: a.type, peerId: a.peerId, body: a.body } as const;
    case "add_database_row":
      return { type: a.type, tableId: a.tableId, data: a.data } as const;
    case "import_url":
      return { type: a.type, groupId: a.groupId, projectId: a.projectId, url: a.url } as const;
  }
}

/** 完成後「前往看結果」的落點（沒有合適落點就不給連結） */
export function siteActionDoneLink(a: SiteAction, result: { type: string; projectId?: string }): { href: string; label: string } | null {
  if (a.type === "create_project" && result.projectId) return { href: `/p/${result.projectId}`, label: "前往專案" };
  if (a.type === "add_schedule_item" || a.type === "add_note") return { href: "/planner", label: "查看筆記排程" };
  if (a.type === "save_decision") return { href: `/p/${a.projectId}`, label: "查看專案決策" };
  if (a.type === "create_watch") return { href: `/p/${a.projectId}`, label: "查看專案" };
  if (a.type === "create_task") return { href: `/p/${a.projectId}`, label: "前往專案" };
  if (a.type === "send_dm") return { href: "/chat", label: "打開私訊" };
  if (a.type === "add_database_row") return { href: "/databases", label: "查看資料庫" };
  if (a.type === "import_url" && result.projectId) return { href: `/p/${result.projectId}#sec-assets`, label: "查看資料" };
  return null;
}

/**
 * 回答完成後的「接下來可以做什麼」——**只從真的讀過的來源長出來**。
 *
 * 回答結尾給一排按鈕很容易變成猜測（「打開分鏡」但這次根本沒讀分鏡）。
 * 這裡的規則是：有讀到那個來源，才給那顆按鈕；而且按下去是導航到那份**真實**資料。
 * 沒有來源就回空陣列，畫面上就不會出現這一排。
 */
export function followUpActionsFromSources(
  sources: readonly AgentSourceRecord[],
): Array<{ key: string; label: string; href: string }> {
  const out: Array<{ key: string; label: string; href: string }> = [];
  const seen = new Set<string>();
  const LABEL: Partial<Record<AgentSourceRecord["type"], string>> = {
    storyboard: "打開分鏡",
    database: "打開資料庫",
    task: "查看任務",
    project: "打開專案",
    asset: "查看素材",
    agent_run: "查看 AI 計畫",
    schedule: "查看行程",
  };
  for (const source of sources) {
    if (source.status !== "ok" || !source.href) continue;
    const label = LABEL[source.type];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push({ key: source.id, label, href: source.href });
    if (out.length >= 3) break; // 手機一行放得下三顆；再多就是選項牆
  }
  return out;
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
    const verified = run.data.verification?.status !== "unverified";
    return (
      <div className="ai-copilot-action-card is-done" data-fb="站級動作卡">
        <Icon name={verified ? "Check" : "TriangleAlert"} size={14} />
        <span className="ai-copilot-action-card__label">
          {verified ? `已完成：${action.label}` : `操作已送出，但驗證未通過：${action.label}`}
        </span>
        {link && onNavigate && verified && (
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
  if (item.result.type === "save_decision") return { type: "save_decision", id: item.result.decisionId } as const;
  if (item.result.type === "create_watch") return { type: "create_watch", id: item.result.watchId } as const;
  if (item.result.type === "add_schedule_item") return { type: "add_schedule_item", id: item.result.scheduleItemId } as const;
  if (item.result.type === "create_task") return { type: "create_task", id: item.result.taskId } as const;
  return null;
}

/** 模型明確 DIRECT 後已由後端完成的結果卡；Undo 仍重走原 core 權限守門。 */
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
          : item.result.type === "import" && verified
            ? `已加入 ${item.result.count || item.result.duplicateCount} 項資料；AI 正在背景整理`
          : verified
            ? `已完成：${item.action.label}（已驗證）`
            : `操作已送出，但驗證未通過：${item.action.label}`}
      </span>
      {undo.error ? <span className="ai-copilot-action-card__error">{undo.error.message}</span> : null}
      {!undo.isSuccess && link && onNavigate ? (
        <Button variant="ghost" size="sm" onClick={() => onNavigate(link.href)}>{link.label}</Button>
      ) : null}
      {!undo.isSuccess && item.canUndo && undoInput ? (
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
  const [intakeOpenRequest, setIntakeOpenRequest] = useState<ExternalIntakeOpenRequest>();
  const [intakeTargetProjectId, setIntakeTargetProjectId] = useState<string>();
  const [editingSheetOpen, setEditingSheetOpen] = useState(false);
  /**
   * 對話與進行中的執行**不放在元件 state**：這張卡活在會被卸載的面板裡（關面板、
   * 切視野、換頁都會卸載），放 state 等於使用者一關面板就把剛剛的執行紀錄丟掉。
   * 改由模組級 store 持有（lib/assistantRunStore），元件只是它的檢視。
   */
  const conversation = useSyncExternalStore(
    subscribeAssistantRun,
    () => getAssistantConversation<ChatMessage>(groupId),
    () => getAssistantConversation<ChatMessage>(groupId),
  );
  const messages = conversation.messages;
  const liveRun = conversation.run;
  const [activePlan, setActivePlan] = useState<AssistantExecutionPlan | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const liveEventsRef = useRef<AssistantActivityEvent[]>([]);
  const eventFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRecordedRef = useRef(false);
  const activeGoalRef = useRef("");
  const queuedMessageRef = useRef<string | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  /* 自動捲到底部的守門員：使用者在 feed 上捲過（讀舊訊息）就停止自動捲動，
     不要在新訊息進場時把他硬拉回底部——那是最容易棄用助手的手感之一。 */
  const chatFeedRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const restoredPickerRef = useRef<string | undefined>(undefined);
  const presentedInteractionIdsRef = useRef(new Set<string>());
  const openedInteractionIdsRef = useRef(new Set<string>());

  const pushMessage = (message: ChatMessage) => {
    if (!groupId) return;
    setAssistantConversation<ChatMessage>(groupId, (previous) => ({
      ...previous,
      messages: [...previous.messages, message],
    }));
  };

  // 一次性 fallback：串流根本沒開始（舊代理、網路攔 SSE）才用；串流已吐過事件絕不重跑
  const ask = trpc.globalAssistant.ask.useMutation();
  const submitInteraction = trpc.globalAssistant.submitInteraction.useMutation();
  const interactionLifecycle = trpc.globalAssistant.interactionLifecycle.useMutation();
  // Capability probing is data, not LLM opinion: never ask a model whether the product can browse.
  const computerStatus = trpc.computerRuntime.status.useQuery(undefined, { staleTime: 30_000, retry: false });
  const createBrowserSession = trpc.computerRuntime.createSession.useMutation();
  /* 頁面感知：快捷動作、麵包屑與送給後端的 pageContext 都由這一份推導 */
  const pageCtx = useAssistantContext();
  const durableConversation = trpc.globalAssistant.conversationState.useQuery(
    { groupId: groupId ?? "00000000-0000-0000-0000-000000000000" },
    { enabled: !!groupId && messages.length === 0, retry: false, staleTime: 30_000 },
  );
  const activeProjectId = pageCtx.projectId ?? projectId;
  const intakeProjectId = intakeTargetProjectId ?? activeProjectId;
  const quickActions = useMemo(() => getAssistantQuickActions(pageCtx), [pageCtx]);
  const breadcrumb = formatContextBreadcrumb(pageCtx);
  // 進行中的判定來自 store（跨卸載存活）與這一顆元件自己的 tRPC fallback
  const pending = (liveRun?.active ?? false) || ask.isPending;

  useEffect(() => {
    const recovered = durableConversation.data;
    if (!groupId || !recovered) return;
    setAssistantConversation<ChatMessage>(groupId, (previous) => {
      if (previous.messages.length) return previous;
      const runStatus: ChatMessage["runStatus"] = recovered.status === "completed"
        ? "completed"
        : recovered.status === "stopped"
          ? "stopped"
          : recovered.status === "failed"
            ? "failed"
            : "waiting";
      const recoveredMessages: ChatMessage[] = recovered.messages.map((message, index) => ({
        ...message,
        ...(message.role === "assistant" && index === recovered.messages.length - 1
          ? { runStatus, interactionRequest: recovered.activeGoal?.pendingInteraction }
          : {}),
      }));
      return {
        ...previous,
        messages: recoveredMessages,
        activeGoal: recovered.activeGoal ?? undefined,
        pendingInteraction: recovered.activeGoal?.pendingInteraction,
        recentActionResults: recovered.recentActionResults,
        run: recovered.runId ? {
          runId: recovered.runId,
          events: recovered.events,
          sources: recovered.sources,
          // Network requests are not replayed on refresh. Durable agent runs
          // resume through their server controller; this view remains honest.
          active: false,
          startedAt: new Date(recovered.updatedAt).getTime(),
        } : null,
      };
    });
    captureAssistantReturnContext({
      groupId,
      conversationId: recovered.conversationId,
      projectId: recovered.projectId ?? undefined,
      runId: recovered.runId ?? undefined,
      originRoute: pageCtx.route,
      originScrollY: typeof window === "undefined" ? undefined : window.scrollY,
      focusAnchor: pageCtx.entityId,
    });
  }, [durableConversation.data, groupId, pageCtx.entityId, pageCtx.route]);

  const recordInteractionLifecycle = (
    request: AssistantInteractionRequest,
    event: "presented" | "opened" | "cancelled",
  ) => {
    if (!groupId || !conversation.returnContext?.conversationId) return;
    void interactionLifecycle.mutateAsync({
      groupId,
      conversationId: conversation.returnContext.conversationId,
      runId: request.runId,
      goalId: request.goalId,
      interactionId: request.interactionId,
      resumeToken: request.resumeToken,
      event,
    }).catch(() => { /* lifecycle telemetry must not block the picker */ });
  };

  const openPickerForInteraction = (request: AssistantInteractionRequest | undefined) => {
    const mode = request ? interactionPickerMode(request.type) : undefined;
    if (!mode || !request?.targetProjectId) return;
    setIntakeTargetProjectId(request.targetProjectId);
    setIntakeOpenRequest({ id: request.interactionId, mode });
    if (!openedInteractionIdsRef.current.has(request.interactionId)) {
      openedInteractionIdsRef.current.add(request.interactionId);
      recordInteractionLifecycle(request, "opened");
    }
  };

  const applyInteractionResponse = (data: Awaited<ReturnType<typeof submitInteraction.mutateAsync>>) => {
    if (!groupId) return;
    setAssistantConversation<ChatMessage>(groupId, (previous) => ({
      ...previous,
      activeGoal: data.activeGoal,
      pendingInteraction: data.nextInteraction,
      recentActionResults: data.actionResult
        ? [...(previous.recentActionResults ?? []), data.actionResult].slice(-5)
        : previous.recentActionResults,
      run: previous.run && previous.run.runId === data.runId
        ? { ...previous.run, events: [...previous.run.events, ...data.events], active: false }
        : previous.run,
    }));
    if (data.nextInteraction) {
      pushMessage({ role: "assistant", text: data.answer, runStatus: "waiting", interactionRequest: data.nextInteraction, runId: data.runId });
      openPickerForInteraction(data.nextInteraction);
    } else {
      pushMessage({
        role: "assistant",
        text: data.answer,
        runStatus: data.activeGoal.status === "completed" ? "completed" : data.activeGoal.status === "failed" ? "failed" : "waiting",
        runId: data.runId,
        events: data.events,
      });
    }
  };

  const submitInteractionSelection = async (request: AssistantInteractionRequest, selectedIds: string[]) => {
    if (!groupId || !conversation.returnContext?.conversationId) return;
    try {
      applyInteractionResponse(await submitInteraction.mutateAsync({
        groupId,
        conversationId: conversation.returnContext.conversationId,
        runId: request.runId,
        goalId: request.goalId,
        interactionId: request.interactionId,
        resumeToken: request.resumeToken,
        selectedIds,
      }));
    } catch (error) {
      pushMessage({ role: "assistant", text: `這個選擇已失效或無法使用：${error instanceof Error ? error.message : "請重新開啟"}`, runStatus: "waiting" });
    }
  };

  const submitInteractionImport = async (request: AssistantInteractionRequest, notice: ExternalImportNotice) => {
    if (!groupId || !conversation.returnContext?.conversationId) return;
    try {
      applyInteractionResponse(await submitInteraction.mutateAsync({
        groupId,
        conversationId: conversation.returnContext.conversationId,
        runId: request.runId,
        goalId: request.goalId,
        interactionId: request.interactionId,
        resumeToken: request.resumeToken,
        importResult: notice,
      }));
    } catch (error) {
      pushMessage({ role: "assistant", text: `資料已保存，但無法接回原本工作：${error instanceof Error ? error.message : "請重新開啟"}`, runStatus: "waiting" });
    }
  };

  useEffect(() => {
    const request = conversation.pendingInteraction;
    if (!request || restoredPickerRef.current === request.interactionId) return;
    restoredPickerRef.current = request.interactionId;
    openPickerForInteraction(request);
  }, [conversation.pendingInteraction?.interactionId]);

  /**
   * 卸載時**不再**中止串流。
   *
   * 舊行為是「關掉面板＝abort」——但使用者關面板去看一眼專案再回來，是最自然的操作，
   * 而那會把已經跑到一半（可能已經寫入資料）的執行砍掉，回來後什麼都不剩。
   * 現在執行的擁有者是模組級 store，不是這個元件；要停止有明確的「停止」鍵。
   * 分頁真的關閉時瀏覽器會斷連，伺服器端照舊收到 abort，不會白燒額度。
   */

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend ?? input).trim();
    if (!text || !groupId) return;
    if (pending) {
      // The completion bubble can render a fraction before the run finalizer
      // releases its exact attempt. Never silently drop an Enter in that
      // window; keep one bounded next turn and send it after finalization.
      queuedMessageRef.current = text.slice(0, 500);
      setInput("");
      return;
    }

    const localPlan = classifyAssistantRequest(text);
    const computerIntent = classifyAssistantComputerIntent(text);
    if (computerIntent) {
      setInput("");
      const runtime = computerStatus.data ?? (await computerStatus.refetch()).data;
      const capabilityAnswer = formatComputerCapabilityAnswer(runtime);

      // Capability questions are answered from the actual runtime flags/provider, never model memory.
      if (computerIntent === "capability") {
        setAssistantConversation<ChatMessage>(groupId, (previous) => ({
          ...previous,
          messages: [
            ...previous.messages,
            { role: "user", text },
            {
              role: "assistant",
              text: capabilityAnswer,
              executionPlan: localPlan,
              runStatus: "completed",
              suggestedActions: isRealBrowserReady(runtime)
                ? [{ label: "開啟瀏覽器", prompt: "幫我在目前專案開啟瀏覽器。" }]
                : undefined,
            },
          ],
        }));
        return;
      }

      // Never fake browser work. A real external provider must be reported ready by the server first.
      if (!isRealBrowserReady(runtime)) {
        setAssistantConversation<ChatMessage>(groupId, (previous) => ({
          ...previous,
          messages: [
            ...previous.messages,
            { role: "user", text },
            {
              role: "assistant",
              text: `${capabilityAnswer}\n\n所以這次我沒有假裝開啟瀏覽器；等真實 Browser provider 接通後再執行。`,
              executionPlan: localPlan,
              runStatus: "waiting",
            },
          ],
        }));
        return;
      }

      if (!activeProjectId) {
        setAssistantConversation<ChatMessage>(groupId, (previous) => ({
          ...previous,
          messages: [
            ...previous.messages,
            { role: "user", text },
            {
              role: "assistant",
              text: "要啟動隔離瀏覽器，需要先指定工作專案。請打開或告訴我是哪個專案，我會接著做。",
              executionPlan: localPlan,
              runStatus: "waiting",
            },
          ],
        }));
        return;
      }

      const startUrl = text.match(/https?:\/\/[^\s<>{}\[\]"']+/i)?.[0];
      try {
        const session = await createBrowserSession.mutateAsync({
          projectId: activeProjectId,
          startUrl,
          label: `Aios：${text.slice(0, 100)}`,
        });
        setAssistantConversation<ChatMessage>(groupId, (previous) => ({
          ...previous,
          messages: [
            ...previous.messages,
            { role: "user", text },
            {
              role: "assistant",
              text: `已驗證啟動隔離 Browser Runtime${session.currentUrl ? `，目前網址：${session.currentUrl}` : ""}。`,
              executionPlan: localPlan,
              runStatus: "completed",
            },
          ],
        }));
      } catch (error) {
        setAssistantConversation<ChatMessage>(groupId, (previous) => ({
          ...previous,
          messages: [
            ...previous.messages,
            { role: "user", text },
            {
              role: "assistant",
              text: `瀏覽器沒有啟動成功：${error instanceof Error ? error.message : "執行失敗"}`,
              executionPlan: localPlan,
              runStatus: "failed",
            },
          ],
        }));
      }
      return;
    }

    const directIntakeMode = activeProjectId ? detectDirectIntakeRequest(text) : null;
    if (activeProjectId && detectEditingHandoffRequest(text)) {
      setInput("");
      captureAssistantReturnContext({
        groupId,
        projectId: activeProjectId,
        originRoute: pageCtx.route,
        originScrollY: typeof window === "undefined" ? undefined : window.scrollY,
        focusAnchor: pageCtx.entityId,
      });
      setAssistantConversation<ChatMessage>(groupId, (previous) => ({
        ...previous,
        messages: [
          ...previous.messages,
          { role: "user", text },
          { role: "assistant", text: "我會在這個對話裡準備正式的 LumaFusion 交接。請先確認範圍與主要素材；建立後工作階段會保留在這裡。", runStatus: "waiting" },
        ],
      }));
      setEditingSheetOpen(true);
      return;
    }
    // File/Drive selection is a mini workspace, not an LLM attachment. Opening
    // it is safe and synchronous; persistence/ACL/dedupe still happen in the
    // existing Universal Intake service after the user chooses a source.
    if (activeProjectId && (directIntakeMode === "drive" || directIntakeMode === "files" || directIntakeMode === "folder")) {
      setInput("");
      captureAssistantReturnContext({
        groupId,
        projectId: activeProjectId,
        originRoute: pageCtx.route,
        originScrollY: typeof window === "undefined" ? undefined : window.scrollY,
        focusAnchor: pageCtx.entityId,
      });
      setAssistantConversation<ChatMessage>(groupId, (previous) => ({
        ...previous,
        messages: [
          ...previous.messages,
          { role: "user", text },
          {
            role: "assistant",
            text: directIntakeMode === "drive"
              ? "請在這裡選擇要帶入的 Google Drive 檔案；完成後我會在同一個對話繼續。"
              : directIntakeMode === "folder"
                ? "請選擇要匯入的資料夾。Aios 會沿用 Folder Import 2.0 建立 session，檔案安全保存後即可繼續對話。"
              : "Aios 需要檔案才能繼續。選擇後會先安全保存，AI 分析會在背景執行。",
            runStatus: "waiting",
          },
        ],
      }));
      setIntakeOpenRequest({ id: `${Date.now()}`, mode: directIntakeMode });
      return;
    }

    const newHistory = messages.slice(-6).map((m) => ({ role: m.role, text: m.text }));
    liveEventsRef.current = [];
    stopRecordedRef.current = false;
    activeGoalRef.current = text;
    // 使用者自己送出訊息＝表達「我想看接下來的回覆」，無論先前有沒有捲上去讀舊文
    stickToBottomRef.current = true;
    setInput("");
    setActivePlan(localPlan);
    const returnContext = captureAssistantReturnContext({
      groupId,
      projectId: pageCtx.projectId ?? projectId,
      originRoute: pageCtx.route,
      originScrollY: typeof window === "undefined" ? undefined : window.scrollY,
      focusAnchor: pageCtx.entityId,
    });
    const controller = new AbortController();
    abortRef.current = controller;
    // 把手也登記到 store：關掉面板再打開時元件是新的一份，ref 會是空的，
    // 「停止」鍵就會變成一顆按下去毫無作用的按鈕。generation 用來擋 stale finalizer。
    const clientRunId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `assistant-run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const runAttempt = registerAssistantRunController(groupId, clientRunId, controller);
    const runGeneration = runAttempt.generation;
    let activeRunId = clientRunId;
    const runStillCurrent = () => isAssistantRunAttemptCurrent(runAttempt.attemptId, activeRunId);

    // 送出當下就把 run 開起來：它活在 store 裡，關掉面板再回來仍看得到目前進度。
    setAssistantConversation<ChatMessage>(groupId, (previous) => ({
      ...previous,
      messages: [...previous.messages, { role: "user", text }],
      run: {
        runId: clientRunId,
        events: [],
        sources: [],
        active: true,
        startedAt: Date.now(),
        generation: runGeneration,
        attemptId: runAttempt.attemptId,
      },
    }));
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
      runId?: string;
      events?: AgentEvent[];
      sources?: AgentSourceRecord[];
      intakeFallbacks?: IntakeFallback[];
      activeGoal?: AssistantActiveGoal;
      intakeRequest?: { mode: "drive" | "files" | "folder"; projectId: string; projectTitle: string; message: string };
      interactionRequest?: AssistantInteractionRequest;
    };
    const applyDone = (data: AskData) => {
      if (!runStillCurrent()) return;
      if (eventFlushTimerRef.current) clearTimeout(eventFlushTimerRef.current);
      eventFlushTimerRef.current = null;
      setOrbState("speaking");
      // 事件與來源一律以伺服器的最終版本為準；串流中途掉封包或整條退回 tRPC 時，
      // 前端累積的即時事件會不完整，而軌跡不能因為傳輸方式而有兩套內容。
      const events = data.events ?? liveEventsRef.current.filter(isAgentEvent);
      // A durable file/Drive/folder question is already rendered as the
      // assistant answer plus the mini workspace. Repeating waiting.user_input
      // as a work-step card made the same prompt appear twice on mobile.
      const visibleEvents = data.interactionRequest || data.intakeRequest
        ? events.filter((event) => event.type !== "waiting.user_input")
        : events;
      const sources = data.sources ?? [];
      const actionResults = assistantActionResultsFromExecuted(data.executedSiteActions ?? []);
      recordAssistantActionResults(groupId, actionResults);
      const hasFailure = events.some((event) => event.type === "agent.failed" && event.status === "failed");
      const hasWaiting = !!data.intakeFallbacks?.length
        || !!data.interactionRequest
        || !!data.intakeRequest
        || data.siteActions.length > 0
        || data.dispatches.length > 0
        || data.actions.length > 0
        || events.some((event) => (event.type === "waiting.permission" || event.type === "waiting.user_input") && event.status === "waiting");
      const hasVerifiedCompletion = events.some((event) => event.type === "agent.completed" && event.status === "ok");
      const hasVerifiedWrites = (data.executedSiteActions ?? []).some(
        (item) => "verification" in item.result && item.result.verification?.status === "verified",
      );
      const hasUnverifiedWrites = (data.executedSiteActions ?? []).some(
        (item) => "verification" in item.result && item.result.verification?.status !== "verified",
      );
      // Waiting / pending confirmation never completes. Pure answers and verified
      // writes complete. Missing agent.completed alone is not enough to force
      // "waiting" — the server may finish a read path with only tool events.
      const resolvedRunStatus: ChatMessage["runStatus"] = hasFailure || hasUnverifiedWrites
        ? "failed"
        : hasWaiting
          ? "waiting"
          : hasVerifiedCompletion || hasVerifiedWrites || !hasWaiting
            ? "completed"
            : "waiting";
      if (data.activeGoal) {
        const status: AssistantActiveGoal["status"] = resolvedRunStatus === "completed"
          ? "completed"
          : resolvedRunStatus === "failed"
            ? "failed"
            : data.activeGoal.status === "waiting_confirmation"
              ? "waiting_confirmation"
              : "waiting_user_input";
        setAssistantConversation<ChatMessage>(groupId, (previous) => ({
          ...previous,
          activeGoal: { ...data.activeGoal!, status },
          pendingInteraction: data.interactionRequest ?? data.activeGoal!.pendingInteraction,
        }));
      } else if (data.interactionRequest) {
        setAssistantConversation<ChatMessage>(groupId, (previous) => ({
          ...previous,
          pendingInteraction: data.interactionRequest,
        }));
      }
      if (data.interactionRequest) {
        openPickerForInteraction(data.interactionRequest);
      } else if (data.intakeRequest) {
        setIntakeTargetProjectId(data.intakeRequest.projectId);
        setIntakeOpenRequest({ id: `${Date.now()}`, mode: data.intakeRequest.mode });
      }
      pushMessage({
        role: "assistant",
        text: data.answer,
        steps: data.steps,
        contextUsed: data.contextUsed ?? undefined,
        siteActions: data.siteActions.length ? data.siteActions : undefined,
        dispatches: data.dispatches.length ? data.dispatches : undefined,
        commands: data.actions.length ? data.actions : undefined,
        executedSiteActions: data.executedSiteActions?.length ? data.executedSiteActions : undefined,
        // Source-transfer fallbacks are waiting for a real user choice; do not
        // render them as a completed execution card.
        executionPlan: data.intakeFallbacks?.length || data.intakeRequest ? undefined : (data.executionPlan ?? localPlan),
        runStatus: resolvedRunStatus,
        latency: data.latency,
        activity: [...liveEventsRef.current],
        runId: data.runId,
        events: visibleEvents.length ? visibleEvents : undefined,
        sources: sources.length ? sources : undefined,
        intakeFallbacks: data.intakeFallbacks?.length ? data.intakeFallbacks : undefined,
        interactionRequest: data.interactionRequest,
        offerIdeaProject: !data.intakeRequest
          && !data.intakeFallbacks?.length
          && !data.interactionRequest
          && resolvedRunStatus === "completed"
          && localPlan.intent === "ASK"
          && isMeaningfulIdeaSeed(text),
        suggestedActions: !data.intakeRequest
          && !data.intakeFallbacks?.length
          && !data.interactionRequest
          && localPlan.intent === "ASK"
          && localPlan.confidence === "medium"
          && isMeaningfulIdeaSeed(text)
          ? [
              { label: `建立${text}準備`, prompt: `幫我建立「${text}」準備筆記與待辦。` },
              { label: "查看目前資料", prompt: `請查看目前專案與「${text}」相關的資料。` },
            ]
          : undefined,
      });
    };
    const applyError = (message: string) => {
      if (!runStillCurrent()) return;
      if (eventFlushTimerRef.current) clearTimeout(eventFlushTimerRef.current);
      eventFlushTimerRef.current = null;
      setOrbState("error");
      // 限流拒絕不是「執行中斷」：請求在開始執行前就被後端擋下（SSE error 事件，
      // 非 HTTP 429），「執行中斷」是誤導措辭。用明確的限流提示，且不給重送鈕——
      // 使用者立刻重送只會再吃一次限流。
      const rateLimited = isRateLimitMessage(message);
      pushMessage({
        role: "assistant",
        text: rateLimited
          ? `⚠️ ${message}（問得太頻繁，每分鐘最多 6 次，稍等片刻再試）`
          : `⚠️ 執行中斷：${message}`,
        executionPlan: localPlan,
        runStatus: "failed",
        activity: [...liveEventsRef.current],
        // 失敗也要留下已經跑過的事件：使用者最需要知道的正是「卡在哪一步」
        events: liveEventsRef.current.filter(isAgentEvent),
        retryText: rateLimited ? undefined : text,
      });
    };

    // Same UUID on SSE and tRPC fallback so dual-transport cannot double-execute.
    const requestId = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
    try {
      const handled = await requestSiteAssistantStream({
        groupId,
        conversationId: returnContext.conversationId,
        message: text,
        history: newHistory,
        projectId: pageCtx.projectId ?? projectId,
        pageContext: toWirePageContext(pageCtx),
        recentActionResults: conversation.recentActionResults,
        activeGoal: conversation.activeGoal,
        mode: readAssistantAnswerMode(),
        requestId,
        signal: controller.signal,
        handlers: {
          onOpen: (run) => {
            if (!runStillCurrent()) return;
            if (!rebindAssistantRunId(runAttempt.attemptId, run.runId)) return;
            activeRunId = run.runId;
            setActivePlan(run.plan);
            captureAssistantReturnContext({
              groupId,
              projectId: pageCtx.projectId ?? projectId,
              runId: run.runId,
              originRoute: pageCtx.route,
              originScrollY: typeof window === "undefined" ? undefined : window.scrollY,
              focusAnchor: pageCtx.entityId,
            });
            setAssistantConversation<ChatMessage>(groupId, (previous) => ({
              ...previous,
              run: previous.run && previous.run.attemptId === runAttempt.attemptId
                ? { ...previous.run, runId: run.runId }
                : previous.run,
            }));
          },
          onStep: (e) => {
            if (!runStillCurrent()) return;
            liveEventsRef.current.push(e);
            // 只有真事件（帶 type/eventId 的統一 Agent 事件）才進進度面板。
            // 舊伺服器的 {phase,text} 沒有結構化欄位，畫不出可驗證的進度，
            // 由下方的一行摘要負責顯示——寧可少顯示，也不假裝有結構。
            if (!eventFlushTimerRef.current) {
              eventFlushTimerRef.current = setTimeout(() => {
                eventFlushTimerRef.current = null;
                if (!runStillCurrent()) return;
                const structured = liveEventsRef.current.filter(isAgentEvent);
                setAssistantConversation<ChatMessage>(groupId, (previous) => ({
                  ...previous,
                  run: previous.run && previous.run.attemptId === runAttempt.attemptId
                    ? { ...previous.run, events: structured }
                    : previous.run,
                }));
              }, 50);
            }
          },
          // SSE payload 是 GlobalAskResult 的純 JSON（無 superjson）；guard 只驗協定形狀，
          // 欄位型別由 tRPC 推導型別收窄（同一個 router 的回傳值）
          onDone: (d) => applyDone(d as unknown as AskData),
          onError: applyError,
        },
      });
      if (!handled) {
        // 串流沒開始：走一次性 tRPC（同一個核心；軌跡由 done 的 events/sources 補齊）
        // 若此 generation 已被 supersede/abort，不可再 mutate——避免舊回呼污染新 run。
        if (!runStillCurrent() || controller.signal.aborted) return;
        await new Promise<void>((resolve) => {
          ask.mutate(
            {
              groupId, message: text, history: newHistory,
              conversationId: returnContext.conversationId,
              projectId: pageCtx.projectId ?? projectId,
              pageContext: toWirePageContext(pageCtx),
              recentActionResults: conversation.recentActionResults,
              activeGoal: conversation.activeGoal,
              mode: readAssistantAnswerMode(),
              requestId,
            },
            {
              onSuccess: (data) => { applyDone(data); resolve(); },
              onError: (err) => { applyError(err.message); resolve(); },
            },
          );
        });
      }
    } finally {
      // generation-scoped：舊 run 的 finally 不會動到已接手的新 run（含 active 旗標）
      endAssistantRun(groupId, activeRunId, runAttempt.attemptId);
      // activePlan 是元件本地 state：若已被更新 generation 接手，不要清掉它的 plan
      const currentGen = getAssistantConversation<ChatMessage>(groupId).run?.generation;
      if (currentGen == null || currentGen === runGeneration) {
        setActivePlan(null);
      }
    }
  };

  const stopCurrent = () => {
    if (!pending || stopRecordedRef.current || !groupId) return;
    stopRecordedRef.current = true;
    const runId = liveRun?.runId;
    const attemptId = liveRun?.attemptId;
    // store 的把手優先（跨卸載仍有效）；本地 ref 是同一顆 controller，重複 abort 無害
    if (runId && attemptId) abortAssistantRun(runId, attemptId);
    abortRef.current?.abort();
    if (eventFlushTimerRef.current) clearTimeout(eventFlushTimerRef.current);
    eventFlushTimerRef.current = null;
    setOrbState("idle");
    pushMessage({
      role: "assistant",
      text: "已停止；未開始的步驟不會再執行。你可以按「繼續」用同一個目標重試。",
      executionPlan: activePlan ?? undefined,
      runStatus: "stopped",
      activity: [...liveEventsRef.current],
      events: liveEventsRef.current.filter(isAgentEvent),
      retryText: activeGoalRef.current || undefined,
    });
    endAssistantRun(groupId, runId, attemptId);
  };

  const clearConversation = () => {
    if (!groupId) return;
    stopRecordedRef.current = true;
    const runId = liveRun?.runId;
    const attemptId = liveRun?.attemptId;
    if (runId && attemptId) abortAssistantRun(runId, attemptId);
    abortRef.current?.abort();
    abortRef.current = null;
    if (eventFlushTimerRef.current) clearTimeout(eventFlushTimerRef.current);
    eventFlushTimerRef.current = null;
    queuedMessageRef.current = null;
    if (eventFlushTimerRef.current) clearTimeout(eventFlushTimerRef.current);
    eventFlushTimerRef.current = null;
    liveEventsRef.current = [];
    endAssistantRun(groupId, runId, attemptId);
    clearAssistantConversation(groupId);
    setActivePlan(null);
    setOrbState("idle");
    ask.reset();
  };

  useEffect(() => {
    if (pending || !groupId || !queuedMessageRef.current) return;
    const queued = queuedMessageRef.current;
    queuedMessageRef.current = null;
    void handleSend(queued);
  }, [pending, groupId]);

  // 使用者手動捲動時更新「是否貼底」：距離底部小於 48px 視為仍貼底，
  // 之後自動捲動才會繼續接手；捲上去讀舊訊息期間新事件不再搶滾輪。
  const onFeedScroll = () => {
    const el = chatFeedRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  useEffect(() => {
    if (messages.length > 0 && stickToBottomRef.current) {
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
              onClick={clearConversation}
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

        {messages.length === 0 && (
          <div className="ai-copilot-home" data-fb="Aios 首頁">
            <strong>Aios</strong>
            <span>告訴我你想完成什麼，我會直接幫你做。</span>
          </div>
        )}

        {/* ── 能力說明（收合一列；開口之後讓位給對話）──
            快捷鍵只有三顆而且隨頁面換，它們回答不了「這東西到底能幹嘛」。
            說明書放在快捷鍵上面：先知道做得到什麼，那三顆才看得懂。 */}
        {messages.length === 0 && (
          <AssistantCapabilityGuide
            ctx={pageCtx}
            onPick={(prompt) => void handleSend(prompt)}
            disabled={pending || !groupId}
          />
        )}

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
          <div className="ai-copilot-chat-feed" role="log" aria-live="polite" aria-relevant="additions" ref={chatFeedRef} onScroll={onFeedScroll}>
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
                      events={msg.events}
                      latency={msg.latency}
                    />
                  ) : null}
                  {/* 工作過程＋來源：兩者都只在真的有事件／來源時才渲染。
                      「檢索了：…」那一行拿掉了——同樣的資訊在這裡是可展開、可查來源的版本。 */}
                  {msg.role === "assistant" && (msg.events?.length || msg.sources?.length) ? (
                    <AgentWorkPanel
                      events={msg.events ?? []}
                      sources={msg.sources ?? []}
                      onNavigate={onNavigate}
                    />
                  ) : null}
                  <div className="ai-copilot-bubble__text">{msg.text}</div>
                  {msg.interactionRequest
                    && conversation.pendingInteraction?.interactionId === msg.interactionRequest.interactionId ? (
                    <AssistantInteractionCard
                      request={msg.interactionRequest}
                      busy={submitInteraction.isPending}
                      onPresented={() => {
                        if (presentedInteractionIdsRef.current.has(msg.interactionRequest!.interactionId)) return;
                        presentedInteractionIdsRef.current.add(msg.interactionRequest!.interactionId);
                        recordInteractionLifecycle(msg.interactionRequest!, "presented");
                      }}
                      onSelect={(ids) => { void submitInteractionSelection(msg.interactionRequest!, ids); }}
                      onCancel={() => {
                        setIntakeOpenRequest(undefined);
                        // Clear local pending handoff immediately so a later turn
                        // cannot attach a cancelled picker selection (#664).
                        if (groupId) {
                          const interactionId = msg.interactionRequest?.interactionId;
                          setAssistantConversation<ChatMessage>(groupId, (previous) => {
                            const activeGoal = previous.activeGoal;
                            const clearPending = previous.pendingInteraction?.interactionId === interactionId;
                            const clearGoalInteraction = activeGoal?.pendingInteraction?.interactionId === interactionId;
                            return {
                              ...previous,
                              pendingInteraction: clearPending ? undefined : previous.pendingInteraction,
                              activeGoal: clearGoalInteraction && activeGoal
                                ? {
                                    ...activeGoal,
                                    status: "ready" as const,
                                    pendingInteraction: activeGoal.pendingInteraction
                                      ? { ...activeGoal.pendingInteraction, status: "cancelled" as const }
                                      : undefined,
                                  }
                                : activeGoal,
                            };
                          });
                        }
                        recordInteractionLifecycle(msg.interactionRequest!, "cancelled");
                      }}
                    />
                  ) : null}
                  {msg.editingSessionId && activeProjectId ? (
                    <AssistantEditingSessionCard
                      projectId={activeProjectId}
                      sessionId={msg.editingSessionId}
                      onReturned={(assetIds) => {
                        if (!groupId || !assetIds[0]) return;
                        recordAssistantActionResults(groupId, [{
                          type: "import",
                          source: "external-result",
                          resourceIds: [],
                          assetIds,
                          intelligenceIds: [],
                          projectId: activeProjectId,
                          count: assetIds.length,
                          duplicateCount: 0,
                          needsReviewCount: assetIds.length,
                          backgroundProcessing: true,
                          verification: { status: "verified", message: "剪輯成果已安全保存並連回工作階段" },
                        }]);
                        pushMessage({
                          role: "assistant",
                          text: "✓ LumaFusion 剪輯成果已回到原工作階段，版本來源與專案位置都已保留。",
                          runStatus: "completed",
                          editingResult: { sessionId: msg.editingSessionId!, assetId: assetIds[0] },
                        });
                      }}
                      onReview={(assetId) => void handleSend(`幫我審查剛從 LumaFusion 帶回的成片（Asset ${assetId}），比較目前專案腳本與分鏡，並清楚標示可驗證的來源；如果無法取得精確 timecode，請直接說明。`)}
                    />
                  ) : null}
                  {msg.editingResult ? <EditingResultCard assetId={msg.editingResult.assetId} sessionId={msg.editingResult.sessionId}
                    onReview={(assetId) => void handleSend(`幫我審查剛從 LumaFusion 帶回的成片（Asset ${assetId}），比較目前專案腳本與分鏡，並清楚標示可驗證的來源；如果無法取得精確 timecode，請直接說明。`)} /> : null}

                  {msg.intakeFallbacks?.map((fallback) => (
                    <IntakeFallbackCard
                      key={`${fallback.provider}:${fallback.url}`}
                      fallback={fallback}
                      onChoose={(targetProjectId, mode) => {
                        setIntakeTargetProjectId(targetProjectId);
                        setIntakeOpenRequest({ id: `${Date.now()}`, mode });
                      }}
                    />
                  ))}

                  {/* 讀到什麼 → 能去哪。按鈕只從真實來源長出來（見 followUpActionsFromSources）。 */}
                  {msg.role === "assistant" && onNavigate && msg.sources?.length ? (
                    <div className="ai-copilot-bubble__actions">
                      {followUpActionsFromSources(msg.sources).map((action) => (
                        <Button key={action.key} variant="tonal" size="sm" onClick={() => onNavigate(action.href)}>
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  ) : null}

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
                  {onUseIdeaForNewProject
                    && shouldOfferIdeaProject(msg)
                    && !msg.siteActions?.some((a) => a.type === "create_project")
                    && !msg.executedSiteActions?.some((item) => item.result.type === "create_project") && (
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
                    <AgentRunCard plan={activePlan} active events={liveRun?.events ?? []} />
                  ) : null}
                  {/* 旋轉的 Loader 圖示換成三顆呼吸的光點：轉圈是「系統卡住」的語彙，
                      光點才是「正在想」。文字本身也跑一道光掃過去。
                      這一行的字來自**最後一則真實事件**——沒有事件時只說「連線中」，
                      不假裝正在讀什麼東西。 */}
                  <div className="ai-copilot-bubble__text ai-copilot-loading">
                    <span className="ai-copilot-dots" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="ai-copilot-loading__label">
                      {liveRun?.events.length
                        ? liveRun.events[liveRun.events.length - 1].title
                        : "連線中…"}
                    </span>
                  </div>
                  {/* 即時工作過程：每一列都對應一次真的發生的工具／來源讀取。
                      收合狀態只顯示最後一列——手機上不會被工作紀錄淹沒。 */}
                  {liveRun?.events.length ? (
                    <AgentWorkPanel
                      events={liveRun.events}
                      sources={liveRun.sources}
                      live
                      onCancel={stopCurrent}
                      onNavigate={onNavigate}
                    />
                  ) : null}
                </div>
              </div>
            )}

            <div ref={chatBottomRef} />
          </div>
        )}

        {/* ── 輸入工具列 ── */}
        <div className="ai-copilot-input-box">
          {intakeProjectId ? (
            <ExternalAssetIntake
              projectId={intakeProjectId}
              groupId={groupId}
              sceneId={pageCtx.entityType === "shot" ? pageCtx.entityId : undefined}
              triggerLabel="＋"
              triggerVariant="ghost"
              dialogTitle="加入資料"
              closeOnImported
              openRequest={intakeOpenRequest}
              onOpenChange={(open) => {
                if (open) return;
                const interaction = conversation.pendingInteraction;
                if (interaction && interactionPickerMode(interaction.type)) {
                  recordInteractionLifecycle(interaction, "cancelled");
                }
              }}
              onImported={(notice) => {
                setIntakeTargetProjectId(undefined);
                if (!notice || !groupId) return;
                const interaction = conversation.pendingInteraction;
                if (interaction && interactionPickerMode(interaction.type)) {
                  void submitInteractionImport(interaction, notice);
                  return;
                }
                recordAssistantActionResults(groupId, [{
                  type: "import",
                  source: notice.source,
                  resourceIds: notice.resourceIds,
                  assetIds: notice.assetIds,
                  intelligenceIds: notice.intelligenceIds,
                  folderImportSessionId: notice.folderImportSessionId,
                  projectId: notice.projectId,
                  sceneId: pageCtx.entityType === "shot" ? pageCtx.entityId : undefined,
                  count: notice.count,
                  duplicateCount: 0,
                  needsReviewCount: notice.count,
                  backgroundProcessing: true,
                  verification: { status: "verified", message: "檔案已安全保存並登記背景整理" },
                }]);
                setAssistantConversation<ChatMessage>(groupId, (previous) => ({
                  ...previous,
                  // Import is a verified step, not the whole multi-step goal. Keep
                  // typed result refs so "整理一下／放第三鏡" continues the same goal.
                  activeGoal: previous.activeGoal
                    ? {
                        ...previous.activeGoal,
                        status: "ready",
                        missingSlots: [],
                        resultRefIds: notice.assetIds.slice(0, 20),
                        updatedAt: new Date().toISOString(),
                      }
                    : previous.activeGoal,
                }));
                pushMessage({
                  role: "assistant",
                  text: `✓ ${notice.count} 項資料已安全加入。AI 正在背景整理；若還要整理或放到分鏡，直接接著說即可。`,
                  runStatus: "completed",
                });
              }}
            />
          ) : (
            <button
              type="button"
              className="ai-copilot-intake-trigger"
              aria-label="加入資料"
              title="加入資料"
              disabled={!groupId || pending}
              onClick={() => void handleSend("我要加入資料，請先讓我選擇專案。")}
            >
              ＋
            </button>
          )}
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
                ? "接著告訴 Aios…（Shift + Enter 換行）"
                : "告訴 Aios 你想完成什麼…"
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
      {activeProjectId && editingSheetOpen ? (
        <EditingHandoffSheet
          open={editingSheetOpen}
          projectId={activeProjectId}
          defaultShotIds={pageCtx.entityType === "shot" && pageCtx.entityId ? [pageCtx.entityId] : []}
          originConversationId={conversation.returnContext?.conversationId}
          originAssistantRunId={conversation.returnContext?.runId}
          originSurface="global"
          onClose={() => setEditingSheetOpen(false)}
          onPrepared={(sessionId) => {
            if (!groupId) return;
            recordAssistantActionResults(groupId, [{
              type: "editing_handoff",
              editingSessionId: sessionId,
              projectId: activeProjectId,
              editorId: "lumafusion",
              assetIds: [],
              verification: { status: "verified", message: "剪輯工作階段與交接 manifest 已持久化" },
            }]);
            pushMessage({
              role: "assistant",
              text: "交接工作階段已建立。你可以直接從這張卡分享／下載，剪完後也從同一張卡回傳，不必離開對話。",
              runStatus: "completed",
              editingSessionId: sessionId,
            });
          }}
        />
      ) : null}
    </div>
  );
}
