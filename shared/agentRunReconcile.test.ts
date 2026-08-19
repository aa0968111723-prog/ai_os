import { describe, expect, it } from "vitest";
import {
  applyIndependentGenerateToSteps,
  discardUnstartedAwaitingApprovalAfterIndependentGenerate,
  leftoverAwaitingApprovalIdsToDiscard,
  shouldDiscardLeftoverAwaitingApprovalOnRead,
  type ReconcileAgentStep,
} from "./agentRunReconcile";

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

describe("discardUnstartedAwaitingApprovalAfterIndependentGenerate", () => {
  it("hides leftover 0/6 待你過目 after studio generateInto", () => {
    const parked = applyIndependentGenerateToSteps({
      steps: six,
      sceneId: "shot-1",
      sceneNo: 1,
      generationId: "gen-qwen",
      adopted: false,
    });
    const out = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: "awaiting_approval",
      steps: parked.steps,
      independentGenerateLanded: true,
    });
    expect(out.discarded).toBe(true);
    expect(out.status).toBe("discarded");
    expect(out.steps.every((s) => s.status === "stopped")).toBe(true);
  });

  it("discards even when scene matching missed, as long as the 6-step never started", () => {
    const out = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: "awaiting_approval",
      steps: six,
      independentGenerateLanded: true,
    });
    expect(out.discarded).toBe(true);
    expect(out.status).toBe("discarded");
  });

  it("stops kindless leftover 0/6 steps after generateInto (live 停 leftover)", () => {
    const kindless = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "",
      status: "pending",
      note: n === 1 ? "第 1 鏡「小華躺在床上」生成畫面" : `第 ${n} 鏡生成畫面`,
    }));
    const out = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: "awaiting_approval",
      steps: kindless,
      independentGenerateLanded: true,
    });
    expect(out.discarded).toBe(true);
    expect(out.status).toBe("discarded");
    expect(out.steps.every((s) => s.status === "stopped")).toBe(true);
    expect(out.steps[0]?.detail).toMatch(/單格工作室已先生成/);
  });

  it("stops generate_image leftover 0/6 steps after generateInto", () => {
    const imageKind = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "generate_image",
      status: "pending",
      note: n === 1 ? "第 1 鏡「小華躺在床上」生成畫面" : `第 ${n} 鏡生成畫面`,
    }));
    const out = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: "awaiting_approval",
      steps: imageKind,
      independentGenerateLanded: true,
    });
    expect(out.discarded).toBe(true);
    expect(out.steps.every((s) => s.status === "stopped")).toBe(true);
  });

  it("stops generate_image leftover 0/6 even when notes omit 第 N 鏡 / 生成畫面", () => {
    const imageKind = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "generate_image",
      status: "pending",
      note: `生成主視覺 ${n}`,
    }));
    const out = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: "awaiting_approval",
      steps: imageKind,
      independentGenerateLanded: true,
    });
    expect(out.discarded).toBe(true);
    expect(out.steps.every((s) => s.status === "stopped")).toBe(true);
  });

  it("stops kindless leftover 0/6 even when notes omit 第 N 鏡 / 生成畫面", () => {
    const kindless = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "",
      status: "pending",
      note: `出圖 ${n}`,
    }));
    const out = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: "awaiting_approval",
      steps: kindless,
      independentGenerateLanded: true,
    });
    expect(out.discarded).toBe(true);
    expect(out.steps.every((s) => s.status === "stopped")).toBe(true);
  });

  it("leaves a running leftover plan alone", () => {
    const out = discardUnstartedAwaitingApprovalAfterIndependentGenerate({
      status: "running",
      steps: six,
      independentGenerateLanded: true,
    });
    expect(out.discarded).toBe(false);
    expect(out.status).toBe("running");
  });
});

