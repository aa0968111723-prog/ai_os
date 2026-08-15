import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useLocation } from "wouter";
import { useIsPhone } from "../../lib/viewport";
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
import {
  applyTheaterHint,
  cancelTheaterForRun,
  clearPendingTheaterSuggest,
  getPendingTheaterSuggest,
  getTheaterCursorState,
  subscribeTheaterCursor,
  theaterEnabled,
} from "../../lib/agentTheater";
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

  /**
   * 手機（<768px）不做背景輪詢，桌面維持原樣。
   *
   * `refetchIntervalInBackground: true` 在桌機是對的：使用者常把分頁擺著、
   * 回頭看 agent 跑完了沒。在手機上同一條設定變成「App 切到背景仍每 30 秒
   * 打一次 API」——耗電、耗流量，而且使用者根本沒在看。
   * 手機只在**畫面可見**時輪詢；停止中的 2 秒快輪詢兩邊都保留（那是使用者
   * 剛按下停止、正在等回應的當下）。
   */
  const phone = useIsPhone();
  const overview = trpc.teamAssistant.agentOverview.useQuery(
    { groupId },
    {
      enabled: !!groupId,
      refetchInterval: stoppingId ? 2_000 : 30_000,
      refetchIntervalInBackground: !phone,
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

  // PR-5：poll pending suggest for 「前往查看」 CTA (human override path)
  const [suggestTick, setSuggestTick] = useState(0);
  useEffect(() => {
    if (!theaterEnabled()) return;
    const t = window.setInterval(() => setSuggestTick((n) => n + 1), 1_500);
    return () => window.clearInterval(t);
  }, []);
  const pendingSuggest = useMemo(() => {
    void suggestTick;
    return theaterEnabled() ? getPendingTheaterSuggest() : null;
  }, [suggestTick]);

  const cursor = useSyncExternalStore(
    subscribeTheaterCursor,
    getTheaterCursorState,
    () => null,
  );

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
  const suggestForLead = pendingSuggest && pendingSuggest.runId === lead.id ? pendingSuggest : null;

  return (
    <>
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
        {/* PR-5：真人忙碌時不自動跳頁，改由明確 CTA 決定 */}
        {suggestForLead && !isStopping && (
          <Button
            size="sm"
            variant="primary"
            type="button"
            onClick={() => {
              applyTheaterHint(suggestForLead, {
                navigate: (path) => navigate(path),
                force: true,
                currentPathname: typeof window !== "undefined" ? window.location.pathname : undefined,
              });
              clearPendingTheaterSuggest();
              setSuggestTick((n) => n + 1);
            }}
          >
            前往查看
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={isStopping}
          onClick={() => {
            // Theater stop first: cancel pending nav/cursor even if stop API is slow
            cancelTheaterForRun(lead.id);
            clearPendingTheaterSuggest();
            setStoppingId(lead.id);
            stopClickedAtRef.current = Date.now();
            stop.mutate({ runId: lead.id });
          }}
        >
          <Icon name="CircleStop" size={13} />
          {isStopping ? "停止中…" : "停"}
        </Button>
      </div>
      {/* PR-5：合成 AI 游標——外觀與真人 presence 不同，標示 AI 操作提示，不產生 click */}
      {cursor && (
        <div
          className="agent-theater-cursor"
          style={{ left: cursor.x, top: cursor.y }}
          aria-hidden="true"
        >
          <span className="agent-theater-cursor__dot" />
          <span className="agent-theater-cursor__label">AI 操作提示</span>
        </div>
      )}
    </>
  );
}
