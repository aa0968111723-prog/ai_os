import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  agentRunHudLabel,
  isAgentRunActiveForHud,
  isAgentRunWaitingForHuman,
} from "../../../../shared/agentQuestions";
import {
  agentStopAckLatency,
  isAgentRunTerminalStatus,
  revisionFromUpdatedAt,
  shouldAcceptRunRevision,
} from "../../../../shared/agentProgress";
import { trpc } from "../../api";
import { Icon } from "../../components/Icon";
import { Button, Meta, Pill } from "../../components/ui";

/**
 * 代理動態列：跨頁常駐的「AI 正在幫你做什麼」＋隨時可停。
 *
 * ## PR-2 hardening
 * - push / poll merge by revision（舊 snapshot 不得蓋掉新狀態）
 * - stop acknowledgement 等到 terminal status
 * - waiting_* 人話標籤 + waitingReason
 */
const STOP_ACK_TIMEOUT_MS = 45_000;

type OverviewRun = {
  id: string;
  projectId: string;
  projectTitle: string;
  goal: string;
  status: string;
  doneSteps: number;
  totalSteps: number;
  currentStepNote?: string | null;
  waitingReason?: string | null;
  revision?: number;
  updatedAt?: string | Date;
};

function runRevision(r: OverviewRun): number {
  return typeof r.revision === "number" ? r.revision : revisionFromUpdatedAt(r.updatedAt);
}

export function AgentActivityHud({ groupId }: { groupId: string }) {
  const [, navigate] = useLocation();
  const [stoppingId, setStoppingId] = useState<string | null>(null);
  const stopClickedAtRef = useRef<number | null>(null);
  /** Highest-revision snapshot per run across push/poll races. */
  const runCacheRef = useRef<Map<string, OverviewRun>>(new Map());
  const utils = trpc.useUtils();

  const overview = trpc.teamAssistant.agentOverview.useQuery(
    { groupId },
    {
      enabled: !!groupId,
      refetchInterval: stoppingId ? 2_000 : 30_000,
      refetchIntervalInBackground: true,
    },
  );

  const stop = trpc.agents.stop.useMutation({
    onSuccess: () => {
      void utils.teamAssistant.agentOverview.invalidate({ groupId });
    },
    onError: () => {
      setStoppingId(null);
      stopClickedAtRef.current = null;
    },
  });

  const rawRuns = (overview.data?.runs ?? []) as OverviewRun[];

  const runs = useMemo(() => {
    const cache = runCacheRef.current;
    const seen = new Set<string>();
    for (const r of rawRuns) {
      seen.add(r.id);
      const rev = runRevision(r);
      const old = cache.get(r.id);
      if (old && !shouldAcceptRunRevision(runRevision(old), rev)) continue;
      cache.set(r.id, { ...r, revision: rev });
    }
    if (overview.data) {
      for (const [id, row] of cache) {
        if (seen.has(id)) continue;
        if (id === stoppingId) continue;
        if (!isAgentRunActiveForHud(row.status) || isAgentRunTerminalStatus(row.status)) {
          cache.delete(id);
        }
      }
    }
    return [...cache.values()];
    // rawRuns identity changes each query; overview.data gates prune
  }, [rawRuns, overview.data, stoppingId]);

  // Stop ack: hold until authoritative terminal
  useEffect(() => {
    if (!stoppingId) return;
    const row = runCacheRef.current.get(stoppingId) ?? rawRuns.find((r) => r.id === stoppingId);
    if (row && isAgentRunTerminalStatus(row.status)) {
      if (stopClickedAtRef.current != null) {
        agentStopAckLatency.record(Date.now() - stopClickedAtRef.current);
      }
      setStoppingId(null);
      stopClickedAtRef.current = null;
      return;
    }
    if (
      overview.data
      && !rawRuns.some((r) => r.id === stoppingId)
      && !runCacheRef.current.has(stoppingId)
      && !stop.isPending
    ) {
      if (stopClickedAtRef.current != null) {
        agentStopAckLatency.record(Date.now() - stopClickedAtRef.current);
      }
      setStoppingId(null);
      stopClickedAtRef.current = null;
    }
  }, [runs, rawRuns, stoppingId, overview.data, stop.isPending]);

  useEffect(() => {
    if (!stoppingId) return;
    const t = window.setTimeout(() => {
      setStoppingId(null);
      stopClickedAtRef.current = null;
      void utils.teamAssistant.agentOverview.invalidate({ groupId });
    }, STOP_ACK_TIMEOUT_MS);
    return () => window.clearTimeout(t);
  }, [stoppingId, groupId, utils]);

  const active = runs.filter((r) => isAgentRunActiveForHud(r.status) || r.id === stoppingId);
  if (active.length === 0 && !stoppingId) return null;

  const lead = (stoppingId ? active.find((r) => r.id === stoppingId) : null)
    ?? active[0]
    ?? (stoppingId ? runCacheRef.current.get(stoppingId) : undefined);
  if (!lead) return null;

  const rest = Math.max(0, active.length - 1);
  const isStopping = stoppingId === lead.id;
  const label = isStopping ? "停止中" : agentRunHudLabel(lead.status);
  const pill = lead.status === "running" && !isStopping ? "running" as const : "queued" as const;
  const waitingHint = !isStopping && isAgentRunWaitingForHuman(lead.status)
    ? (lead.waitingReason
      ? `・${lead.waitingReason}`
      : lead.status === "waiting_permission" ? "・請處理權限" : "・請回覆")
    : "";

  return (
    <div className="agent-hud" role="status" aria-live="polite">
      <Pill status={pill}>{label}</Pill>
      <button
        type="button"
        className="agent-hud__body"
        onClick={() => navigate(`/p/${lead.projectId}?focus=agent-run-${lead.id}`)}
      >
        <span className="agent-hud__note">
          {lead.currentStepNote || lead.goal}
        </span>
        <Meta as="span" style={{ fontSize: "var(--fs-11)" }}>
          {lead.projectTitle}
          {lead.totalSteps > 0 ? `・${lead.doneSteps}/${lead.totalSteps} 步` : ""}
          {waitingHint}
          {rest > 0 ? `・另有 ${rest} 個` : ""}
        </Meta>
      </button>
      <Button
        variant="ghost"
        size="sm"
        disabled={isStopping}
        onClick={() => {
          setStoppingId(lead.id);
          stopClickedAtRef.current = Date.now();
          stop.mutate({ runId: lead.id });
        }}
      >
        <Icon name="CircleStop" size={13} />
        {isStopping ? "停止中…" : "停"}
      </Button>
    </div>
  );
}
