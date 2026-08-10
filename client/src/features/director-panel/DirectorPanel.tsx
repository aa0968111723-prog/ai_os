/**
 * AI 導演面板（§9.1 五段流程：目標 → 拆解預覽 DAG → 成本確認 → 執行中時間軸 → 完成彙整）。
 *
 * M7 骨架：後端 dispatch router（M1–M6）尚未落地，因此不呼叫 `trpc.dispatch.*`，
 * 預設以 `demoDirectorApi`（示範資料）跑完整流程；M8 串接時注入實作
 * `DispatchDirectorApi` 的 tRPC adapter 即可，本元件不動。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { flashAnchor } from "../../discuss";
import { Icon } from "../../components/Icon";
import { Badge, Button, Card, Hint, Meta, Pill, Skeleton } from "../../components/ui";
import type { DispatchDirectorApi, DispatchOutputRef, DispatchPlanStatusPayload, DispatchPreviewResult } from "./dispatchTypes";
import { demoDirectorApi } from "./dispatchDemo";
import { DispatchPlanView } from "./DispatchPlanView";
import { CostBreakdown } from "./CostBreakdown";

/** 執行中輪詢間隔（對齊設計文件 runner TICK_MS 的量級） */
const POLL_MS = 4_000;

type Phase =
  | { kind: "idle" }
  | { kind: "previewing" }
  | { kind: "preview"; preview: DispatchPreviewResult }
  | { kind: "starting" }
  | { kind: "running"; planId: string; status: DispatchPlanStatusPayload }
  | { kind: "done"; planId: string; status: DispatchPlanStatusPayload }
  | { kind: "failed"; planId: string; status: DispatchPlanStatusPayload; error: string }
  | { kind: "cancelled"; planId: string; status: DispatchPlanStatusPayload };

function phaseFromPayload(planId: string, st: DispatchPlanStatusPayload): Phase {
  if (st.status === "done") return { kind: "done", planId, status: st };
  if (st.status === "failed") {
    const err = st.subtasks.find((s) => s.error)?.error ?? "計畫執行失敗";
    return { kind: "failed", planId, status: st, error: err };
  }
  if (st.status === "cancelled") return { kind: "cancelled", planId, status: st };
  return { kind: "running", planId, status: st };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="director-progress">
      <div className="director-progress__track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <div className="director-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <Meta as="span" className="director-progress__label">
        {done} / {total} 步
      </Meta>
    </div>
  );
}

