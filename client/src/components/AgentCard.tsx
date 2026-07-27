import { useEffect, useRef, useState } from "react";
import { trpc } from "../api";
import { Icon, type IconName } from "./Icon";
import { ConfirmButton } from "./interactions";

/**
 * AI 代理卡（代理系統前端）：一句目標 → 規劃（NIM 免費）→ 計畫預覽（每步＋估點總額）→
 * 核准執行 → 伺服器背景逐步跑（關頁不中斷）→ 即時進度／可停止。
 * 通則不變：規劃前先看價、核准才開始花執行點數、每步實際扣點走各自守門（超額仍會停下等組長核准）。
 */

/** 與 server/services/agentRunner 的 AgentStep jsonb 同形狀（tRPC 端 jsonb 推導不出型別，前端自己標） */
interface AgentStep {
  kind: "split_script" | "create_scene" | "generate" | "voiceover" | "submit_approval";
  note: string;
  status: "pending" | "running" | "done" | "failed" | "stopped";
  points?: number;
  detail?: string;
}

const STEP_ICON: Record<AgentStep["status"], IconName> = {
  done: "CheckCircle2", failed: "XCircle", stopped: "CircleStop", running: "Loader", pending: "Clock",
};
const KIND_ICON: Record<AgentStep["kind"], IconName> = {
  split_script: "Clapperboard", create_scene: "Plus", generate: "Sparkles", voiceover: "Mic", submit_approval: "Check",
};
const RUN_STATUS: Record<string, { label: string; cls: string }> = {
  awaiting_approval: { label: "待你核准", cls: "queued" },
  running: { label: "執行中", cls: "running" },
  done: { label: "已完成", cls: "done" },
  failed: { label: "失敗", cls: "failed" },
  stopped: { label: "已停止", cls: "queued" },
};

/** 有沒有還在動的 run（活躍才輪詢）：執行中／待核准，或按停後仍有步驟等 runner 收尾標記
 *（審查修復：剛按停時當前步驟可能還是 pending，要等下一個 tick 才標 stopped——這段期間要繼續輪詢，
 *  否則畫面停在舊狀態） */
