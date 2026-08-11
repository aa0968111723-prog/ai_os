import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton } from "./interactions";
import { flashAnchor } from "../discuss";
import type { CompletePlanSummary } from "../../../shared/plan";
import {
  AGENT_PLANNER_OPTIONS,
  getAgentPlannerOption,
  type AgentPlannerMode,
  type AgentPlannerTelemetry,
} from "../../../shared/agentPlanner";
import { plannerCostLabel } from "../../../shared/llmPricing";
import {
  readAgentPlannerMode,
  writeAgentPlannerMode,
} from "../lib/agentPlannerPreference";
import { listAiProjectRoles } from "../../../shared/aiProjectRoles";
import { Button, Card, Chip, Hint, Meta, Pill, type PillStatus } from "./ui";
import { getPlaybook } from "../../../shared/rolePlaybooks";
import { GoogleDrivePicker } from "./GoogleDrivePicker";
import { focusAndReveal } from "../lib/scrollIntoViewForChrome";
import { AiUnderstandingPanel } from "../features/creation-workbench/AiUnderstandingPanel";
import { AgentQuestionCard } from "./AgentQuestionCard";
import { AgentDagCanvas } from "./AgentDagCanvas";

/**
 * AI 職能／創作助手卡：一句目標 →（心智上請 分鏡助理／生成員 等 AI 職能）→ 規劃供應商／用量 →
 * 計畫預覽（每步＋估點總額）→ 核准執行 → 伺服器背景逐步跑（關頁不中斷）→ 即時進度／可停止。
 * AI 職能是產品敘事席位，不是真人成員；執行仍是一筆 agent_run。
 * 通則不變：規劃前先看價、核准才開始花執行點數、每步實際扣點走各自守門（超額仍會停下等組長核准）。
 */

/** 與 server/services/agentRunner 的 AgentStep jsonb 同形狀（tRPC 端 jsonb 推導不出型別，前端自己標） */
interface AgentStep {
  id?: string;
  title?: string;
  kind:
    | "split_script"
    | "create_scene"
    | "update_scene"
    | "reorder_scenes"
    | "generate"
    | "voiceover"
    | "record_to_database"
    | "create_note"
    | "append_note"
    | "create_schedule"
    | "update_schedule"
    | "create_task"
    | "wait_for_human"
    | "request_approval";
  note: string;
  /** 決策軌跡（#133 PR-1）：為何需要此步——結構化說明，非模型內部推理 */
  rationale?: string;
  status: "pending" | "running" | "waiting" | "done" | "failed" | "stopped";
  actorType?: "ai" | "human" | "system";
  dependsOn?: string[];
  milestoneId?: string;
  estimatedMinutes?: number;
  sourceRefs?: Array<{ type: string; id: string; label?: string }>;
  points?: number;
  detail?: string;
  noteId?: string;
  scheduleItemId?: string;
  taskId?: string;
  /** 執行中生成佔位 id——有值＝支線已送出、關頁也在跑 */
  generationId?: string;
  outputRefs?: Array<{ type: string; id: string; label?: string }>;
}

const STEP_ICON: Record<AgentStep["status"], IconName> = {
  done: "CheckCircle2", failed: "XCircle", stopped: "CircleStop", running: "Loader", waiting: "Pause", pending: "Clock",
};
const KIND_ICON: Record<AgentStep["kind"], IconName> = {
  split_script: "Clapperboard",
  create_scene: "Plus",
  update_scene: "Clapperboard",
  reorder_scenes: "Layers",
  generate: "Sparkles",
  voiceover: "Mic",
  record_to_database: "Database",
  create_note: "FileText",
  append_note: "FileText",
  create_schedule: "CalendarPlus",
  update_schedule: "CalendarPlus",
  create_task: "User",
  wait_for_human: "Pause",
  request_approval: "Check",
};
/** 創作者語：少代碼狀態名，多「場記／過目／開拍」感 */
const RUN_STATUS: Record<string, { label: string; cls: PillStatus }> = {
  awaiting_approval: { label: "待你過目", cls: "queued" },
  running: { label: "開拍中", cls: "running" },
  waiting: { label: "等你回覆", cls: "queued" },
  waiting_user_input: { label: "需要你選擇", cls: "queued" },
  waiting_confirmation: { label: "等待確認", cls: "queued" },
  waiting_permission: { label: "等待你接手", cls: "queued" },
  user_controlled: { label: "由你操作中", cls: "queued" },
  paused: { label: "已暫停", cls: "queued" },
  done: { label: "已完成", cls: "done" },
  failed: { label: "需要重來", cls: "failed" },
  stopped: { label: "已暫停", cls: "queued" },
};
const EVENT_LABEL: Record<string, string> = {
  planned: "完成規劃",
  approved: "人工核准",
  step_started: "開始步驟",
  step_waiting: "進入等待",
  waiting_user_input: "等待你的選擇",
  question_answered: "已收到回答",
  step_completed: "完成步驟",
  step_failed: "步驟失敗",
  human_resumed: "人員完成並恢復",
  approval_rejected: "核准未通過",
  run_completed: "計畫完成",
  run_failed: "計畫失敗",
  stopped: "人工停止",
  discarded: "放棄計畫",
  observation: "狀態觀察",
};

/** 有沒有還在動的 run（活躍才輪詢）：執行中／待核准，或按停後仍有步驟等 runner 收尾標記
 *（審查修復：剛按停時當前步驟可能還是 pending，要等下一個 tick 才標 stopped——這段期間要繼續輪詢，
 *  否則畫面停在舊狀態） */
function isActive(r: { status: string; steps: unknown }): boolean {
  const steps = r.steps as AgentStep[];
  return (
    r.status === "running" ||
    r.status === "waiting" ||
    r.status === "waiting_user_input" ||
    r.status === "waiting_confirmation" ||
    r.status === "waiting_permission" ||
    r.status === "user_controlled" ||
    r.status === "awaiting_approval" ||
    (r.status === "stopped" && steps.some((s) => s.status === "running" || s.status === "pending")) ||
    // 一支失敗後 run=failed，但並行支線可能仍 running——繼續輪詢直到 runner settle 完
    (r.status === "failed" && steps.some((s) => s.status === "running"))
  );
}

