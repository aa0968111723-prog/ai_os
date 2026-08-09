import { trpc } from "../../api";

/**
 * Shared agent-run activity counts for workbench header + PlanMode summary.
 * Uses the same agents.listByProject query key as AgentCard (React Query cache).
 */
export function useAgentRunBadges(projectId: string) {
  const runs = trpc.agents.listByProject.useQuery({ projectId });
  const list = runs.data ?? [];
  const awaiting = list.filter((r) => r.status === "awaiting_approval").length;
  const running = list.filter((r) => r.status === "running").length;
  const waiting = list.filter((r) => r.status === "waiting" || r.status.startsWith("waiting_") || r.status === "user_controlled").length;
  const hasActiveRun = running > 0 || waiting > 0 || awaiting > 0;
  return { runs, awaiting, running, waiting, hasActiveRun };
}
