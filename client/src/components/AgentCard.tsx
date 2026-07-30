import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton } from "./interactions";
import type { CompletePlanSummary } from "../../../shared/plan";
import {
  AGENT_PLANNER_OPTIONS,
  getAgentPlannerOption,
  type AgentPlannerMode,
  type AgentPlannerTelemetry,
} from "../../../shared/agentPlanner";
import {
  readAgentPlannerMode,
  writeAgentPlannerMode,
} from "../lib/agentPlannerPreference";
import { listAiProjectRoles } from "../../../shared/aiProjectRoles";

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
    | "generate"
    | "voiceover"
    | "submit_approval"
    | "record_to_database"
    | "create_note"
    | "append_note"
    | "create_schedule"
    | "update_schedule"
    | "create_task"
    | "wait_for_human"
    | "request_approval";
  note: string;
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
  outputRefs?: Array<{ type: string; id: string; label?: string }>;
}

const STEP_ICON: Record<AgentStep["status"], IconName> = {
  done: "CheckCircle2", failed: "XCircle", stopped: "CircleStop", running: "Loader", waiting: "Pause", pending: "Clock",
};
const KIND_ICON: Record<AgentStep["kind"], IconName> = {
  split_script: "Clapperboard",
  create_scene: "Plus",
  generate: "Sparkles",
  voiceover: "Mic",
  submit_approval: "Check",
  record_to_database: "Database",
  create_note: "FileText",
  append_note: "FileText",
  create_schedule: "CalendarPlus",
  update_schedule: "CalendarPlus",
  create_task: "User",
  wait_for_human: "Pause",
  request_approval: "Check",
};
const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  awaiting_approval: { label: "待你核准", cls: "queued" },
  running: { label: "執行中", cls: "running" },
  waiting: { label: "等待人員", cls: "queued" },
  done: { label: "已完成", cls: "done" },
  failed: { label: "失敗", cls: "failed" },
  stopped: { label: "已停止", cls: "queued" },
};
const EVENT_LABEL: Record<string, string> = {
  planned: "完成規劃",
  approved: "人工核准",
  step_started: "開始步驟",
  step_waiting: "進入等待",
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
    r.status === "awaiting_approval" ||
    (r.status === "stopped" && steps.some((s) => s.status === "running" || s.status === "pending"))
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

const GOAL_EXAMPLES = [
  "請分鏡助理：把知識庫腳本拆成分鏡，並為每一鏡生成畫面（帶定裝）",
  "請生成員：做三格開場分鏡——禪堂晨光、點香、遠景，各配一張圖",
  "請配音統籌：為已有配音詞的分鏡生成旁白；品管再把第 1 鏡送審",
];

const AI_ROLE_ROSTER = listAiProjectRoles();

export function AgentCard({
  projectId,
  canEdit,
  isLeader = false,
  embedded = false,
  hideComposer = false,
}: {
  projectId: string;
  canEdit: boolean;
  isLeader?: boolean;
  embedded?: boolean;
  /** 統一入口模式：目標從上方對話下（plan_agent），這裡只留「計畫核准／進度／停止」的執行區 */
  hideComposer?: boolean;
}) {
  const utils = trpc.useUtils();
  // 與 App 同 key 共用快取：核准/停止的授權是「發起人本人或組長以上」，按鈕顯示要跟伺服器規則對齊
  const me = trpc.auth.me.useQuery();
  const [goal, setGoal] = useState("");
  const [plannerMode, setPlannerMode] = useState<AgentPlannerMode>(readAgentPlannerMode);
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
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
    utils.quota.my.invalidate();
    utils.tasks.listByProject.invalidate({ projectId });
    utils.agents.eventsByProject.invalidate({ projectId });
    utils.agents.insights.invalidate({ projectId });
  };
  const plan = trpc.agents.plan.useMutation({
    onSuccess: () => { setGoal(""); invalidateAll(); },
  });
  const approve = trpc.agents.approve.useMutation({ onSuccess: invalidateAll });
  const discard = trpc.agents.discard.useMutation({ onSuccess: invalidateAll });
  const stop = trpc.agents.stop.useMutation({ onSuccess: invalidateAll });
  const completeTask = trpc.tasks.complete.useMutation({ onSuccess: invalidateAll });
  const decideApproval = trpc.tasks.decideApproval.useMutation({ onSuccess: invalidateAll });

  // 執行中每步的成品/分鏡/扣點會陸續落庫——相關卡片跟著刷（比照 WorkflowCard 的節奏）
  const hasRunning = (runs.data ?? []).some((r) => r.status === "running" || (r.steps as AgentStep[]).some((s) => s.status === "running"));
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

  const actionError = runs.error ?? tasks.error ?? events.error ?? insights.error ?? approve.error ?? discard.error ?? stop.error ?? completeTask.error ?? decideApproval.error;
  const busy = approve.isPending || discard.isPending || stop.isPending || completeTask.isPending || decideApproval.isPending;
  const plannerOption = getAgentPlannerOption(plannerMode);

  // embedded：外殼由 CreationWorkbench / PlanMode（或 legacy AiHub 測試）提供，這裡只出內容
  const body = (
    <>
      {!embedded && (
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> AI 職能助手（請分鏡助理／生成員排計畫執行）
        </h2>
      )}
      {!hideComposer && (
        <p className="hint" style={{ marginTop: embedded ? 0 : -4 }}>
          用一句話交代目標（例：「請分鏡助理先出草稿並逐鏡出圖」）——系統會依 <b>AI 職能</b>（非真人組員）讀世界觀＋知識庫排出<b>逐步計畫與估點</b>（站內 0 點；Fal 依 token 計費），
          你<b>核准後</b>才開始執行；由伺服器背景逐步跑，關掉頁面也會繼續，隨時可停止。每步實際扣點走既有守門，超額仍會停下等組長核准。
        </p>
      )}

      {hideComposer ? (
        !runs.isLoading && !runs.error && runs.data && runs.data.length === 0 && (
          <p className="hint" role="status">
            還沒有 AI 職能執行計畫——在上方對話請分鏡助理或生成員用一句話下目標，我會排出逐步計畫與估點，你核准後由伺服器背景執行。
          </p>
        )
      ) : canEdit ? (
        <>
          <label htmlFor={`agent-goal-${projectId}`}>你的目標（一句話，可點名 AI 職能）</label>
          <textarea
            id={`agent-goal-${projectId}`}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder={`例：${GOAL_EXAMPLES[0]}`}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {GOAL_EXAMPLES.map((g) => (
              <button key={g} type="button" className="btn-sm" title="點了帶入目標框" onClick={() => setGoal(g)}>
                {g}
              </button>
            ))}
          </div>
          <fieldset style={{ margin: "12px 0 0", padding: 0, border: 0 }}>
            <legend style={{ fontWeight: 650, marginBottom: 6 }}>規劃模型與用量</legend>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 6 }}>
              {AGENT_PLANNER_OPTIONS.map((option) => {
                const selected = option.value === plannerMode;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`btn-sm${selected ? " primary" : ""}`}
                    aria-pressed={selected}
                    title={option.description}
                    onClick={() => {
                      setPlannerMode(option.value);
                      writeAgentPlannerMode(option.value);
                    }}
                    style={{ textAlign: "left", minHeight: 58 }}
                  >
                    <strong style={{ display: "block" }}>{option.shortLabel}</strong>
                    <span style={{ display: "block", fontSize: "var(--fs-11)", opacity: 0.82, marginTop: 2 }}>
                      {option.usageLabel}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="hint" style={{ margin: "6px 0 0" }}>
              {plannerOption.description} fal.ai 模式會把本次規劃所需的專案內容傳給模型，並依實際 token 計費；完成後會顯示用量。
            </p>
          </fieldset>
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <ConfirmButton
              triggerClassName="primary"
              disabled={goal.trim().length < 5 || plan.isPending}
              message={`會用「${plannerOption.shortLabel}」讀世界觀＋知識庫排一份逐步計畫。規劃不扣站內點數；fal.ai 模式依實際 token 計費。這一步只規劃不執行，執行前還會再讓你看估點核准。`}
              confirmLabel="開始規劃"
              onConfirm={() => plan.mutate({ projectId, goal: goal.trim(), plannerMode })}
            >
              {plan.isPending ? "規劃中…" : "規劃計畫（站內 0 點）"}
            </ConfirmButton>
            {!plan.isPending && goal.trim().length > 0 && goal.trim().length < 5 && <span className="hint">目標至少 5 個字</span>}
          </div>
          {plan.error && <p className="error" role="alert">{plan.error.message}</p>}
        </>
      ) : (
        <p className="hint">你在此專案是檢視者（唯讀）——可以看執行計畫進度，不能發起或核准。</p>
      )}

      {actionError && <p className="error" role="alert">{actionError.message}</p>}
      {runs.isLoading && <p className="hint" role="status">正在載入 AI 職能計畫…</p>}
      {/* 列表載入成功但無計畫：引導文案（與 hideComposer 空態對齊；錯誤時不顯示以免誤導成「沒有計畫」） */}
      {!runs.isLoading && !runs.error && runs.data && runs.data.length === 0 && !hideComposer && (
        <p className="hint" role="status">
          {canEdit
            ? "還沒有 AI 職能執行計畫——可請「分鏡助理」或「生成員」出草稿：輸入目標後按「規劃計畫」；規劃不扣站內點數，核准後才會開始執行。"
            : "目前沒有 AI 職能執行計畫。"}
        </p>
      )}

      {/* L0/L1：AI 職能花名冊（敘事席位，非 memberships） */}
      <details className="agent-run" style={{ marginTop: 10 }}>
        <summary>
          <strong>AI 職能</strong>
          <span className="hint">可啟用的席位・不是專案成員</span>
        </summary>
        <div className="agent-run__body" style={{ display: "grid", gap: 8 }}>
          <p className="hint" style={{ margin: 0 }}>
            人是專案成員；下列為可啟用的 <b>AI 職能</b>。下目標時可點名（例：請分鏡助理…），規劃仍開一筆執行計畫，媒體生成走既有扣點路徑。
          </p>
          <div style={{ display: "grid", gap: 6 }}>
            {AI_ROLE_ROSTER.map((role) => (
              <div
                key={role.id}
                className="gen-row"
                style={{ gridTemplateColumns: "auto 1fr", alignItems: "start", gap: 8 }}
              >
                <span className="chip" title={role.id}>AI</span>
                <div>
                  <strong>{role.title}</strong>
                  <span className="hint" style={{ display: "block", marginTop: 2 }}>
                    {role.summary}
                    {role.humanKeeps.length > 0 ? ` · 人保留：${role.humanKeeps.join("、")}` : ""}
                  </span>
                  {canEdit && !hideComposer && (
                    <button
                      type="button"
                      className="btn-sm"
                      style={{ marginTop: 4 }}
                      title="帶入目標框"
                      onClick={() => setGoal(role.defaultGoalHint)}
                    >
                      用此職能目標
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </details>

      {insights.data && (
        <details className="agent-run" style={{ marginTop: 10 }}>
          <summary>
            <span className={`pill ${insights.data.status === "healthy" ? "done" : insights.data.status === "blocked" ? "failed" : "queued"}`}>
              {insights.data.status === "healthy" ? "健康" : insights.data.status === "blocked" ? "有阻塞" : "需注意"}
            </span>
            <strong>AI 職能健康</strong>
            <span className="hint">
              執行中 {insights.data.activeRuns}・待辦 {insights.data.openTasks}・成果 {insights.data.results.length}
            </span>
          </summary>
          <div className="agent-run__body" style={{ display: "grid", gap: 10 }}>
            <div className="meta">
              等待計畫 {insights.data.waitingRuns}・逾期任務 {insights.data.overdueTasks}・近七日失敗 {insights.data.recentFailures}
              ・待補資訊 {insights.data.unresolvedInformation}・風險 {insights.data.risks}
            </div>
            {Object.values(insights.data.truncated).some(Boolean) && (
              <p className="hint" style={{ margin: 0 }}>
                資料量超過單頁上限；此處顯示最近項目，完整歷史可透過代理事件分頁查詢。
              </p>
            )}
            {insights.data.blockers.length > 0 && (
              <section>
                <strong>阻塞與提醒</strong>
                <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                  {insights.data.blockers.map((blocker, index) => (
                    <li key={`${blocker.type}-${blocker.taskId ?? blocker.runId ?? index}`} style={{ color: blocker.severity === "critical" ? "var(--danger-ink)" : undefined }}>
                      {blocker.label}
                    </li>
                  ))}
                </ul>
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
                      <span className="chip">{item.kind === "ai" ? "AI" : "人員"}</span>
                      <span>{item.title}</span>
                      <span className="hint">
                        {item.status}{item.dueAt ? `・${new Date(item.dueAt).toLocaleString("zh-TW", { hour12: false })}` : ""}
                      </span>
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
                      : <span key={`${result.type}-${result.id}`} className="chip">{result.type}：{result.label}</span>;
                  })}
                </div>
              </details>
            )}
          </div>
        </details>
      )}

      {(runs.data ?? []).map((r) => {
        const steps = r.steps as AgentStep[];
        const st = RUN_STATUS[r.status] ?? { label: r.status, cls: "queued" };
        const defaultOpen = r.status === "running" || r.status === "waiting" || r.status === "awaiting_approval";
        const runOpen = expandedRuns[r.id] ?? defaultOpen;
        const doneSteps = steps.filter((s) => s.status === "done").length;
        const runTasks = (tasks.data ?? []).filter((task) => task.planRunId === r.id);
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
              <span className={`pill ${st.cls}`}>{st.label}</span>
              <span className="hint">步驟 {doneSteps}/{steps.length}</span>
              <span className="hint">{new Date(r.createdAt).toLocaleString("zh-TW", { hour12: false })}</span>
              <Icon name={runOpen ? "ChevronUp" : "ChevronDown"} size={13} />
            </summary>
            <div className="agent-run__body">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {(r.status === "running" || r.status === "waiting") && canControl && (
                <button className="btn-sm" disabled={stop.isPending} onClick={() => stop.mutate({ runId: r.id })}>
                  {stop.isPending ? "停止中…" : "停止後續步驟"}
                </button>
              )}
              </div>
            {r.summary && <p className="hint" style={{ margin: "4px 0" }}>{r.summary}</p>}
            {plannerTelemetry && plannerTelemetry.provider !== "mock" && (
              <div className="meta" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span className="chip">
                  規劃模型：{plannerTelemetry.provider === "nvidia-nim" ? "NVIDIA NIM" : "fal.ai"}・{plannerTelemetry.model}
                </span>
                {plannerTelemetry.totalTokens != null && (
                  <span className="chip">總用量 {plannerTelemetry.totalTokens.toLocaleString()} tokens</span>
                )}
                {plannerTelemetry.costUsd != null && (
                  <span className="chip">Fal 費用 US${plannerTelemetry.costUsd.toFixed(plannerTelemetry.costUsd < 0.01 ? 6 : 4)}</span>
                )}
                {plannerTelemetry.fallbackFrom && (
                  <span className="chip">已自動備援</span>
                )}
                {plannerTelemetry.attemptCount > 1 && (
                  <span className="chip">模型呼叫 {plannerTelemetry.attemptCount} 次</span>
                )}
              </div>
            )}
            {planSummary && (
              <details style={{ margin: "8px 0" }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  完整計畫
                  <span className="hint" style={{ marginLeft: 8 }}>
                    {planSummary.successCriteria.length} 項成功條件
                    {planSummary.missingInformation.length ? `・${planSummary.missingInformation.length} 項待補資訊` : ""}
                    {planSummary.risks.length ? `・${planSummary.risks.length} 項風險` : ""}
                  </span>
                </summary>
                <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
                  <section>
                    <strong>目標</strong>
                    <p className="hint" style={{ margin: "3px 0 0" }}>{planSummary.goal}</p>
                  </section>
                  {planSummary.successCriteria.length > 0 && (
                    <section>
                      <strong>成功條件</strong>
                      <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.successCriteria.map((item, index) => <li key={index}>{item}</li>)}
                      </ul>
                    </section>
                  )}
                  {planSummary.expectedOutputs.length > 0 && (
                    <section>
                      <strong>預期成果</strong>
                      <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.expectedOutputs.map((item, index) => <li key={index}>{item}</li>)}
                      </ul>
                    </section>
                  )}
                  {planSummary.missingInformation.length > 0 && (
                    <section>
                      <strong style={{ color: "var(--warning-ink, var(--danger-ink))" }}>執行前待補資訊</strong>
                      <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.missingInformation.map((item, index) => <li key={index}>{item}</li>)}
                      </ul>
                    </section>
                  )}
                  {planSummary.milestones.length > 0 && (
                    <section>
                      <strong>里程碑</strong>
                      <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.milestones.map((item) => (
                          <li key={item.id}>
                            {item.title}{item.dueAt ? `（${new Date(item.dueAt).toLocaleString("zh-TW", { hour12: false })}）` : ""}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {planSummary.risks.length > 0 && (
                    <section>
                      <strong>風險與因應</strong>
                      <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.risks.map((risk, index) => (
                          <li key={index}>
                            {risk.title}：{risk.impact}{risk.mitigation ? `；因應：${risk.mitigation}` : ""}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}
                  {planSummary.assumptions.length > 0 && (
                    <section>
                      <strong>假設</strong>
                      <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                        {planSummary.assumptions.map((item, index) => <li key={index}>{item}</li>)}
                      </ul>
                    </section>
                  )}
                  <div className="meta">
                    預估成本：{planSummary.estimatedPoints} 點
                    {planSummary.estimatedDurationMinutes != null ? `・預估工期：${planSummary.estimatedDurationMinutes} 分鐘` : ""}
                  </div>
                </div>
              </details>
            )}
            <div style={{ marginTop: 4 }}>
              {steps.map((s, i) => (
                <div key={i} className="hint" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ display: "inline-flex" }}>
                    <Icon name={STEP_ICON[s.status] ?? "Clock"} size={14} className={s.status === "running" ? "spin" : undefined} />
                  </span>
                  <span style={{ display: "inline-flex" }}><Icon name={KIND_ICON[s.kind] ?? "Sparkles"} size={12} /></span>
                  <span>{s.note}</span>
                  {s.actorType && <span className="chip">{s.actorType === "human" ? "人員" : s.actorType === "system" ? "系統" : "AI"}</span>}
                  {(s.dependsOn?.length ?? 0) > 0 && <span className="chip">前置 {s.dependsOn!.length}</span>}
                  {s.estimatedMinutes != null && <span className="chip">約 {s.estimatedMinutes} 分</span>}
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
                  {s.taskId && <span className="chip">人類任務</span>}
                </div>
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
                        <span className="chip" style={{ marginLeft: 6 }}>
                          {task.status === "done" ? "完成" : task.status === "cancelled" ? "未通過／取消" : task.taskType === "approval" ? "待核准" : "待完成"}
                        </span>
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
                            <button className="btn-sm primary" disabled={busy} onClick={() => decideApproval.mutate({ id: task.id, decision: "approve" })}>核准</button>
                            <button className="btn-sm" disabled={busy} onClick={() => decideApproval.mutate({ id: task.id, decision: "reject" })}>不核准</button>
                          </>
                        ) : (
                          <button className="btn-sm primary" disabled={busy} onClick={() => completeTask.mutate({ id: task.id })}>標記完成</button>
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
                  <span className="hint" style={{ marginLeft: 8 }}>顯示來源、動作、等待與結果，不顯示私密思考</span>
                </summary>
                <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                  {runEvents.map((event) => (
                    <div key={event.id} className="gen-row" style={{ gridTemplateColumns: "auto 1fr", alignItems: "start" }}>
                      <span className={`pill ${event.eventType.includes("failed") || event.eventType === "approval_rejected" ? "failed" : event.eventType.includes("completed") || event.eventType === "human_resumed" ? "done" : "queued"}`}>
                        {EVENT_LABEL[event.eventType] ?? event.eventType}
                      </span>
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
                      {approve.isPending ? "啟動中…" : `執行計畫（預估 −${r.estPoints} 點）`}
                    </ConfirmButton>
                )}
                {canControl && (
                    <button className="btn-sm" disabled={busy} onClick={() => discard.mutate({ runId: r.id })}>
                      放棄這份計畫
                    </button>
                )}
                {!canApprove && !canControl && (
                  <span className="hint">等發起人或組長核准</span>
                )}
                <span className="hint">核准前不會花任何執行點數</span>
              </div>
            )}
            {r.status === "failed" && r.error && <p className="hint" style={{ marginTop: 4, color: "var(--danger-ink)" }}>原因：{r.error}</p>}
            {r.status === "stopped" && <p className="hint" style={{ marginTop: 4 }}>已停止（已完成與正在生成的步驟不受影響）。</p>}
            {r.status === "done" && <p className="hint" style={{ marginTop: 4, color: "var(--success-ink)" }}>全部完成——各步驟可開啟實際筆記、排程、任務與生成成果。</p>}
            </div>
          </details>
        );
      })}
    </>
  );

  if (embedded) return <div data-fb="AI 助手卡">{body}</div>;
  return (
    <section className="card card--primary" data-fb="AI 助手卡" id="sec-agent">
      {body}
    </section>
  );
}
