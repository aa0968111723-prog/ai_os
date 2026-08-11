import { describe, expect, it } from "vitest";
import {
  agentDagStatusKey,
  evaluateAgentDag,
  isDagStepRunnable,
  layoutAgentDag,
  listInFlightAdobeSteps,
  listInFlightGenerationSteps,
  listRunnableDagSteps,
  selectAgentDagStep,
  stopPendingDagSteps,
  validateAgentDag,
  type AgentDagStep,
} from "./agentDag";

function step(
  id: string,
  status: AgentDagStep["status"] = "pending",
  dependsOn?: string[],
): AgentDagStep {
  return { id, note: id, status, dependsOn, executionMode: "dag" };
}

describe("agent DAG scheduler", () => {
  it("runs independent branches while another branch waits for a human", () => {
    const steps = [
      step("task", "done"),
      step("wait", "waiting", ["task"]),
      step("visual", "pending"),
      step("publish", "pending", ["wait", "visual"]),
    ];
    expect(isDagStepRunnable(steps, 2)).toBe(true);
    expect(selectAgentDagStep(steps)).toBe(2);
    expect(evaluateAgentDag(steps)).toEqual({ status: "running", nextIndex: 2 });
  });

  it("submits a second independent branch before polling an in-flight generation", () => {
    const steps = [
      { ...step("visual-a", "running"), generationId: "gen-a" },
      step("visual-b", "pending"),
    ];
    expect(selectAgentDagStep(steps)).toBe(1);
    expect(listRunnableDagSteps(steps)).toEqual([1]);
    expect(listInFlightGenerationSteps(steps)).toEqual([0]);
  });

  it("lists multiple independent runnable branches for multi-agent parallel start", () => {
    const steps = [
      step("a", "pending"),
      step("b", "pending"),
      step("c", "pending", ["a"]),
    ];
    expect(listRunnableDagSteps(steps)).toEqual([0, 1]);
  });

  it("moves to waiting only when no independent work remains", () => {
    const steps = [
      step("wait", "waiting"),
      step("after", "pending", ["wait"]),
    ];
    expect(evaluateAgentDag(steps)).toEqual({ status: "waiting", nextIndex: 0 });
  });

  it("fails closed on an unsatisfied dependency instead of hanging forever", () => {
    const result = evaluateAgentDag([step("blocked", "pending", ["missing"])]);
    expect(result.status).toBe("failed");
    expect(result.reason).toContain("missing");
  });

  it("preserves legacy linear execution for plans without a DAG marker", () => {
    const steps: AgentDagStep[] = [
      { id: "one", note: "one", status: "pending" },
      { id: "two", note: "two", status: "pending" },
    ];
    expect(isDagStepRunnable(steps, 0)).toBe(true);
    expect(isDagStepRunnable(steps, 1)).toBe(false);
  });

  it("stops queued and waiting work but lets submitted generations settle", () => {
    const steps = [
      step("queued"),
      step("waiting", "waiting"),
      { ...step("generation", "running"), generationId: "gen" },
      step("db", "running"),
    ];
    stopPendingDagSteps(steps);
    expect(steps.map((item) => item.status)).toEqual(["stopped", "stopped", "running", "stopped"]);
  });
});

describe("validateAgentDag / layoutAgentDag (PR-3)", () => {
  it("detects empty, missing dependency, cycle, and duplicate id", () => {
    expect(validateAgentDag([]).code).toBe("empty_plan");
    expect(validateAgentDag([step("a", "pending", ["ghost"])]).code).toBe("missing_dependency");
    expect(validateAgentDag([
      step("a", "pending", ["b"]),
      step("b", "pending", ["a"]),
    ]).code).toBe("cycle_detected");
    expect(validateAgentDag([
      { id: "same", note: "x", status: "pending", executionMode: "dag" },
      { id: "same", note: "y", status: "pending", executionMode: "dag" },
    ]).code).toBe("duplicate_step_id");
    expect(validateAgentDag([step("a"), step("b", "pending", ["a"])]).ok).toBe(true);
  });

  it("lays out parallel branches on the same column", () => {
    const layout = layoutAgentDag([
      step("root", "done"),
      step("a", "running", ["root"]),
      step("b", "pending", ["root"]),
      step("join", "pending", ["a", "b"]),
    ]);
    expect(layout.nodes.find((n) => n.id === "a")?.column).toBe(
      layout.nodes.find((n) => n.id === "b")?.column,
    );
    expect(layout.edges).toHaveLength(4);
    const keyBefore = layout.topologyKey;
    const afterStatus = layoutAgentDag([
      step("root", "done"),
      step("a", "done", ["root"]),
      step("b", "running", ["root"]),
      step("join", "pending", ["a", "b"]),
    ]);
    expect(afterStatus.topologyKey).toBe(keyBefore);
    expect(agentDagStatusKey([
      step("root", "done"),
      step("a", "done", ["root"]),
    ])).not.toBe(agentDagStatusKey([
      step("root", "done"),
      step("a", "running", ["root"]),
    ]));
  });

  it("layouts 100+ steps without throwing (large-DAG smoke)", () => {
    const steps: AgentDagStep[] = [];
    for (let i = 0; i < 120; i++) {
      steps.push(step(
        `s${i}`,
        i === 0 ? "running" : "pending",
        i > 0 && i % 3 === 0 ? [`s${i - 1}`] : i > 0 ? [`s0`] : undefined,
      ));
    }
    const validation = validateAgentDag(steps);
    expect(validation.ok).toBe(true);
    const layout = layoutAgentDag(steps);
    expect(layout.nodes).toHaveLength(120);
    expect(layout.width).toBeGreaterThan(0);
  });
});

/** Adobe PR5：agentDag 對 adobeJobId 的 in-flight／收停語意。 */
describe("listInFlightAdobeSteps", () => {
  it("只回 running 且有 adobeJobId 的步驟", () => {
    const steps: AgentDagStep[] = [
      { ...step("a", "running"), adobeJobId: "job-1" },
      { ...step("b", "running"), generationId: "gen-1" },
      step("c", "pending"),
      { ...step("d", "done"), adobeJobId: "job-old" },
      step("e", "running"),
    ];
    expect(listInFlightAdobeSteps(steps)).toEqual([0]);
    expect(listInFlightGenerationSteps(steps)).toEqual([1]);
  });
});

describe("stopPendingDagSteps with adobeJobId", () => {
  it("不中斷已送出的 Adobe 工作，只收停無外部 id 的 running", () => {
    const steps: AgentDagStep[] = [
      step("pending", "pending"),
      { ...step("adobe", "running"), adobeJobId: "job-1" },
      step("bare", "running"),
      { ...step("gen", "running"), generationId: "g1" },
    ];
    stopPendingDagSteps(steps);
    expect(steps[0].status).toBe("stopped");
    expect(steps[1].status).toBe("running"); // 允許自然結算
    expect(steps[2].status).toBe("stopped");
    expect(steps[3].status).toBe("running");
  });
});
