import { describe, expect, it } from "vitest";
import {
  evaluateAgentDag,
  layoutAgentDag,
  listRunnableDagSteps,
  validateAgentDag,
  type AgentDagStep,
} from "../../shared/agentDag";
import { agentToolRegistry } from "./agentToolRegistry";
import { approvalSatisfied } from "./cutosStepRunner";
import {
  buildVideoEditingWorkflow,
  describeVideoWorkflow,
  parallelBranches,
} from "./cutosWorkflow";

/**
 * The multi-agent workflow must be an executable DAG, not a picture. These
 * tests drive it through the SAME solver the runner uses
 * (`shared/agentDag.ts`), so a shape that would deadlock, run out of order, or
 * skip the approval gate fails here.
 */

const GOAL = "把這支 45 分鐘的訪談剪成一支 8 分鐘精華，再找三段最適合短影音的地方。";

const input = {
  goal: GOAL,
  targetDurationMs: 8 * 60_000,
  shortCandidateCount: 3,
};

describe("video editing workflow DAG", () => {
  const steps = () => buildVideoEditingWorkflow(input);

  it("is a valid DAG the runner's own validator accepts", () => {
    const result = validateAgentDag(steps() as AgentDagStep[]);
    expect(result.ok).toBe(true);
    expect(result.code).toBe("valid");
    expect(result.issues).toEqual([]);
  });

  it("names only registered CUTOS tools", () => {
    for (const step of steps()) {
      if (step.kind !== "tool_call") continue;
      expect(step.toolId).toBeTruthy();
      expect(agentToolRegistry.has(step.toolId!), `${step.toolId} is not registered`).toBe(true);
      expect(step.toolId!.startsWith("cutos.")).toBe(true);
    }
  });

  it("covers the whole user goal from analysis to export", () => {
    const ids = steps().map((step) => step.id);
    expect(ids).toEqual(expect.arrayContaining([
      "ensure_transcript",
      "ensure_speakers",
      "ensure_topics",
      "ensure_semantic_index",
      "semantic_analyst",
      "find_highlights",
      "plan_long_cut",
      "verify_long_cut",
      "plan_short_candidates",
      "preview_long_cut",
      "approval_gate",
      "apply_long_cut",
      "instant_preview",
      "export_long_cut",
    ]));
  });

  it("starts with exactly one runnable step — the transcript", () => {
    const runnable = listRunnableDagSteps(steps() as AgentDagStep[]);
    expect(runnable).toHaveLength(1);
    expect(steps()[runnable[0]!]!.id).toBe("ensure_transcript");
  });

  it("fans out into three concurrent branches once the transcript is done", () => {
    const plan = steps() as AgentDagStep[];
    plan[0]!.status = "done";
    const runnable = listRunnableDagSteps(plan).map((index) => plan[index]!.id);
    expect(runnable.sort()).toEqual([
      "ensure_semantic_index",
      "ensure_speakers",
      "ensure_topics",
    ]);
  });

  it("keeps verification and short-form planning as siblings", () => {
    const layers = parallelBranches(steps());
    const layerOf = (id: string) => layers.findIndex((layer) => layer.includes(id));
    expect(layerOf("verify_long_cut")).toBe(layerOf("plan_short_candidates"));
  });

  it("puts the approval gate before every destructive step", () => {
    const plan = steps();
    const apply = plan.find((step) => step.id === "apply_long_cut")!;
    const exported = plan.find((step) => step.id === "export_long_cut")!;
    expect(apply.dependsOn).toContain("approval_gate");
    expect(exported.dependsOn).toContain("approval_gate");
    // And the gate itself is a human step, not something the agent can satisfy.
    const gate = plan.find((step) => step.id === "approval_gate")!;
    expect(gate.kind).toBe("request_approval");
    expect(gate.actorType).toBe("human");
  });

  it("cannot reach apply while the gate is still waiting", () => {
    const plan = steps() as AgentDagStep[];
    for (const step of plan) {
      if (step.id === "approval_gate") step.status = "waiting";
      else if (step.id !== "apply_long_cut" && step.id !== "instant_preview" && step.id !== "export_long_cut") {
        step.status = "done";
      }
    }
    const runnable = listRunnableDagSteps(plan).map((index) => plan[index]!.id);
    expect(runnable).not.toContain("apply_long_cut");
    expect(evaluateAgentDag(plan).status).toBe("waiting");
  });

  it("releases apply the moment the gate completes", () => {
    const plan = steps() as AgentDagStep[];
    for (const step of plan) {
      if (["apply_long_cut", "instant_preview", "export_long_cut"].includes(step.id!)) continue;
      step.status = "done";
    }
    const runnable = listRunnableDagSteps(plan).map((index) => plan[index]!.id);
    expect(runnable).toEqual(["apply_long_cut"]);
  });

  it("the runner's own approval check agrees with the DAG shape", () => {
    const plan = steps();
    const apply = plan.find((step) => step.id === "apply_long_cut")!;
    const dependencies = apply.dependsOn!.map((id) => {
      const dependency = plan.find((step) => step.id === id)!;
      return { id, kind: dependency.kind, status: "done" };
    });
    expect(approvalSatisfied(agentToolRegistry.get(apply.toolId!), dependencies)).toEqual({ ok: true });

    const waiting = dependencies.map((dependency) =>
      dependency.kind === "request_approval" ? { ...dependency, status: "waiting" } : dependency);
    expect(approvalSatisfied(agentToolRegistry.get(apply.toolId!), waiting).ok).toBe(false);
  });

  it("runs to completion when every step succeeds", () => {
    const plan = steps() as AgentDagStep[];
    // Drive it exactly as the runner would: repeatedly take the runnable set.
    let guard = 0;
    while (plan.some((step) => step.status === "pending") && guard < 50) {
      const runnable = listRunnableDagSteps(plan);
      expect(runnable.length).toBeGreaterThan(0);
      for (const index of runnable) plan[index]!.status = "done";
      guard += 1;
    }
    expect(plan.every((step) => step.status === "done")).toBe(true);
    expect(evaluateAgentDag(plan).status).toBe("done");
    // Fewer scheduling layers than steps: the fan-out really is concurrent.
    expect(guard).toBeLessThan(plan.length);
  });

  it("stops the dependent branch when the plan step fails", () => {
    const plan = steps() as AgentDagStep[];
    for (const step of plan) {
      if (["ensure_transcript", "ensure_speakers", "ensure_topics", "ensure_semantic_index", "semantic_analyst", "find_highlights"].includes(step.id!)) {
        step.status = "done";
      }
    }
    plan.find((step) => step.id === "plan_long_cut")!.status = "failed";
    const progress = evaluateAgentDag(plan);
    expect(progress.status).toBe("failed");
    // Nothing downstream became runnable.
    expect(listRunnableDagSteps(plan)).toEqual([]);
  });

  it("passes the target durations through to the right tools", () => {
    const plan = buildVideoEditingWorkflow({ ...input, shortDurationMs: 30_000 });
    const long = plan.find((step) => step.id === "find_highlights")!;
    const shorts = plan.find((step) => step.id === "plan_short_candidates")!;
    expect(long.toolInput?.targetDurationMs).toBe(8 * 60_000);
    expect(shorts.toolInput?.targetDurationMs).toBe(30_000);
    expect(shorts.toolInput?.limit).toBe(3);
  });

  it("can omit export when the user only wants the timeline updated", () => {
    const plan = buildVideoEditingWorkflow({ ...input, includeExport: false });
    expect(plan.map((step) => step.id)).not.toContain("export_long_cut");
    expect(validateAgentDag(plan as AgentDagStep[]).ok).toBe(true);
  });

  it("is renderable as a graph without inventing edges", () => {
    const layout = layoutAgentDag(steps() as AgentDagStep[]);
    expect(layout.nodes).toHaveLength(14);
    const ids = new Set(layout.nodes.map((node) => node.id));
    for (const edge of layout.edges) {
      expect(ids.has(edge.fromId)).toBe(true);
      expect(ids.has(edge.toId)).toBe(true);
    }
  });

  it("summarizes the plan in zh-TW", () => {
    const summary = describeVideoWorkflow(input, steps());
    expect(summary).toContain("8 分鐘");
    expect(summary).toContain("3 段");
    expect(summary).toContain("需要你確認");
    expect(summary).not.toMatch(/[a-z]{6,}/);
  });

  it("gives every step a rationale that is a decision, not chain-of-thought", () => {
    for (const step of steps()) {
      expect(step.rationale, `${step.id} has no rationale`).toBeTruthy();
      expect(step.rationale!.length).toBeLessThan(120);
      // A rationale states why the step exists; it must not narrate reasoning.
      expect(step.rationale).not.toMatch(/我認為|讓我想想|first, I|step 1:/i);
    }
  });
});
