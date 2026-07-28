import { describe, expect, it } from "vitest";
import { applyHumanTaskWake } from "./taskCore";

const task = {
  id: "6b63ac17-204f-4f8e-a8e3-66f8cbc724b8",
  title: "確認人員名單",
  taskType: "task" as const,
};

describe("human task wake state machine", () => {
  it("continues after the exact waiting task completes", () => {
    const result = applyHumanTaskWake([
      { id: "wait-people", note: "等待名單", status: "waiting", taskId: task.id },
      { id: "next", note: "產生素材", status: "pending" },
    ], 0, "wait-people", task, false);
    expect(result.matched).toBe(true);
    expect(result.status).toBe("running");
    expect(result.currentStep).toBe(1);
    expect(result.steps[0]).toMatchObject({ status: "done", detail: "人員已完成任務" });
    expect(result.steps[1].status).toBe("pending");
  });

  it("finishes the run when the final human task completes", () => {
    const result = applyHumanTaskWake([
      { id: "wait-people", note: "等待名單", status: "waiting", taskId: task.id },
    ], 0, "wait-people", task, false);
    expect(result.status).toBe("done");
    expect(result.currentStep).toBe(1);
  });

  it("fails closed on rejection and stops the remaining plan", () => {
    const result = applyHumanTaskWake([
      { id: "approval", note: "核准主視覺", status: "waiting", taskId: task.id },
      { id: "publish", note: "發布", status: "pending" },
    ], 0, "approval", { ...task, taskType: "approval" }, true);
    expect(result.status).toBe("failed");
    expect(result.currentStep).toBe(0);
    expect(result.error).toContain("未通過");
    expect(result.steps.map((step) => step.status)).toEqual(["failed", "stopped"]);
  });

  it("does not wake a different step or task", () => {
    const result = applyHumanTaskWake([
      { id: "wait-other", note: "等待", status: "waiting", taskId: "other-task" },
    ], 0, "wait-people", task, false);
    expect(result.matched).toBe(false);
    expect(result.steps[0].status).toBe("waiting");
  });
});
