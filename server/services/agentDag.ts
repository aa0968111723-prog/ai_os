export interface AgentDagStep {
  id?: string;
  note: string;
  status: "pending" | "running" | "waiting" | "done" | "failed" | "stopped";
  dependsOn?: string[];
  executionMode?: "dag";
  generationId?: string;
  /** Adobe 非同步工作 id（修圖／時間軸算圖）；與 generationId 同語義：有 id 表示已送出、供應商在跑 */
  adobeJobId?: string;
}

export type AgentDagStatus = "running" | "waiting" | "done" | "failed";

export interface AgentDagProgress {
  status: AgentDagStatus;
  nextIndex: number;
  reason?: string;
}

export function dagStepId(step: Pick<AgentDagStep, "id">, index: number): string {
  return step.id?.trim() || `step-${index + 1}`;
}

export function usesDagExecution(steps: AgentDagStep[]): boolean {
  return steps.some((step) => step.executionMode === "dag");
}

function dependenciesFor(steps: AgentDagStep[], index: number): string[] {
  if (usesDagExecution(steps)) return steps[index].dependsOn ?? [];
  return index > 0 ? [dagStepId(steps[index - 1], index - 1)] : [];
}

function dependencyRows(steps: AgentDagStep[], index: number): Array<AgentDagStep | undefined> {
  const byId = new Map(steps.map((step, stepIndex) => [dagStepId(step, stepIndex), step]));
  return dependenciesFor(steps, index).map((id) => byId.get(id));
}

export function isDagStepRunnable(steps: AgentDagStep[], index: number): boolean {
  const step = steps[index];
  if (!step || step.status !== "pending") return false;
  const dependencies = dependencyRows(steps, index);
  return dependencies.every((dependency) => dependency?.status === "done");
}

/**
 * Chooses one safe unit of work for this tick.
 *
 * New runnable work is preferred over polling already-submitted generations.
 * This lets independent generation branches all be submitted across successive
 * ticks, after which their provider jobs progress concurrently.
 */
export function selectAgentDagStep(steps: AgentDagStep[]): number {
  const runnable = listRunnableDagSteps(steps);
  if (runnable.length) return runnable[0]!;
  return steps.findIndex((step) => step.status === "running");
}

/** 本輪所有可安全啟動的 pending 步驟（多代理並行：獨立支線可同輪送出） */
export function listRunnableDagSteps(steps: AgentDagStep[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < steps.length; index++) {
    if (isDagStepRunnable(steps, index)) out.push(index);
  }
  return out;
}

/** 已送出、供應商仍在跑的生成步驟索引（長任務：多支線同時 in-flight） */
export function listInFlightGenerationSteps(steps: AgentDagStep[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step?.status === "running" && step.generationId) out.push(index);
  }
  return out;
}

/** 已送出、Adobe 仍在跑的修圖／時間軸算圖步驟索引 */
export function listInFlightAdobeSteps(steps: AgentDagStep[]): number[] {
  const out: number[] = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    if (step?.status === "running" && step.adobeJobId) out.push(index);
  }
  return out;
}

export function evaluateAgentDag(steps: AgentDagStep[]): AgentDagProgress {
  if (steps.length === 0 || steps.every((step) => step.status === "done")) {
    return { status: "done", nextIndex: steps.length };
  }
  const failedIndex = steps.findIndex((step) => step.status === "failed");
  if (failedIndex >= 0) {
    return { status: "failed", nextIndex: failedIndex, reason: steps[failedIndex].note };
  }
  const nextIndex = selectAgentDagStep(steps);
  if (nextIndex >= 0) return { status: "running", nextIndex };

  const pendingIndexes = steps
    .map((step, index) => step.status === "pending" ? index : -1)
    .filter((index) => index >= 0);
  const hasWaiting = steps.some((step) => step.status === "waiting");
  if (hasWaiting) {
    return {
      status: "waiting",
      nextIndex: steps.findIndex((step) => step.status === "waiting"),
    };
  }
  if (pendingIndexes.length) {
    const blocked = pendingIndexes[0];
    const dependencies = dependenciesFor(steps, blocked);
    return {
      status: "failed",
      nextIndex: blocked,
      reason: dependencies.length
        ? `依賴無法完成：${dependencies.join("、")}`
        : "沒有可執行的步驟",
    };
  }

  // A stopped run is handled by the caller; reaching here means no remaining
  // work can be scheduled, so the persisted execution is terminal.
  return { status: "done", nextIndex: steps.length };
}

export function stopPendingDagSteps(steps: AgentDagStep[]): void {
  for (const step of steps) {
    if (step.status === "pending" || step.status === "waiting") step.status = "stopped";
    // 已送出的生成／Adobe 工作允許自然結算；沒有外部工作 id 的 running 才立即收停
    if (step.status === "running" && !step.generationId && !step.adobeJobId) step.status = "stopped";
  }
}
