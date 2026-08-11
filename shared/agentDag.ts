/**
 * 代理步驟 DAG 的求解規則（純函式、零相依）。
 *
 * 位置為何在 `shared/` 而不是 `server/services/`：ADR-009 規定 `client/**` 不得
 * import `server/**`，而前端要把步驟依賴畫成時間軸（哪幾步平行、哪幾步被前一步
 * 連坐擋住）就必須跑同一套求解規則。規則複製到前端會分岔——同一份 dependsOn 在
 * 後端算出「被擋住」、前端畫成「等待中」是遲早的事。故改放 shared 讓兩端共用同
 * 一份實作，`shared/agentDag.test.ts` 是它唯一的行為契約。
 *
 * 這裡只做「依賴關係 → 誰可以跑」的推導，不碰資料庫、不碰執行；實際推進由
 * `server/services/agentRunner.ts` 負責。
 */
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

/* ── PR-3：validation + layout for interactive canvas ── */

export const AGENT_DAG_STEP_STATUSES = [
  "pending",
  "running",
  "waiting",
  "done",
  "failed",
  "stopped",
] as const;

export type AgentDagStepStatus = (typeof AGENT_DAG_STEP_STATUSES)[number];

export type AgentDagValidationCode =
  | "valid"
  | "empty_plan"
  | "missing_dependency"
  | "cycle_detected"
  | "duplicate_step_id"
  | "unsupported_status";

export interface AgentDagValidationIssue {
  code: Exclude<AgentDagValidationCode, "valid">;
  message: string;
  stepId?: string;
  detail?: string;
}

export interface AgentDagValidationResult {
  ok: boolean;
  code: AgentDagValidationCode;
  issues: AgentDagValidationIssue[];
}

/** Large-DAG threshold: still render graph, but skip expensive per-node chrome. */
export const AGENT_DAG_LARGE_STEP_THRESHOLD = 100;

const KNOWN_STATUS = new Set<string>(AGENT_DAG_STEP_STATUSES);

/**
 * Fail-closed validation before canvas render.
 * Does not mutate steps; canvas must not invent edges for missing deps / cycles.
 */