describe("shouldDiscardLeftoverAwaitingApprovalOnRead", () => {
  const created = "2026-08-18T12:00:00.000Z";

  it("hides leftover 0/6 待你過目 on reload after a later studio visual", () => {
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "awaiting_approval",
      steps: six,
      runCreatedAt: created,
      latestDoneVisualAt: "2026-08-18T13:00:00.000Z",
    })).toBe(true);
  });

  it("hides leftover 0/6 even when the batch is newer than existing images", () => {
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "awaiting_approval",
      steps: six,
      runCreatedAt: "2026-08-18T14:00:00.000Z",
      latestDoneVisualAt: created,
    })).toBe(true);
  });

  it("leaves a running leftover plan alone; unstarted 0/6 with no visual still hides", () => {
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "running",
      steps: six,
      runCreatedAt: created,
      latestDoneVisualAt: "2026-08-18T13:00:00.000Z",
    })).toBe(false);
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "awaiting_approval",
      steps: six,
      runCreatedAt: created,
      latestDoneVisualAt: null,
    })).toBe(true);
  });

  it("hides leftover 0/6 even when steps omit kind: generate", () => {
    const kindless = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "",
      status: "pending",
      note: n === 1 ? "第 1 鏡「小華躺在床上」生成畫面" : `第 ${n} 鏡生成畫面`,
    }));
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "awaiting_approval",
      steps: kindless,
      runCreatedAt: "2026-08-18T14:00:00.000Z",
      latestDoneVisualAt: created,
      hasCurrentVisual: true,
    })).toBe(true);
  });

  it("hides leftover 0/6 when steps use generate_image instead of generate", () => {
    const imageKind = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "generate_image",
      status: "pending",
      note: n === 1 ? "第 1 鏡「小華躺在床上」生成畫面" : `第 ${n} 鏡生成畫面`,
    }));
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "awaiting_approval",
      steps: imageKind,
      runCreatedAt: "2026-08-18T14:00:00.000Z",
      latestDoneVisualAt: created,
      hasCurrentVisual: true,
    })).toBe(true);
  });

  it("hides leftover 0/6 generate_image / kindless when notes omit 第 N 鏡 / 生成畫面", () => {
    const imageKind = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "generate_image",
      status: "pending",
      note: `生成主視覺 ${n}`,
    }));
    const kindless = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "",
      status: "pending",
      note: `出圖 ${n}`,
    }));
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "awaiting_approval",
      steps: imageKind,
      runCreatedAt: "2026-08-18T14:00:00.000Z",
      latestDoneVisualAt: created,
      hasCurrentVisual: true,
    })).toBe(true);
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "awaiting_approval",
      steps: kindless,
      runCreatedAt: "2026-08-18T14:00:00.000Z",
      latestDoneVisualAt: created,
      hasCurrentVisual: true,
    })).toBe(true);
  });

  it("clears leftover 0/6 after auto-現用 even when the batch is newer than the gen", () => {
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "awaiting_approval",
      steps: six,
      runCreatedAt: "2026-08-18T14:00:00.000Z",
      latestDoneVisualAt: created,
      hasCurrentVisual: true,
    })).toBe(true);
    expect(shouldDiscardLeftoverAwaitingApprovalOnRead({
      status: "running",
      steps: six,
      runCreatedAt: "2026-08-18T14:00:00.000Z",
      latestDoneVisualAt: created,
      hasCurrentVisual: true,
    })).toBe(false);
  });
});

describe("leftoverAwaitingApprovalIdsToDiscard", () => {
  it("drops leftover 0/6 when batchGenerate mints a different plan, keeps the reused fingerprint", () => {
    const leftover = { id: "old-0n", status: "awaiting_approval" as const, steps: six };
    const reused = { id: "same-fp", status: "awaiting_approval" as const, steps: six };
    const running = {
      id: "running",
      status: "running" as const,
      steps: six.map((step) => ({ ...step, status: "running" })),
    };
    expect(leftoverAwaitingApprovalIdsToDiscard({
      keepRunId: reused.id,
      runs: [leftover, reused, running],
    })).toEqual(["old-0n"]);
    expect(leftoverAwaitingApprovalIdsToDiscard({
      runs: [leftover, reused],
    })).toEqual(["old-0n", "same-fp"]);
  });
});
