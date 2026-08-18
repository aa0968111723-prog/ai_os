/**
 * Independent generateInto (單格工作室) must not leave a 6-step agent-run
 * stuck at 0/6 「待你採用」with no Adopt control. Pure step math — server
 * loads rows, applies this, writes back.
 */
export interface ReconcileAgentStep {
  kind: string;
  status: string;
  note: string;
  sceneNo?: number;
  targetSceneId?: string;
  generationId?: string;
  detail?: string;
}

export interface ReconcileIndependentGenerateInput {
  steps: ReconcileAgentStep[];
  sceneId: string;
  sceneNo: number;
  generationId: string;
  adopted: boolean;
}

export interface ReconcileIndependentGenerateResult {
  steps: ReconcileAgentStep[];
  changed: boolean;
  waitForAdopt: boolean;
}

const ADOPT_PREFIX = "待你採用 · ";

function stepMatchesScene(step: ReconcileAgentStep, sceneId: string, sceneNo: number): boolean {
  if (step.kind !== "generate") return false;
  if (step.targetSceneId && step.targetSceneId === sceneId) return true;
  return step.sceneNo === sceneNo;
}

export function applyIndependentGenerateToSteps(
  input: ReconcileIndependentGenerateInput,
): ReconcileIndependentGenerateResult {
  let changed = false;
  let waitForAdopt = false;
  const steps = input.steps.map((step) => {
    if (!stepMatchesScene(step, input.sceneId, input.sceneNo)) return step;
    if (step.status === "done" || step.status === "failed" || step.status === "stopped") return step;

    const next: ReconcileAgentStep = {
      ...step,
      generationId: step.generationId || input.generationId,
      targetSceneId: step.targetSceneId || input.sceneId,
    };
    if (input.adopted) {
      next.status = "done";
      next.detail = next.detail || "單格工作室已生成並採用";
      if (next.note.startsWith(ADOPT_PREFIX)) next.note = next.note.slice(ADOPT_PREFIX.length);
    } else {
      next.status = "waiting";
      waitForAdopt = true;
      if (!next.note.startsWith(ADOPT_PREFIX)) next.note = `${ADOPT_PREFIX}${next.note}`;
      next.detail = "畫面已落地，等你採用後才會換成現用";
    }
    changed = true;
    return next;
  });
  // Independent generateInto already reserved this shot. Leave the other
  // unbilled generate steps pending and the leftover 6-step runner keeps
  // starting Fal jobs — quoted 1, wallet −3, 週/日 +1.
  if (waitForAdopt) {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      if (step.kind !== "generate") continue;
      if (stepMatchesScene(step, input.sceneId, input.sceneNo)) continue;
      if (step.generationId) continue;
      if (step.status !== "pending" && step.status !== "running") continue;
      steps[i] = {
        ...step,
        status: "waiting",
        detail: "單格工作室已先生成一鏡，其餘鏡先暫停以免重複扣點",
      };
      changed = true;
    }
  }
  return { steps, changed, waitForAdopt };
}
