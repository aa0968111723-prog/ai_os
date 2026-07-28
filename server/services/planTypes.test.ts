import { describe, expect, it } from "vitest";
import {
  completePlanSchema,
  completePlanSummarySchema,
  planStepKindSchema,
} from "../../shared/plan";

const summary = {
  goal: "完成城市微光活動準備",
  successCriteria: ["物資、人員與宣傳素材都在活動前確認"],
  assumptions: ["活動日期已由使用者確認"],
  missingInformation: ["攝影器材清單仍待提供"],
  risks: [{ title: "主視覺延遲", impact: "宣傳排程順延", mitigation: "先產生文字版素材" }],
  milestones: [{ id: "ready", title: "活動準備完成", dueAt: "2026-08-08T10:00:00+08:00" }],
  estimatedPoints: 12,
  estimatedDurationMinutes: 360,
};

describe("complete plan schema", () => {
  it("accepts the complete PR A planning vocabulary", () => {
    for (const kind of [
      "create_note",
      "append_note",
      "create_schedule",
      "update_schedule",
      "create_task",
      "wait_for_human",
      "request_approval",
      "notify",
      "checkpoint",
    ]) {
      expect(planStepKindSchema.safeParse(kind).success).toBe(true);
    }

    const parsed = completePlanSchema.parse({
      summary,
      steps: [
        {
          id: "research",
          kind: "create_note",
          title: "整理企劃重點",
          status: "draft",
          actorType: "ai",
          estimatedMinutes: 30,
          sourceRefs: [{ type: "database_file", id: "file-1", label: "城市微光企劃" }],
          milestoneId: "ready",
        },
        {
          id: "confirm",
          kind: "wait_for_human",
          title: "確認人員與器材",
          status: "blocked",
          actorType: "human",
          dependsOn: ["research"],
          dueAt: "2026-08-07T18:00:00+08:00",
          outputRefs: [{ type: "task", id: "future-task-ref" }],
          milestoneId: "ready",
        },
      ],
    });
    expect(parsed.steps[1].dependsOn).toEqual(["research"]);
  });

  it("rejects duplicate, missing and self dependencies", () => {
    const baseStep = {
      kind: "checkpoint",
      title: "里程碑",
      status: "draft",
      actorType: "system",
    } as const;
    expect(completePlanSchema.safeParse({
      summary,
      steps: [
        { ...baseStep, id: "same" },
        { ...baseStep, id: "same", dependsOn: ["missing"] },
      ],
    }).success).toBe(false);
    expect(completePlanSchema.safeParse({
      summary,
      steps: [{ ...baseStep, id: "self", dependsOn: ["self"] }],
    }).success).toBe(false);
  });

  it("rejects dependency cycles before a future DAG runner sees them", () => {
    const baseStep = {
      kind: "checkpoint",
      title: "里程碑",
      status: "draft",
      actorType: "system",
    } as const;
    expect(completePlanSchema.safeParse({
      summary,
      steps: [
        { ...baseStep, id: "a", dependsOn: ["b"] },
        { ...baseStep, id: "b", dependsOn: ["a"] },
      ],
    }).success).toBe(false);
  });

  it("requires referenced milestones and chronological step dates", () => {
    expect(completePlanSchema.safeParse({
      summary,
      steps: [{
        id: "late",
        kind: "create_schedule",
        title: "錯誤日期",
        status: "draft",
        actorType: "system",
        milestoneId: "unknown",
        startsAt: "2026-08-08T18:00:00+08:00",
        dueAt: "2026-08-08T10:00:00+08:00",
      }],
    }).success).toBe(false);
  });

  it("does not invent dates: summary permits unresolved schedule information", () => {
    const parsed = completePlanSummarySchema.parse({
      ...summary,
      milestones: [{ id: "delivery", title: "交付審核版" }],
      missingInformation: ["『星期五』的具體日期"],
    });
    expect(parsed.milestones[0].dueAt).toBeUndefined();
  });
});
