/**
 * Adobe PR5：agentDag 對 adobeJobId 的 in-flight／收停語意。
 */
import { describe, expect, it } from "vitest";
import {
  listInFlightAdobeSteps,
  listInFlightGenerationSteps,
  stopPendingDagSteps,
  type AgentDagStep,
} from "./agentDag";

function step(partial: Partial<AgentDagStep> & Pick<AgentDagStep, "note" | "status">): AgentDagStep {
  return { ...partial, note: partial.note, status: partial.status };
}

describe("listInFlightAdobeSteps", () => {
  it("只回 running 且有 adobeJobId 的步驟", () => {
    const steps: AgentDagStep[] = [
      step({ note: "a", status: "running", adobeJobId: "job-1" }),
      step({ note: "b", status: "running", generationId: "gen-1" }),
      step({ note: "c", status: "pending" }),
      step({ note: "d", status: "done", adobeJobId: "job-old" }),
      step({ note: "e", status: "running" }),
    ];
    expect(listInFlightAdobeSteps(steps)).toEqual([0]);
    expect(listInFlightGenerationSteps(steps)).toEqual([1]);
  });
});

describe("stopPendingDagSteps with adobeJobId", () => {
  it("不中斷已送出的 Adobe 工作，只收停無外部 id 的 running", () => {
    const steps: AgentDagStep[] = [
      step({ note: "pending", status: "pending" }),
      step({ note: "adobe", status: "running", adobeJobId: "job-1" }),
      step({ note: "bare", status: "running" }),
      step({ note: "gen", status: "running", generationId: "g1" }),
    ];
    stopPendingDagSteps(steps);
    expect(steps[0].status).toBe("stopped");
    expect(steps[1].status).toBe("running"); // 允許自然結算
    expect(steps[2].status).toBe("stopped");
    expect(steps[3].status).toBe("running");
  });
});