export function validateAgentDag(steps: readonly AgentDagStep[]): AgentDagValidationResult {
  const issues: AgentDagValidationIssue[] = [];
  if (!steps.length) {
    return {
      ok: false,
      code: "empty_plan",
      issues: [{ code: "empty_plan", message: "這份計畫沒有任何步驟" }],
    };
  }

  const ids = steps.map((step, index) => dagStepId(step, index));
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      issues.push({
        code: "duplicate_step_id",
        message: `步驟代號重複：「${id}」`,
        stepId: id,
      });
    }
    seen.add(id);
  }

  const idSet = new Set(ids);
  steps.forEach((step, index) => {
    const id = ids[index]!;
    const status = step.status as string;
    if (!KNOWN_STATUS.has(status)) {
      issues.push({
        code: "unsupported_status",
        message: `步驟「${id}」狀態無法辨識`,
        stepId: id,
        detail: status,
      });
    }
    for (const dep of step.dependsOn ?? []) {
      if (!idSet.has(dep)) {
        issues.push({
          code: "missing_dependency",
          message: `步驟「${id}」依賴不存在的前置「${dep}」`,
          stepId: id,
          detail: dep,
        });
      }
    }
  });

  // Cycle detection (only among known ids)
  const graph = new Map<string, string[]>();
  for (let i = 0; i < steps.length; i++) {
    const id = ids[i]!;
    const deps = (steps[i]!.dependsOn ?? []).filter((d) => idSet.has(d));
    graph.set(id, deps);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycleHit = (node: string): boolean => {
    if (visited.has(node)) return false;
    if (visiting.has(node)) return true;
    visiting.add(node);
    for (const dep of graph.get(node) ?? []) {
      if (cycleHit(dep)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const id of ids) {
    if (cycleHit(id)) {
      issues.push({
        code: "cycle_detected",
        message: "步驟依賴形成迴圈，無法安全排程",
        stepId: id,
      });
      break;
    }
  }

  if (issues.some((i) => i.code === "duplicate_step_id")) {
    return { ok: false, code: "duplicate_step_id", issues };
  }
  if (issues.some((i) => i.code === "cycle_detected")) {
    return { ok: false, code: "cycle_detected", issues };
  }
  if (issues.some((i) => i.code === "missing_dependency")) {
    return { ok: false, code: "missing_dependency", issues };
  }
  // unsupported_status is non-fatal for structure — canvas can paint "unknown"
  if (issues.length && issues.every((i) => i.code === "unsupported_status")) {
    return { ok: true, code: "unsupported_status", issues };
  }
  return { ok: true, code: "valid", issues };
}

export interface AgentDagLayoutNode {
  id: string;
  index: number;
  /** Column (dependency depth, 0 = roots). */
  column: number;
  /** Row within column. */
  row: number;
  /** Pixel center for SVG (deterministic pure layout). */
  x: number;
  y: number;
  label: string;
  status: string;
  dependsOn: string[];
  depCount: number;
}

export interface AgentDagLayoutEdge {
  fromId: string;
  toId: string;
}

export interface AgentDagLayout {
  nodes: AgentDagLayoutNode[];
  edges: AgentDagLayoutEdge[];
  width: number;
  height: number;
  /** Topology fingerprint — recompute layout only when this changes. */
  topologyKey: string;
}

const COL_GAP = 160;
const ROW_GAP = 72;
const PAD_X = 48;
const PAD_Y = 40;

/**
 * Layered left-to-right layout from dependsOn depth.
 * Pure function: same topology → same coordinates (status changes must not re-layout).
 */
export function layoutAgentDag(steps: readonly AgentDagStep[]): AgentDagLayout {
  const ids = steps.map((step, index) => dagStepId(step, index));
  const idSet = new Set(ids);
  const depthMemo = new Map<string, number>();

  const depthOf = (id: string, stack: Set<string>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (stack.has(id)) return 0; // cycle: treat as root for layout only
    stack.add(id);
    const index = ids.indexOf(id);
    const deps = (index >= 0 ? steps[index]?.dependsOn ?? [] : []).filter((d) => idSet.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map((dep) => depthOf(dep, stack))) : 0;
    stack.delete(id);
    depthMemo.set(id, d);
    return d;
  };

  const columns = new Map<number, string[]>();
  ids.forEach((id) => {
    const col = depthOf(id, new Set());
    const list = columns.get(col) ?? [];
    list.push(id);
    columns.set(col, list);
  });

  const nodes: AgentDagLayoutNode[] = [];
  let maxCol = 0;
  let maxRow = 0;
  for (const [col, colIds] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    maxCol = Math.max(maxCol, col);
    colIds.forEach((id, row) => {
      maxRow = Math.max(maxRow, row);
      const index = ids.indexOf(id);
      const step = steps[index]!;
      const dependsOn = (step.dependsOn ?? []).filter((d) => idSet.has(d));
      nodes.push({
        id,
        index,
        column: col,
        row,
        x: PAD_X + col * COL_GAP,
        y: PAD_Y + row * ROW_GAP,
        label: (step as AgentDagStep & { title?: string }).title?.trim()
          || step.note
          || id,
        status: step.status,
        dependsOn,
        depCount: dependsOn.length,
      });
    });
  }

  const edges: AgentDagLayoutEdge[] = [];
  for (const node of nodes) {
    for (const fromId of node.dependsOn) {
      edges.push({ fromId, toId: node.id });
    }
  }

  const topologyKey = ids
    .map((id, i) => `${id}>${(steps[i]?.dependsOn ?? []).join(",")}`)
    .join("|");

  return {
    nodes,
    edges,
    width: PAD_X * 2 + maxCol * COL_GAP + 80,
    height: PAD_Y * 2 + maxRow * ROW_GAP + 48,
    topologyKey,
  };
}

/** Status-only patch key — layout must not recompute when only this changes. */
export function agentDagStatusKey(steps: readonly AgentDagStep[]): string {
  return steps.map((step, i) => `${dagStepId(step, i)}:${step.status}`).join("|");
}