function isActive(r: { status: string; steps: unknown }): boolean {
  const steps = r.steps as AgentStep[];
  return (
    r.status === "running" ||
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
  "把知識庫的腳本拆成分鏡，並為每一鏡生成畫面",
  "幫我做三格開場分鏡：禪堂晨光、點香、遠景，各配一張圖",
  "為已有配音詞的分鏡都生成旁白，然後把第 1 鏡送審",
];

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
  const [expandedRuns, setExpandedRuns] = useState<Record<string, boolean>>({});
  const runs = trpc.agents.listByProject.useQuery(
    { projectId },
    {
      // 有活躍的才輪詢（推進是伺服器的事，這裡只看結果）；重進頁會 refetch
      refetchInterval: (query) => (query.state.data?.some(isActive) ? 4000 : false),
      refetchIntervalInBackground: true,
    },
  );
  const invalidateAll = () => {
    utils.agents.listByProject.invalidate({ projectId });
    utils.quota.my.invalidate();
  };
  const plan = trpc.agents.plan.useMutation({
    onSuccess: () => { setGoal(""); invalidateAll(); },
  });
  const approve = trpc.agents.approve.useMutation({ onSuccess: invalidateAll });
  const discard = trpc.agents.discard.useMutation({ onSuccess: invalidateAll });
  const stop = trpc.agents.stop.useMutation({ onSuccess: invalidateAll });

  // 執行中每步的成品/分鏡/扣點會陸續落庫——相關卡片跟著刷（比照 WorkflowCard 的節奏）
  const hasRunning = (runs.data ?? []).some((r) => r.status === "running" || (r.steps as AgentStep[]).some((s) => s.status === "running"));
  useEffect(() => {
    if (!hasRunning) return;
    const refresh = () => {
      utils.generation.listByProject.invalidate({ projectId });
      // 分頁/篩選視圖也要刷新，否則代理逐步落庫的成品在該視圖看不到（修 agent-workflow-refresh-missing-paged）
      utils.generation.listByProjectPaged.invalidate({ projectId });
      utils.scenes.listByProject.invalidate({ projectId });
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
      if (!isFirst && before === "running" && (r.status === "done" || r.status === "failed")) {
        notifyDesktop(r.status === "done" ? "AI 代理完成 ✓" : "AI 代理失敗", r.goal.slice(0, 30));
      }
      prev.set(r.id, r.status);
    }
    for (const id of Array.from(prev.keys())) {
      if (!rows.some((r) => r.id === id)) prev.delete(id);
    }
  }, [runs.data]);

  const actionError = approve.error ?? discard.error ?? stop.error;
  const busy = approve.isPending || discard.isPending || stop.isPending;

  // 四合一（專案 AI 代理系統）分頁模式：外殼與標題由 AiHub 提供，這裡只出內容
  const body = (
    <>
      {!embedded && (
        <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Icon name="Sparkles" size={18} style={{ color: "var(--primary-ink)" }} /> AI 代理（給我一個目標，我來排計畫執行）
        </h2>
      )}
      {!hideComposer && (
        <p className="hint" style={{ marginTop: embedded ? 0 : -4 }}>
          用一句話說目標（例：「把腳本拆成分鏡並逐鏡出圖」）——我會讀世界觀＋知識庫排出<b>逐步計畫與估點</b>（規劃免費），
          你<b>核准後</b>才開始執行；由伺服器背景逐步跑，關掉頁面也會繼續，隨時可停止。每步實際扣點走既有守門，超額仍會停下等組長核准。
        </p>
      )}

      {hideComposer ? (
        (runs.data ?? []).length === 0 && (
          <p className="hint">
            還沒有代理計畫——在上方對話用一句話下目標（例：「把腳本拆成分鏡並逐鏡出圖」），我會排出逐步計畫與估點，你核准後由伺服器背景執行。
          </p>
        )
      ) : canEdit ? (
        <>
          <label htmlFor={`agent-goal-${projectId}`}>你的目標（一句話）</label>
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
          <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <ConfirmButton
              triggerClassName="primary"
              disabled={goal.trim().length < 5 || plan.isPending}
              message="會請 AI 代理讀世界觀＋知識庫排一份逐步計畫——NIM 免費額度，不扣點；計畫只規劃不執行，執行前還會再讓你看估點核准。"
              confirmLabel="開始規劃"
              onConfirm={() => plan.mutate({ projectId, goal: goal.trim() })}
            >
              {plan.isPending ? "代理規劃中…" : "規劃計畫（免費）"}
            </ConfirmButton>
            {!plan.isPending && goal.trim().length > 0 && goal.trim().length < 5 && <span className="hint">目標至少 5 個字</span>}
          </div>
          {plan.error && <p className="error" role="alert">{plan.error.message}</p>}
        </>
      ) : (
        <p className="hint">你在此專案是檢視者（唯讀）——可以看代理進度，不能發起或核准。</p>
      )}

      {actionError && <p className="error" role="alert">{actionError.message}</p>}

      {(runs.data ?? []).map((r) => {
        const steps = r.steps as AgentStep[];
        const st = RUN_STATUS[r.status] ?? { label: r.status, cls: "queued" };
        const defaultOpen = r.status === "running" || r.status === "awaiting_approval";
        const runOpen = expandedRuns[r.id] ?? defaultOpen;
        const doneSteps = steps.filter((s) => s.status === "done").length;
        // 與伺服器授權規則對齊（審查修復）：核准/放棄/停止＝發起人本人或組長以上——
        // 一般編輯者對別人的 run 按了必然 FORBIDDEN，直接不顯示按鈕
        const canAct = canEdit && (isLeader || r.userId === me.data?.user.id);
        return (
          <details
            key={r.id}
            className="agent-run"
            open={runOpen}
            onToggle={(e) => {
              const open = e.currentTarget.open;
              setExpandedRuns((prev) => (prev[r.id] === open ? prev : { ...prev, [r.id]: open }));
            }}
            data-fb="代理執行列"
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
              {r.status === "running" && canAct && (
                <button className="btn-sm" disabled={stop.isPending} onClick={() => stop.mutate({ runId: r.id })}>
                  {stop.isPending ? "停止中…" : "停止後續步驟"}
                </button>
              )}
              </div>
            {r.summary && <p className="hint" style={{ margin: "4px 0" }}>{r.summary}</p>}
            <div style={{ marginTop: 4 }}>
              {steps.map((s, i) => (
                <div key={i} className="hint" style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                  <span style={{ display: "inline-flex" }}>
                    <Icon name={STEP_ICON[s.status] ?? "Clock"} size={14} className={s.status === "running" ? "spin" : undefined} />
                  </span>
                  <span style={{ display: "inline-flex" }}><Icon name={KIND_ICON[s.kind] ?? "Sparkles"} size={12} /></span>
                  <span>{s.note}</span>
                  {s.points ? <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>約 {s.points} 點</span> : null}
                  {s.status === "pending" && r.status === "running" && <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>排隊中</span>}
                  {s.detail && <span className="mono" style={{ fontSize: "var(--fs-11)", opacity: 0.8 }}>{s.detail.slice(0, 60)}</span>}
                </div>
              ))}
            </div>
            {r.status === "awaiting_approval" && (
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                {canAct ? (
                  <>
                    <ConfirmButton
                      triggerClassName="primary"
                      disabled={busy}
                      message={`核准後開始逐步執行，預估共 約 ${r.estPoints} 點（每步實際扣點走既有守門，失敗自動退點）。`}
                      confirmLabel="執行"
                      onConfirm={() => approve.mutate({ runId: r.id })}
                    >
                      {approve.isPending ? "啟動中…" : `執行計畫（預估 −${r.estPoints} 點）`}
                    </ConfirmButton>
                    <button className="btn-sm" disabled={busy} onClick={() => discard.mutate({ runId: r.id })}>
                      放棄這份計畫
                    </button>
                  </>
                ) : (
                  <span className="hint">等發起人或組長核准</span>
                )}
                <span className="hint">核准前不會花任何執行點數</span>
              </div>
            )}
            {r.status === "failed" && r.error && <p className="hint" style={{ marginTop: 4, color: "var(--danger-ink)" }}>原因：{r.error}</p>}
            {r.status === "stopped" && <p className="hint" style={{ marginTop: 4 }}>已停止（已完成與正在生成的步驟不受影響）。</p>}
            {r.status === "done" && <p className="hint" style={{ marginTop: 4, color: "var(--success-ink)" }}>全部完成——成品在生成紀錄與分鏡列表。</p>}
            </div>
          </details>
        );
      })}
    </>
  );

  if (embedded) return <div data-fb="AI 代理卡">{body}</div>;
  return (
    <section className="card card--primary" data-fb="AI 代理卡" id="sec-agent">
      {body}
    </section>
  );
}
