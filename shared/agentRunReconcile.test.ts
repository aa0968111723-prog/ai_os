import { describe, expect, it } from "vitest";
import { applyIndependentGenerateToSteps, type ReconcileAgentStep } from "./agentRunReconcile";

const six: ReconcileAgentStep[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  kind: "generate",
  status: "pending",
  note: `第 ${n} 鏡「鏡${n}」生成畫面`,
  sceneNo: n,
}));

describe("applyIndependentGenerateToSteps", () => {
  it("attaches generateInto on shot 1 and waits for Adopt without finishing the other 5", () => {
    const out = applyIndependentGenerateToSteps({
      steps: six,
      sceneId: "shot-1",
      sceneNo: 1,
      generationId: "gen-qwen",
      adopted: false,
    });
    expect(out.changed).toBe(true);
    expect(out.waitForAdopt).toBe(true);
    expect(out.steps[0]).toMatchObject({
      status: "waiting",
      generationId: "gen-qwen",
      targetSceneId: "shot-1",
      note: "待你採用 · 第 1 鏡「鏡1」生成畫面",
    });
    expect(out.steps.slice(1).every((s) => s.status === "waiting" && !s.generationId)).toBe(true);
    expect(out.steps.slice(1).every((s) => s.detail?.includes("以免重複扣點"))).toBe(true);
  });

  it("marks the matching step done when the pointer already moved (auto-adopt / explicit Adopt)", () => {
    const out = applyIndependentGenerateToSteps({
      steps: six,
      sceneId: "shot-1",
      sceneNo: 1,
      generationId: "gen-qwen",
      adopted: true,
    });
    expect(out.waitForAdopt).toBe(false);
    expect(out.steps[0]?.status).toBe("done");
    expect(out.steps[0]?.note).toBe("第 1 鏡「鏡1」生成畫面");
  });

  it("matches targetSceneId even when sceneNo drifted", () => {
    const out = applyIndependentGenerateToSteps({
      steps: [{ kind: "generate", status: "running", note: "生成畫面", sceneNo: 99, targetSceneId: "shot-1" }],
      sceneId: "shot-1",
      sceneNo: 1,
      generationId: "gen-2",
      adopted: false,
    });
    expect(out.steps[0]?.status).toBe("waiting");
    expect(out.steps[0]?.generationId).toBe("gen-2");
  });

  it("leaves non-generate steps and finished generate steps alone", () => {
    const steps: ReconcileAgentStep[] = [
      { kind: "split_script", status: "done", note: "拆腳本" },
      { kind: "generate", status: "done", note: "第 1 鏡", sceneNo: 1, generationId: "old" },
    ];
    const out = applyIndependentGenerateToSteps({
      steps,
      sceneId: "shot-1",
      sceneNo: 1,
      generationId: "new",
      adopted: false,
    });
    expect(out.changed).toBe(false);
    expect(out.steps[1]?.generationId).toBe("old");
  });
});