export function DirectorPanel({
  projectId,
  panelId,
  labelledBy,
  active,
  goal,
  api = demoDirectorApi,
  onOpenRef,
}: {
  projectId: string;
  panelId: string;
  labelledBy: string;
  active: boolean;
  goal?: string;
  /** M8 串接點：注入 trpc.dispatch adapter；預設示範資料 */
  api?: DispatchDirectorApi;
  /** 產出引用開啟方式；預設 note→planner、generation/asset→flashAnchor */
  onOpenRef?: (ref: DispatchOutputRef) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const isDemo = api === demoDirectorApi;

  const openRef = useCallback(
    (ref: DispatchOutputRef) => {
      if (onOpenRef) {
        onOpenRef(ref);
        return;
      }
      if (ref.type === "note") window.location.assign(`/planner?focus=note-${ref.id}`);
      else flashAnchor(`generation-${ref.id}`);
    },
    [onOpenRef],
  );

  const runPreview = useCallback(async () => {
    const trimmed = (goal ?? "").trim();
    if (!trimmed) return;
    setError(null);
    setPhase({ kind: "previewing" });
    try {
      const preview = await api.planPreview({ projectId, goal: trimmed });
      setPhase({ kind: "preview", preview });
    } catch (e) {
      setError(messageOf(e));
      setPhase({ kind: "idle" });
    }
  }, [api, goal, projectId]);

  const approveAndStart = useCallback(async () => {
    if (phaseRef.current.kind !== "preview") return;
    setError(null);
    setPhase({ kind: "starting" });
    try {
      const preview = phaseRef.current.preview;
      const created = await api.planCreate({ projectId, goal: preview.draft.goal, draft: preview.draft });
      await api.planApprove({ planId: created.planId });
      const st = await api.planStatus({ planId: created.planId });
      setPhase(phaseFromPayload(created.planId, st));
    } catch (e) {
      setError(messageOf(e));
      setPhase({ kind: "idle" });
    }
  }, [api, projectId]);

  const stopPlan = useCallback(async () => {
    if (phaseRef.current.kind !== "running") return;
    try {
      await api.planStop({ planId: phaseRef.current.planId });
      setPhase({ kind: "cancelled", planId: phaseRef.current.planId, status: phaseRef.current.status });
    } catch (e) {
      setError(messageOf(e));
    }
  }, [api]);

  const retryPlan = useCallback(async () => {
    if (phaseRef.current.kind !== "failed") return;
    try {
      const planId = phaseRef.current.planId;
      await api.planRetry({ planId });
      const st = await api.planStatus({ planId });
      setPhase(phaseFromPayload(planId, st));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [api]);

  const reset = useCallback(() => {
    setError(null);
    setPhase({ kind: "idle" });
  }, []);

  // 執行中輪詢：planId 一換就重建 interval；終態（done/failed/cancelled）離開 interval。
  const runningPlanId = phase.kind === "running" ? phase.planId : null;
  useEffect(() => {
    if (!runningPlanId) return;
    const tick = async () => {
      try {
        const st = await api.planStatus({ planId: runningPlanId });
        setPhase((prev) => (prev.kind === "running" && prev.planId === runningPlanId ? phaseFromPayload(runningPlanId, st) : prev));
      } catch (e) {
        setError(messageOf(e));
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [runningPlanId, api]);

  const canPreview = Boolean((goal ?? "").trim());
  const { status } = phase.kind === "running" || phase.kind === "done" || phase.kind === "failed" || phase.kind === "cancelled" ? phase : { status: null };

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy} hidden={!active}>
      <div className="section-heading-row" id="sec-director" style={{ marginBottom: 8 }}>
        <strong style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icon name="Waypoints" size={14} /> AI 導演拆解
        </strong>
        <span className="spacer" />
        {isDemo ? <Badge tone="mock">示範資料</Badge> : null}
        {status ? <Pill status={status === "running" ? "running" : status === "done" ? "done" : "failed"}>{status}</Pill> : null}
      </div>

      {phase.kind === "idle" || phase.kind === "cancelled" ? (
        <Card variant="std">
          <Hint>
            {phase.kind === "cancelled" ? "計畫已停止。改好目標後可重新拆解。" : "把要完成的畫面用一句話講清楚，AI 會拆成多步 DAG 並估點；核准後才開始執行、才扣點。"}
          </Hint>
          <div className="director-actions">
            <Button variant="primary" disabled={!canPreview} onClick={runPreview}>
              <Icon name="Waypoints" size={14} /> 拆解預覽
            </Button>
          </div>
        </Card>
      ) : null}

      {phase.kind === "previewing" ? (
        <div className="director-loading">
          <Skeleton height={96} radius={12} />
          <Hint>正在把目標拆解成多步 DAG…</Hint>
        </div>
      ) : null}

      {phase.kind === "preview" ? (
        <>
          <DispatchPlanView subtasks={phase.preview.draft.subtasks} estimate={phase.preview.costEstimate} showEstimates onOpenRef={openRef} />
          <CostBreakdown estimate={phase.preview.costEstimate} provider={phase.preview.provider} />
          <div className="director-actions">
            <Button variant="primary" onClick={approveAndStart}>
              <Icon name="Play" size={14} /> 核准並開始執行
            </Button>
            <Button variant="ghost" onClick={reset}>調整再拆</Button>
          </div>
        </>
      ) : null}

      {phase.kind === "starting" ? (
        <div className="director-loading">
          <Skeleton height={48} radius={10} />
          <Hint>建立計畫中…</Hint>
        </div>
      ) : null}

      {phase.kind === "running" ? (
        <>
          <ProgressBar done={phase.status.doneCount} total={phase.status.totalCount} />
          <DispatchPlanView subtasks={phase.status.subtasks} onOpenRef={openRef} />
          <div className="director-actions">
            <Button variant="tonal" onClick={stopPlan}>
              <Icon name="CircleStop" size={14} /> 停止
            </Button>
          </div>
        </>
      ) : null}

      {phase.kind === "done" ? (
        <>
          <div className="director-done">
            <Icon name="CheckCircle2" size={18} />
            <strong>全部完成</strong>
          </div>
          <DispatchPlanView subtasks={phase.status.subtasks} onOpenRef={openRef} />
          <div className="director-actions">
            <Button variant="ghost" onClick={reset}>重新拆解</Button>
          </div>
        </>
      ) : null}

      {phase.kind === "failed" ? (
        <>
          <div className="director-failed">
            <Icon name="TriangleAlert" size={18} />
            <strong>{phase.error}</strong>
          </div>
          <DispatchPlanView subtasks={phase.status.subtasks} onOpenRef={openRef} />
          <div className="director-actions">
            <Button variant="primary" onClick={retryPlan}>
              <Icon name="RotateCw" size={14} /> 重試
            </Button>
            <Button variant="ghost" onClick={reset}>重新拆解</Button>
          </div>
        </>
      ) : null}

      {error ? (
        <div className="director-error">
          <Icon name="XCircle" size={13} />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