/** 桌面通知（審查修復：比照 WorkflowCard 的 notifyDesktop——permission 還是 default 時先徵求授權，
 *  原版從不呼叫 requestPermission，沒授權過的使用者永遠收不到通知） */
function notifyDesktop(title: string, body: string): void {
  if (typeof Notification === "undefined") return;
  const fire = () => {
    if (Notification.permission !== "granted") return;
    try {
      new Notification(title, { body });
    } catch { /* 部分瀏覽器背景分頁受限，忽略 */ }
  };
  if (Notification.permission === "default") {
    Notification.requestPermission().then(fire).catch(() => {});
  } else {
    fire();
  }
}

/**
 * 步驟產出 chips（#133 PR-2）：outputRefs → 可點深連結。
 * 筆記／排程走 Planner 的 ?focus= 深連結；任務與生成成果在同頁（工作台／專案頁），
 * 用 flashAnchor 捲動＋閃爍既有錨點（task-{id}／generation-{id}）；其他類型顯示標籤。
 */
function OutputRefChips({ refs }: { refs: Array<{ type: string; id: string; label?: string }> }) {
  if (!refs.length) return null;
  return (
    <>
      {refs.slice(0, 6).map((ref) => {
        const label = ref.label?.slice(0, 24) || ref.type;
        if (ref.type === "note") {
          return <Link key={`${ref.type}-${ref.id}`} className="chip pick" href={`/planner?focus=note-${ref.id}`}>成果：{label}</Link>;
        }
        if (ref.type === "schedule") {
          return <Link key={`${ref.type}-${ref.id}`} className="chip pick" href={`/planner?focus=schedule-${ref.id}`}>成果：{label}</Link>;
        }
        if (ref.type === "task") {
          return (
            <button key={`${ref.type}-${ref.id}`} type="button" className="chip pick" onClick={() => flashAnchor(`task-${ref.id}`)}>
              成果：{label}
            </button>
          );
        }
        if (ref.type === "generation") {
          return (
            <button key={`${ref.type}-${ref.id}`} type="button" className="chip pick" title="捲動到生成成果" onClick={() => flashAnchor(`generation-${ref.id}`)}>
              成果：{label}
            </button>
          );
        }
        return <Chip key={`${ref.type}-${ref.id}`}>成果：{label}</Chip>;
      })}
    </>
  );
}

const GOAL_EXAMPLES = [
  "請分鏡助理：把知識庫腳本拆成分鏡，並為每一鏡生成畫面（帶定裝）",
  "請生成員：做三格開場分鏡——禪堂晨光、點香、遠景，各配一張圖",
  "請配音統籌：為已有配音詞的分鏡生成旁白，並列出仍需人工確認的風險",
];

const AI_ROLE_ROSTER = listAiProjectRoles();
/** #133 PR-3：創作短版入口——固定短骨架（拆分鏡→生成→可選配音），與完整多步計畫區隔 */
const SHORT_CREATION_PLAYBOOK = getPlaybook("playbook.creation.short.v1");

export function AgentCard({
  projectId,
  canEdit,
  isLeader = false,
  embedded = false,
  hideComposer = false,
  initialGoal,
  compactComposer = false,
  initialKnowledgeIds,
  goal: controlledGoalValue,
  onGoalChange,
  goalInputId,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
  embedded?: boolean;
  /** 舊入口：只留核准／進度（新工作台執行計畫模式請勿使用） */
  hideComposer?: boolean;
  /** 工作台共用 goal 帶入 */
  initialGoal?: string;
  /** 精簡排版：規劃模型預設收合，職能改橫向 chip */
  compactComposer?: boolean;
  /** 工作台知識優先勾選（id 列表）→ 規劃 extraSourceIds */
  initialKnowledgeIds?: string[];
  /**
   * 受控目標（QA 2026-08-02）：工作台與這裡原本各有一個目標框，字不互通——
   * 使用者得打兩次還不知道排步驟送的是哪一份。傳 onGoalChange 就進「單一輸入框」模式：
   * 本卡不再自帶 textarea，值與寫入都回到上層那一格。
   */
  goal?: string;
  onGoalChange?: (goal: string) => void;
  /** 上層那格 textarea 的 DOM id——職能 chip 寫入後把焦點送回去 */
  goalInputId?: string;
}) {
  const utils = trpc.useUtils();
  // 與 App 同 key 共用快取：核准/停止的授權是「發起人本人或組長以上」，按鈕顯示要跟伺服器規則對齊
  const me = trpc.auth.me.useQuery();
  const controlledGoal = typeof onGoalChange === "function";
  const [localGoal, setLocalGoal] = useState(() => (initialGoal ?? "").trim());
  const goal = controlledGoal ? (controlledGoalValue ?? "") : localGoal;
  const setGoal = (next: string) => {
    if (controlledGoal) onGoalChange!(next);
    else setLocalGoal(next);
  };
  // PR-E3：搜尋雲端後「勾選」僅本次納入規劃的檔案（內容由後端規劃當下拉取，不落庫）
  const [driveSources, setDriveSources] = useState<Array<{ id: string; name: string }>>([]);
  // PR-E2：轉存進知識庫的來源（站內知識 id）——優先注入本次與之後的規劃
  const [knowledgeSources, setKnowledgeSources] = useState<Array<{ id: string; title: string }>>([]);
  const [saveToKnowledgeError, setSaveToKnowledgeError] = useState<string | null>(null);
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [plannerMode, setPlannerMode] = useState<AgentPlannerMode>(readAgentPlannerMode);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const [traceSessionId, setTraceSessionId] = useState<string | null>(null);
  const goalInputRef = useRef<HTMLTextAreaElement | null>(null);

  // 工作台 goal 變更時同步（使用者已在本地輸入較長內容則不覆蓋）
  // 受控模式沒有本地副本可鏡射——值本來就是上層那一格，跳過。
  useEffect(() => {
    if (controlledGoal) return;
    const next = (initialGoal ?? "").trim();
    if (!next) return;
    setLocalGoal((prev) => (prev.trim().length >= 5 ? prev : next));
  }, [initialGoal, controlledGoal]);

  /** 職能 chip 寫入目標後把焦點帶回輸入框（受控時是上層工作台那一格） */
  const focusGoalInput = () => {
    const el = goalInputId
      ? (document.getElementById(goalInputId) as HTMLElement | null)
      : goalInputRef.current;
    focusAndReveal(el);
  };

  // 工作台「本次知識優先」→ 合併進 knowledgeSources（標題稍後由 list 補；先用 id）
  useEffect(() => {
    const ids = initialKnowledgeIds ?? [];
    if (!ids.length) return;
    setKnowledgeSources((prev) => {
      const map = new Map(prev.map((k) => [k.id, k]));
      for (const id of ids) {
        if (!map.has(id)) map.set(id, { id, title: id.slice(0, 8) + "…" });
      }
      // 保留使用者在代理卡另加的來源，但工作台勾選的 id 一定在
      return Array.from(map.values()).slice(0, 10);
    });
  }, [initialKnowledgeIds?.join(",")]);

  const runs = trpc.agents.listByProject.useQuery(
    { projectId },
    {
      // 有活躍的才輪詢（推進是伺服器的事，這裡只看結果）；重進頁會 refetch
      refetchInterval: (query) => (query.state.data?.some(isActive) ? 4000 : false),
      refetchIntervalInBackground: true,
    },
  );
  const tasks = trpc.tasks.listByProject.useQuery({ projectId });
  const shouldPollAgent = (runs.data ?? []).some(isActive);
  const questions = trpc.agents.pendingQuestions?.useQuery?.(
    { projectId },
    { refetchInterval: shouldPollAgent ? 4000 : false, refetchIntervalInBackground: true },
  ) ?? { data: undefined, error: null };
  const events = trpc.agents.eventsByProject.useQuery(
    { projectId },
    { refetchInterval: shouldPollAgent ? 8000 : false, refetchIntervalInBackground: true },
  );
  const insights = trpc.agents.insights.useQuery(
    { projectId },
    { refetchInterval: shouldPollAgent ? 8000 : false, refetchIntervalInBackground: true },
  );
  const invalidateAll = () => {
    utils.agents.listByProject.invalidate({ projectId });
    utils.agents.pendingQuestions?.invalidate?.({ projectId });
    utils.quota.my.invalidate();
    utils.tasks.listByProject.invalidate({ projectId });
    utils.agents.eventsByProject.invalidate({ projectId });
    utils.agents.insights.invalidate({ projectId });
  };
  const preview = trpc.agents.preview?.useMutation?.() ?? {
    data: undefined,
    error: null,
    isPending: false,
    mutate: (_input: unknown) => undefined,
  };
  const plan = trpc.agents.plan.useMutation({
    onSuccess: (data) => { setTraceSessionId(data.traceSessionId); setGoal(""); setDriveSources([]); setKnowledgeSources([]); invalidateAll(); },
  });
  const importToKnowledge = trpc.knowledge.importDriveFile.useMutation();
  // PR-E2「轉存進知識庫」：逐檔轉存（序列化）→ 成為站內知識來源 chips → 規劃帶 extraSourceIds 優先注入
  const saveDriveFilesToKnowledge = async (files: Array<{ id: string; name: string }>) => {
    setSaveToKnowledgeError(null);
    const errors: string[] = [];
    for (const f of files) {
      try {
        const row = await importToKnowledge.mutateAsync({ projectId, fileId: f.id, kind: "note" });
        setKnowledgeSources((prev) => (prev.some((k) => k.id === row.id) ? prev : [...prev, { id: row.id, title: row.title }].slice(0, 10)));
      } catch (err) {
        errors.push(`${f.name}：${err instanceof Error ? err.message : "轉存失敗"}`);
      }
    }
    utils.knowledge.list.invalidate({ projectId });
    if (errors.length) setSaveToKnowledgeError(errors.slice(0, 3).join("；"));
  };
  const approve = trpc.agents.approve.useMutation({ onSuccess: invalidateAll });
  const discard = trpc.agents.discard.useMutation({ onSuccess: invalidateAll });
  const stop = trpc.agents.stop.useMutation({ onSuccess: invalidateAll });
  const answerQuestion = trpc.agents.answerAgentQuestion?.useMutation?.({ onSuccess: invalidateAll }) ?? {
    mutate: (_input: unknown) => undefined,
    isPending: false,
    error: null,
  };
  const completeTask = trpc.tasks.complete.useMutation({ onSuccess: invalidateAll });
  const decideApproval = trpc.tasks.decideApproval.useMutation({ onSuccess: invalidateAll });

  const runList = runs.data ?? [];
  const meId = me.data?.user.id;
  /** 待核准且我能按的：置頂主操作 */
  const pendingMyApproval = runList.filter((r) => {
    if (r.status !== "awaiting_approval") return false;
    return isLeader || r.userId === meId;
  });
  /** 列表排序：待核准 → 執行中 → 等待 → 其他 */
  const sortedRuns = [...runList].sort((a, b) => {
    const rank = (s: string) =>
      s === "awaiting_approval" ? 0 : s === "running" ? 1 : s.startsWith("waiting") || s === "user_controlled" ? 2 : 3;
    return rank(a.status) - rank(b.status);
  });

  // 執行中每步的成品/分鏡/扣點會陸續落庫——相關卡片跟著刷（比照 WorkflowCard 的節奏）
  const hasRunning = runList.some((r) => r.status === "running" || (r.steps as AgentStep[]).some((s) => s.status === "running"));
  useEffect(() => {
    if (!hasRunning) return;
    const refresh = () => {
      utils.generation.listByProject.invalidate({ projectId });
      // 分頁/篩選視圖也要刷新，否則代理逐步落庫的成品在該視圖看不到（修 agent-workflow-refresh-missing-paged）
      utils.generation.listByProjectPaged.invalidate({ projectId });
      utils.scenes.listByProject.invalidate({ projectId });
      utils.notes.list.invalidate();
      utils.schedule.list.invalidate();
      utils.quota.my.invalidate();
    };
    const timer = setInterval(refresh, 4000);
    return () => { clearInterval(timer); refresh(); };
  }, [hasRunning, projectId, utils]);

  // 完成/失敗的「邊緣」偵測：run 由 running 轉終局時桌面通知（授權過才發；比照 WorkflowCard）
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const rows = runs.data;
    if (!rows || typeof Notification === "undefined") return;
    const prev = prevStatusRef.current;
    const isFirst = prev.size === 0;
    for (const r of rows) {
      const before = prev.get(r.id);
      if (!isFirst && (before === "running" || before === "waiting") && (r.status === "done" || r.status === "failed")) {
        notifyDesktop(r.status === "done" ? "AI 執行計畫完成 ✓" : "AI 執行計畫失敗", r.goal.slice(0, 30));
      }
      prev.set(r.id, r.status);
    }
    for (const id of Array.from(prev.keys())) {
      if (!rows.some((r) => r.id === id)) prev.delete(id);
    }
  }, [runs.data]);

  const actionError = runs.error ?? questions.error ?? tasks.error ?? events.error ?? insights.error ?? approve.error ?? discard.error ?? stop.error ?? answerQuestion.error ?? completeTask.error ?? decideApproval.error;
  const busy = approve.isPending || discard.isPending || stop.isPending || answerQuestion.isPending || completeTask.isPending || decideApproval.isPending;
  const plannerOption = getAgentPlannerOption(plannerMode);

  // embedded：外殼由 CreationWorkbench / PlanMode（或 legacy AiHub 測試）提供，這裡只出內容
  const body = (
    <>
      {!embedded && (
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> 多步計畫
        </h2>
      )}

      {/* 多代理長跑：同時在拍的支線（關頁也繼續） */}
      {(() => {
        const flying = runList.flatMap((r) => {
          if (r.status !== "running" && r.status !== "stopped") return [];
          const steps = r.steps as AgentStep[];
          return steps
            .filter((s) => s.status === "running" && (s.generationId || s.kind === "generate" || s.kind === "voiceover"))
            .map((s) => ({ runId: r.id, note: s.note || s.title || "進行中", kind: s.kind }));
        });
        if (!flying.length) return null;
        return (
          <div className="agent-crew-live" role="status" aria-live="polite">
            <div className="agent-crew-live__head">
              <Icon name="Sparkles" size={14} />
              <strong>劇組開拍中</strong>
              <Meta>關頁也會繼續 · {flying.length} 條支線</Meta>
            </div>
            <div className="agent-crew-live__row">
              {flying.slice(0, 6).map((f, i) => (
                <span key={`${f.runId}-${i}`} className="agent-crew-live__chip">
                  <Icon name={f.kind === "voiceover" ? "Mic" : "Image"} size={12} />
                  {f.note.slice(0, 28)}{f.note.length > 28 ? "…" : ""}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* 待過目置頂：像審片單，不用先展開列表 */}
      {pendingMyApproval.length > 0 && (
        <div className="agent-approval-rail" role="region" aria-label="待你過目的計畫">
          {pendingMyApproval.map((r) => (
            <div key={r.id} className="agent-approval-rail__item">
              <div className="agent-approval-rail__badge" aria-hidden>
                <Icon name="Play" size={18} />
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 650 }}>
                  可以開拍 · 約 {r.estPoints} 點
                </div>
                <Meta as="div" style={{ marginTop: 2 }}>
                  {r.goal.slice(0, 80)}{r.goal.length > 80 ? "…" : ""}
                </Meta>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <ConfirmButton
                  triggerClassName="primary"
                  disabled={busy}
                  message={`過目後開始背景開拍，預估約 ${r.estPoints} 點（失敗會退點）。`}
                  confirmLabel="開拍"
                  onConfirm={() => approve.mutate({ runId: r.id })}
                >
                  {approve.isPending ? "開拍中…" : `開拍（約 −${r.estPoints} 點）`}
                </ConfirmButton>
                <Button size="sm" disabled={busy} onClick={() => discard.mutate({ runId: r.id })}>
                  先不要
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!hideComposer && canEdit ? (
        <>
          {!compactComposer && (
            <Hint style={{ marginTop: embedded ? 0 : -4 }}>
              寫目標 → 排步驟 → 你核准才扣點；關頁也會繼續跑。
            </Hint>
          )}
          {controlledGoal ? (
            // 單一輸入框：這裡只回顯上面那格的目標（不是第二個輸入框），要改字回上面改。
            <div className="agent-goal-echo" style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <Meta as="p" style={{ margin: 0, flex: "1 1 200px", minWidth: 0 }}>
                {goal.trim()
                  ? `目標：${goal.trim().slice(0, 60)}${goal.trim().length > 60 ? "…" : ""}`
                  : "還沒寫目標——先在上面「你想完成什麼畫面？」寫一句。"}
              </Meta>
              <Button variant="ghost" size="sm" type="button" onClick={focusGoalInput}>
                {goal.trim() ? "改目標" : "去寫目標"}
              </Button>
            </div>
          ) : (
            <>
              <label htmlFor={`agent-goal-${projectId}`}>目標</label>
              <textarea
                ref={goalInputRef}
                id={`agent-goal-${projectId}`}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={2}
                maxLength={1000}
                placeholder={`例：${GOAL_EXAMPLES[0]}`}
              />
            </>
          )}
          <div className="creation-skill-picker__row" style={{ marginTop: 6 }}>
            {SHORT_CREATION_PLAYBOOK && (
              <button
                type="button"
                className="chip pick"
                style={{ fontWeight: 650 }}
                title={`${SHORT_CREATION_PLAYBOOK.title}——快速出一版可審的影音／圖文；要排程、物資與多人分工請改用完整多步計畫（直接描述目標即可）`}
                onClick={() => {
                  setGoal(SHORT_CREATION_PLAYBOOK.goalTemplate);
                  focusGoalInput();
                }}
              >
                <Icon name="Sparkles" size={12} /> 快速開拍（短版）
              </button>
            )}
            {AI_ROLE_ROSTER.slice(0, compactComposer ? 4 : 6).map((role) => (
              <button
                key={role.id}
                type="button"
                className="chip pick"
                title={role.summary}
                onClick={() => {
                  setGoal(role.defaultGoalHint);
                  focusGoalInput();
                }}
              >
                {role.title}
              </button>
            ))}
          </div>
          <details style={{ margin: "8px 0 0" }} open={!compactComposer}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>
              規劃模型
              <Meta style={{ marginLeft: 8 }}>{plannerOption.shortLabel}</Meta>
            </summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6, marginTop: 6 }}>
              {AGENT_PLANNER_OPTIONS.map((option) => {
                const selected = option.value === plannerMode;
                return (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={selected ? "primary" : "neutral"}
                    aria-pressed={selected}
                    title={option.description}
                    onClick={() => {
                      setPlannerMode(option.value);
                      writeAgentPlannerMode(option.value);
                    }}
                    style={{ textAlign: "left" }}
                  >
                    <strong style={{ display: "block" }}>{option.shortLabel}</strong>
                    <span style={{ display: "block", fontSize: "var(--fs-11)", opacity: 0.82, marginTop: 2 }}>
                      {plannerCostLabel(option.value)}
                    </span>
                    <span style={{ display: "block", fontSize: "var(--fs-11)", opacity: 0.7 }}>
                      {option.usageLabel}
                    </span>
                  </Button>
                );
              })}
            </div>
          </details>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
            <Button
              size="sm"
              onClick={() => setShowDrivePicker((v) => !v)}
              title="搜尋你的 Google 雲端並勾選檔案，只給這次規劃參考（不會存進站內；未勾選的 AI 看不到）"
            >
              <Icon name="HardDrive" size={12} /> 搜尋雲端（僅本次）
            </Button>
            {knowledgeSources.map((k) => (
              <Chip key={k.id} title="已轉存進知識庫（可重複使用）——本次規劃優先注入">
                知識：{k.title.slice(0, 16)}{k.title.length > 16 ? "…" : ""}
                <button
                  type="button"
                  className="chip__x"
                  aria-label={`本次不注入 ${k.title}`}
                  style={{ marginLeft: 4, border: 0, background: "none", cursor: "pointer", padding: 0 }}
                  onClick={() => setKnowledgeSources((prev) => prev.filter((x) => x.id !== k.id))}
                >
                  <Icon name="X" size={10} />
                </button>
              </Chip>
            ))}
            {driveSources.map((f) => (
              <Chip key={f.id} title="僅本次規劃使用，不會存進站內">
                僅本次：{f.name.slice(0, 16)}{f.name.length > 16 ? "…" : ""}
                <button
                  type="button"
                  className="chip__x"
                  aria-label={`移除 ${f.name}`}
                  style={{ marginLeft: 4, border: 0, background: "none", cursor: "pointer", padding: 0 }}
                  onClick={() => setDriveSources((prev) => prev.filter((x) => x.id !== f.id))}
                >
                  <Icon name="X" size={10} />
                </button>
              </Chip>
            ))}
          </div>
          {saveToKnowledgeError && <p className="error" role="alert">{saveToKnowledgeError}</p>}
          {importToKnowledge.isPending && <Meta as="p" role="status">轉存進知識庫中…</Meta>}
          {showDrivePicker && (
            <GoogleDrivePicker
              onClose={() => setShowDrivePicker(false)}
              pickLabel="僅本次規劃"
              onSaveToKnowledge={(files) => { void saveDriveFilesToKnowledge(files); }}
              onPick={(files) => {
                setDriveSources((prev) => {
                  const merged = [...prev];
                  for (const f of files) if (!merged.some((x) => x.id === f.id)) merged.push(f);
                  return merged.slice(0, 5);
                });
              }}
            />
          )}
          <AiUnderstandingPanel
            projectId={projectId}
            preview={preview.data}
            previewPending={preview.isPending}
            previewError={preview.error?.message ?? (goal.trim().length < 5 ? "目標至少需要 5 個字。" : undefined)}
            onPreview={() => {
              if (goal.trim().length < 5) return;
              preview.mutate({
                projectId,
                goal: goal.trim(),
                plannerMode,
                extraSourceIds: knowledgeSources.length ? knowledgeSources.map((item) => item.id) : undefined,
                driveFileIds: driveSources.length ? driveSources.map((item) => item.id) : undefined,
              });
            }}
            traceSessionId={traceSessionId}
          />
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <ConfirmButton
              triggerClassName="primary"
              disabled={goal.trim().length < 5 || plan.isPending}
              message={`會用「${plannerOption.shortLabel}」讀專案資料排出步驟與估點${knowledgeSources.length || driveSources.length ? `（優先注入你選的來源：知識 ${knowledgeSources.length}、僅本次雲端檔 ${driveSources.length}）` : ""}。規劃本身${plannerCostLabel(plannerMode)}；執行的點數要你核准後才開始花。`}
              confirmLabel="排步驟"
              onConfirm={() => plan.mutate({
                projectId,
                goal: goal.trim(),
                plannerMode,
                extraSourceIds: knowledgeSources.length ? knowledgeSources.map((k) => k.id) : undefined,
                driveFileIds: driveSources.length ? driveSources.map((f) => f.id) : undefined,
              })}
            >
              {plan.isPending ? "排程中…" : "幫我排步驟"}
            </ConfirmButton>
            {!plan.isPending && goal.trim().length > 0 && goal.trim().length < 5 && (
              <Hint as="span">目標至少 5 個字</Hint>
            )}
          </div>
          {plan.error && <p className="error" role="alert">{plan.error.message}</p>}
        </>
      ) : hideComposer ? (
        !runs.isLoading && !runs.error && runList.length === 0 && (
          <Hint role="status">還沒有計畫——在上方寫目標並掛技能，或切到「執行計畫」直接排步驟。</Hint>
        )
      ) : (
        <Hint>你在此專案是檢視者（唯讀）——可以看進度，不能發起或核准。</Hint>
      )}

      {actionError && <p className="error" role="alert">{actionError.message}</p>}
      {runs.isLoading && <Meta as="p" role="status">載入計畫…</Meta>}
      {!runs.isLoading && !runs.error && runList.length === 0 && !hideComposer && canEdit && (
        <Meta as="p" role="status">
          還沒有計畫——寫好目標後按「幫我排步驟」；核准前不會扣執行點數。
        </Meta>
      )}

      {insights.data && (
        <details className="agent-run" style={{ marginTop: 10 }}>
          <summary>
            <Pill status={insights.data.status === "healthy" ? "done" : insights.data.status === "blocked" ? "failed" : "queued"}>
              {insights.data.status === "healthy" ? "健康" : insights.data.status === "blocked" ? "有阻塞" : "需注意"}
            </Pill>
            <strong>AI 職能健康</strong>
            <Meta>
              執行中 {insights.data.activeRuns}・待辦 {insights.data.openTasks}・成果 {insights.data.results.length}
            </Meta>
          </summary>
          <div className="agent-run__body" style={{ display: "grid", gap: 10 }}>
            <div className="meta">
              等待計畫 {insights.data.waitingRuns}・逾期任務 {insights.data.overdueTasks}・近七日失敗 {insights.data.recentFailures}
              ・待補資訊 {insights.data.unresolvedInformation}・風險 {insights.data.risks}
            </div>
            {Object.values(insights.data.truncated).some(Boolean) && (
              <Hint style={{ margin: 0 }}>
                資料量超過單頁上限；此處顯示最近項目，完整歷史可透過代理事件分頁查詢。
              </Hint>
            )}
            {insights.data.blockers.length > 0 && (
              <section>
                <strong>阻塞與提醒</strong>
                <Meta as="ul" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                  {insights.data.blockers.map((blocker, index) => (
                    <li key={`${blocker.type}-${blocker.taskId ?? blocker.runId ?? index}`} style={{ color: blocker.severity === "critical" ? "var(--danger-ink)" : undefined }}>
                      {blocker.label}
                    </li>
                  ))}
                </Meta>
              </section>
            )}
            {insights.data.workItems.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  AI 與人員統一任務（{insights.data.workItems.length}）
                </summary>
                <div style={{ display: "grid", gap: 5, marginTop: 6 }}>
                  {insights.data.workItems.map((item) => (
                    <div key={item.id} className="gen-row" style={{ gridTemplateColumns: "auto 1fr auto", alignItems: "center" }}>
                      <Chip>{item.kind === "ai" ? "AI" : "人員"}</Chip>
                      <span>{item.title}</span>
                      <Meta>
                        {item.status}{item.dueAt ? `・${new Date(item.dueAt).toLocaleString("zh-TW", { hour12: false })}` : ""}
                      </Meta>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {insights.data.results.length > 0 && (
              <details>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>成果中心（{insights.data.results.length}）</summary>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                  {insights.data.results.map((result) => {
                    const href = result.type === "note"
                      ? `/planner?focus=note-${result.id}`
                      : result.type === "schedule"
                        ? `/planner?focus=schedule-${result.id}`
                        : null;
                    return href
                      ? <Link key={`${result.type}-${result.id}`} className="chip pick" href={href}>{result.label}</Link>
                      : <Chip key={`${result.type}-${result.id}`}>{result.type}：{result.label}</Chip>;
                  })}
                </div>
              </details>
            )}
          </div>
        </details>
      )}

      {sortedRuns.map((r) => {
        const steps = r.steps as AgentStep[];
        const st: { label: string; cls: PillStatus } = RUN_STATUS[r.status] ?? { label: r.status, cls: "queued" };
        const defaultOpen =
          r.status === "running" ||
          r.status === "waiting" ||
          r.status === "waiting_user_input" ||
          r.status === "waiting_confirmation" ||
          r.status === "waiting_permission" ||
          r.status === "user_controlled" ||
          r.status === "awaiting_approval" ||
          r.status === "failed";
        const runOpen = expandedRuns[r.id] ?? defaultOpen;
        const doneSteps = steps.filter((s) => s.status === "done").length;
        const runTasks = (tasks.data ?? []).filter((task) => task.planRunId === r.id);
        const runQuestion = (questions.data ?? []).find((question) => question.runId === r.id);
        const runEvents = (events.data?.items ?? []).filter((event) => event.runId === r.id);
        const planSummary = r.planSummary as CompletePlanSummary | null;
        const plannerTelemetry = r.plannerTelemetry as AgentPlannerTelemetry | null;
        // 與伺服器授權規則對齊（審查修復）：核准/放棄/停止＝發起人本人或組長以上——
        // 一般編輯者對別人的 run 按了必然 FORBIDDEN，直接不顯示按鈕
        const canControl = isLeader || r.userId === me.data?.user.id;
        const canApprove = canEdit && canControl;
        return (
          <details
            key={r.id}
            id={`agent-run-${r.id}`}
            className="agent-run"
            open={runOpen}
            onToggle={(e) => {
              const open = e.currentTarget.open;
              setExpandedRuns((prev) => (prev[r.id] === open ? prev : { ...prev, [r.id]: open }));
            }}
            data-fb="AI 執行計畫列"
          >
            <summary>
              <span className="agent-run__goal">目標：{r.goal.slice(0, 60)}{r.goal.length > 60 ? "…" : ""}</span>
              <Pill status={st.cls}>{st.label}</Pill>
              <Meta>步驟 {doneSteps}/{steps.length}</Meta>
              <Meta>{new Date(r.createdAt).toLocaleString("zh-TW", { hour12: false })}</Meta>
              <Icon name={runOpen ? "ChevronUp" : "ChevronDown"} size={13} />
            </summary>
            <div className="agent-run__body">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {(r.status === "running" || r.status === "waiting" || r.status.startsWith("waiting_") || r.status === "user_controlled") && canControl && (
                <Button size="sm" disabled={stop.isPending} onClick={() => stop.mutate({ runId: r.id })}>
                  {stop.isPending ? "停止中…" : "停止後續步驟"}
                </Button>
              )}
              </div>
            {runQuestion && runQuestion.userId === meId ? (
              <AgentQuestionCard
                question={runQuestion}
                projectId={projectId}
                submitting={answerQuestion.isPending}
                error={answerQuestion.error?.message}
                onAnswer={(answer) => answerQuestion.mutate({
                  runId: r.id,
                  questionId: runQuestion.id,
                  resumeToken: runQuestion.resumeToken,
                  answer,
                })}
              />
            ) : null}
            {r.summary && <Meta as="p" style={{ margin: "4px 0" }}>{r.summary}</Meta>}
            {plannerTelemetry && plannerTelemetry.provider !== "mock" && (
              <div className="meta" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <Chip>
                  規劃模型：{plannerTelemetry.provider === "nvidia-nim" ? "NVIDIA NIM" : "fal.ai"}・{plannerTelemetry.model}
                </Chip>
                {plannerTelemetry.totalTokens != null && (
                  <Chip>總用量 {plannerTelemetry.totalTokens.toLocaleString()} tokens</Chip>
                )}
                {plannerTelemetry.pointsActual != null && (
                  <Chip title="規劃這份計畫本身花掉的點數（依實際 token 結算，與執行點數分開計）">
                    規劃扣點 {plannerTelemetry.pointsActual} 點
                  </Chip>
                )}
                {plannerTelemetry.costUsd != null && (
                  <Chip>Fal 費用 US${plannerTelemetry.costUsd.toFixed(plannerTelemetry.costUsd < 0.01 ? 6 : 4)}</Chip>
                )}
                {plannerTelemetry.fallbackFrom && (
                  <Chip>已自動備援</Chip>
                )}
                {plannerTelemetry.attemptCount > 1 && (
                  <Chip>模型呼叫 {plannerTelemetry.attemptCount} 次</Chip>
                )}
                {plannerTelemetry.knowledgeTruncated && (
                  <Chip
                    style={{ color: "var(--warning-ink, var(--danger-ink))" }}
                    title="知識與指定來源超過規劃注入預算，尾段未進入本次規劃——長文可拆段或縮小指定來源"
                  >
                    知識注入已截斷
                    {plannerTelemetry.knowledgeIncludedChars != null && plannerTelemetry.knowledgeTotalChars != null
                      ? `（${plannerTelemetry.knowledgeIncludedChars.toLocaleString()}/${plannerTelemetry.knowledgeTotalChars.toLocaleString()} 字）`
                      : ""}
                  </Chip>
                )}
              </div>
            )}
            {planSummary && (
              <details style={{ margin: "8px 0" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  完整計畫
                  <Meta style={{ marginLeft: 8 }}>
                    {planSummary.successCriteria.length} 項成功條件
                    {planSummary.missingInformation.length ? `・${planSummary.missingInformation.length} 項待補資訊` : ""}
                    {planSummary.risks.length ? `・${planSummary.risks.length} 項風險` : ""}
                  </Meta>
                </summary>
                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                  <section>
                    <strong>目標</strong>
                    <Meta as="p" style={{ margin: "3px 0 0" }}>{planSummary.goal}</Meta>
                  </section>
                  {planSummary.rationale && (
                    <section>
                      <strong>為何這樣排</strong>
                      <Meta as="p" style={{ margin: "3px 0 0" }}>{planSummary.rationale}</Meta>
                    </section>
                  )}
                  {(planSummary.contextUsed?.length ?? 0) > 0 && (
                    <section>
                      <strong>依據的上下文</strong>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                        {planSummary.contextUsed!.map((item, index) => <Chip key={index}>{item}</Chip>)}
                      </div>
                    </section>
                  )}
                  {planSummary.successCriteria.length > 0 && (
                    <section>
                      <strong>成功條件</strong>
                      <Meta as="ul" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.successCriteria.map((item, index) => <li key={index}>{item}</li>)}
                      </Meta>
                    </section>
                  )}
                  {planSummary.expectedOutputs.length > 0 && (
                    <section>
                      <strong>預期成果</strong>
                      <Meta as="ul" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.expectedOutputs.map((item, index) => <li key={index}>{item}</li>)}
                      </Meta>
                    </section>
                  )}
                  {planSummary.missingInformation.length > 0 && (
                    <section>
                      <strong style={{ color: "var(--warning-ink, var(--danger-ink))" }}>執行前待補資訊</strong>
                      <Meta as="ul" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.missingInformation.map((item, index) => <li key={index}>{item}</li>)}
                      </Meta>
                    </section>
                  )}
                  {planSummary.milestones.length > 0 && (
                    <section>
                      <strong>里程碑</strong>
                      <Meta as="ul" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.milestones.map((item) => (
                          <li key={item.id}>
                            {item.title}{item.dueAt ? `（${new Date(item.dueAt).toLocaleString("zh-TW", { hour12: false })}）` : ""}
                          </li>
                        ))}
                      </Meta>
                    </section>
                  )}
                  {planSummary.risks.length > 0 && (
                    <section>
                      <strong>風險與因應</strong>
                      <Meta as="ul" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.risks.map((risk, index) => (
                          <li key={index}>
                            {risk.title}：{risk.impact}{risk.mitigation ? `；因應：${risk.mitigation}` : ""}
                          </li>
                        ))}
                      </Meta>
                    </section>
                  )}
                  {planSummary.assumptions.length > 0 && (
                    <section>
                      <strong>假設</strong>
                      <Meta as="ul" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.assumptions.map((item, index) => <li key={index}>{item}</li>)}
                      </Meta>
                    </section>
                  )}
                  <div className="meta">
                    預估成本：{planSummary.estimatedPoints} 點
                    {planSummary.estimatedDurationMinutes != null ? `・預估工期：${planSummary.estimatedDurationMinutes} 分鐘` : ""}
                  </div>
                </div>
              </details>
            )}
            {/* PR-3：依賴圖（invalid DAG 自動文字 fallback；flag 關則只顯示列表） */}
            {steps.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <AgentDagCanvas steps={steps} />
              </div>
            )}
            <div style={{ marginTop: 4 }}>
              {steps.map((s, i) => (
                <Meta key={i} as="div" style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ display: "inline-flex" }}>
                    <Icon name={STEP_ICON[s.status] ?? "Clock"} size={14} className={s.status === "running" ? "spin" : undefined} />
                  </span>
                  <span style={{ display: "inline-flex" }}><Icon name={KIND_ICON[s.kind] ?? "Sparkles"} size={12} /></span>
                  <span>{s.note}</span>
                  {s.actorType && <Chip>{s.actorType === "human" ? "人員" : s.actorType === "system" ? "系統" : "AI"}</Chip>}
                  {(s.dependsOn?.length ?? 0) > 0 && <Chip>前置 {s.dependsOn!.length}</Chip>}
                  {s.estimatedMinutes != null && <Chip>約 {s.estimatedMinutes} 分</Chip>}
                  {s.points ? <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>約 {s.points} 點</span> : null}
                  {s.status === "pending" && r.status === "running" && <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>排隊中</span>}
                  {s.detail && <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>{s.detail.slice(0, 60)}</span>}
                  {s.noteId && (
                    <Link className="chip pick" href={`/planner?focus=note-${s.noteId}`}>
                      開啟筆記
                    </Link>
                  )}
                  {s.scheduleItemId && (
                    <Link className="chip pick" href={`/planner?focus=schedule-${s.scheduleItemId}`}>
                      開啟排程
                    </Link>
                  )}
                  {s.taskId && (
                    <button type="button" className="chip pick" title="捲動到對應的人類任務" onClick={() => flashAnchor(`task-${s.taskId}`)}>
                      人類任務
                    </button>
                  )}
                  {s.generationId && !(s.outputRefs ?? []).some((ref) => ref.type === "generation") && (
                    <button type="button" className="chip pick" title="捲動到生成成果" onClick={() => flashAnchor(`generation-${s.generationId}`)}>
                      生成成果
                    </button>
                  )}
                  <OutputRefChips refs={s.outputRefs ?? []} />
                  {s.rationale && (
                    <span className="meta" style={{ flexBasis: "100%", paddingLeft: 34 }} title={s.rationale}>
                      理由：{s.rationale.slice(0, 120)}{s.rationale.length > 120 ? "…" : ""}
                    </span>
                  )}
                </Meta>
              ))}
            </div>
            {runTasks.length > 0 && (
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                {runTasks.map((task) => (
                  <div key={task.id} id={`task-${task.id}`} className="gen-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "center" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        <Icon name={task.taskType === "approval" ? "Check" : "User"} size={12} />{" "}
                        {task.title}
                        <Chip style={{ marginLeft: 6 }}>
                          {task.status === "done" ? "完成" : task.status === "cancelled" ? "未通過／取消" : task.taskType === "approval" ? "待核准" : "待完成"}
                        </Chip>
                      </div>
                      <div className="meta">
                        {[task.assigneeName ? `負責人：${task.assigneeName}` : "尚未指派", task.dueAt ? `期限：${new Date(task.dueAt).toLocaleString("zh-TW", { hour12: false })}` : null]
                          .filter(Boolean)
                          .join("・")}
                      </div>
                    </div>
                    {task.status !== "done" && task.status !== "cancelled" && canEdit && (
                      <div style={{ display: "flex", gap: 6 }}>
                        {task.taskType === "approval" ? (
                          <>
                            <Button size="sm" variant="primary" disabled={busy} onClick={() => decideApproval.mutate({ id: task.id, decision: "approve" })}>核准</Button>
                            <Button size="sm" disabled={busy} onClick={() => decideApproval.mutate({ id: task.id, decision: "reject" })}>不核准</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="primary" disabled={busy} onClick={() => completeTask.mutate({ id: task.id })}>標記完成</Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {runEvents.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  可稽核執行軌跡（{runEvents.length}）
                  {/* 這句是 <summary> 可及名稱的一部分（內容，非說明），所以用 Meta 不用 Hint。 */}
                  <Meta style={{ marginLeft: 8 }}>顯示來源、動作、等待與結果，不顯示私密思考</Meta>
                </summary>
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  {runEvents.map((event) => (
                    <div key={event.id} className="gen-row" style={{ gridTemplateColumns: "auto 1fr", alignItems: "start" }}>
                      <Pill status={event.eventType.includes("failed") || event.eventType === "approval_rejected" ? "failed" : event.eventType.includes("completed") || event.eventType === "human_resumed" ? "done" : "queued"}>
                        {EVENT_LABEL[event.eventType] ?? event.eventType}
                      </Pill>
                      <div>
                        <div>{event.summary}</div>
                        <div className="meta">
                          {new Date(event.createdAt).toLocaleString("zh-TW", { hour12: false })}
                          {event.stepId ? `・步驟 ${event.stepId}` : ""}
                          {event.actorType ? `・${event.actorType === "human" ? "人員" : event.actorType === "ai" ? "AI" : "系統"}` : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            )}
            {r.status === "awaiting_approval" && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                {canApprove && (
                    <ConfirmButton
                      triggerClassName="primary"
                      disabled={busy}
                      message={`核准後開始逐步執行，預估共 約 ${r.estPoints} 點（每步實際扣點走既有守門，失敗自動退點）。`}
                      confirmLabel="執行"
                      onConfirm={() => approve.mutate({ runId: r.id })}
                    >
                      {approve.isPending ? "開拍中…" : `開拍（約 −${r.estPoints} 點）`}
                    </ConfirmButton>
                )}
                {canControl && (
                    <Button size="sm" disabled={busy} onClick={() => discard.mutate({ runId: r.id })}>
                      先不要
                    </Button>
                )}
                {!canApprove && !canControl && (
                  <Meta>等發起人或組長過目</Meta>
                )}
                <Hint as="span">過目前不扣點</Hint>
              </div>
            )}
            {r.status === "failed" && r.error && (
              <div className="agent-failure-card" style={{ marginTop: 8, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--danger-border, #f0c0c0)", background: "var(--danger-soft, #fff5f5)" }}>
                <Meta as="p" style={{ margin: 0, color: "var(--danger-ink)", fontWeight: 600 }}>為什麼停下來</Meta>
                <Meta as="p" style={{ margin: "4px 0 0", color: "var(--danger-ink)" }}>{r.error}</Meta>
                <Meta as="p" style={{ margin: "6px 0 0", fontSize: "var(--fs-11)" }}>
                  建議：用下方目標框帶上失敗原因重新規劃，或先補齊缺的資料再試。
                </Meta>
                {canEdit && !hideComposer && (
                  <Button
                    size="sm"
                    style={{ marginTop: 8 }}
                    onClick={() => {
                      const reason = r.error?.slice(0, 200) ?? "";
                      setGoal(`先前失敗原因：${reason}\n請依此重新規劃：${r.goal}`);
                      document.getElementById("sec-agent")?.scrollIntoView({ behavior: "smooth", block: "start" });
                    }}
                  >
                    帶此原因重新規劃
                  </Button>
                )}
              </div>
            )}
            {r.status === "stopped" && <Meta as="p" style={{ marginTop: 4 }}>已停止（已完成與正在生成的步驟不受影響）。</Meta>}
            {r.status === "done" && <Meta as="p" style={{ marginTop: 4, color: "var(--success-ink)" }}>全部完成——各步驟可開啟實際筆記、排程、任務與生成成果。</Meta>}
            </div>
          </details>
        );
      })}
    </>
  );

  if (embedded) return <div data-fb="AI 助手卡">{body}</div>;
  return (
    <Card as="section" variant="primary" data-fb="AI 助手卡" id="sec-agent">
      {body}
    </Card>
  );
}
