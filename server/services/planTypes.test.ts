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

  it("rejects duplicate milestone identifiers", () => {
    expect(completePlanSchema.safeParse({
      summary: {
        ...summary,
        milestones: [
          { id: "same", title: "第一階段" },
          { id: "same", title: "第二階段" },
        ],
      },
      steps: [{
        id: "checkpoint",
        kind: "checkpoint",
        title: "檢查",
        status: "draft",
        actorType: "system",
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

  // ── 決策軌跡（PR-1）：summary.rationale / contextUsed 與步驟 rationale ──

  it("accepts structured decision-trace fields on summary and steps", () => {
    const parsed = completePlanSchema.parse({
      summary: {
        ...summary,
        rationale: "腳本已齊、日期已定，先拆分鏡再生成即可交付，不需額外排程。",
        contextUsed: ["專案世界觀", "專案知識庫節錄", "分鏡現況"],
      },
      steps: [{
        id: "note",
        kind: "create_note",
        title: "整理拍攝重點",
        rationale: "把散落的企劃資訊集中，後續步驟才有共同依據。",
        status: "draft",
        actorType: "ai",
      }],
    });
    expect(parsed.summary.rationale).toContain("先拆分鏡");
    expect(parsed.summary.contextUsed).toEqual(["專案世界觀", "專案知識庫節錄", "分鏡現況"]);
    expect(parsed.steps[0].rationale).toContain("共同依據");
  });

  it("keeps legacy plans without decision-trace fields parseable", () => {
    const parsed = completePlanSummarySchema.parse(summary);
    expect(parsed.rationale).toBeUndefined();
    expect(parsed.contextUsed).toBeUndefined();
  });

  it("rejects oversized or overlong decision-trace fields", () => {
    expect(completePlanSummarySchema.safeParse({
      ...summary,
      rationale: "長".repeat(501),
    }).success).toBe(false);
    expect(completePlanSummarySchema.safeParse({
      ...summary,
      contextUsed: Array.from({ length: 31 }, (_, i) => `區塊${i}`),
    }).success).toBe(false);
    expect(completePlanSummarySchema.safeParse({
      ...summary,
      contextUsed: ["超".repeat(61)],
    }).success).toBe(false);
    expect(completePlanSchema.safeParse({
      summary,
      steps: [{
        id: "note",
        kind: "create_note",
        title: "整理拍攝重點",
        rationale: "長".repeat(301),
        status: "draft",
        actorType: "ai",
      }],
    }).success).toBe(false);
  });

  // ── CA-01：generate 步驟定裝／場景／來源欄位 ──

  it("accepts generate step with characterIds / scenePresetIds / sourceAssetId / sourceUrl", () => {
    const parsed = completePlanSchema.parse({
      summary,
      steps: [{
        id: "gen",
        kind: "generate",
        title: "定裝圖生圖",
        status: "pending",
        actorType: "ai",
        modelId: "fal-ai/flux/dev/image-to-image",
        prompt: "暖色清晨",
        characterIds: ["55555555-5555-4555-8555-555555555555"],
        scenePresetIds: ["66666666-6666-4666-8666-666666666666"],
        sourceAssetId: "77777777-7777-4777-8777-777777777777",
        sourceUrl: "https://cdn.example.com/ref.png",
      }],
    });
    const step = parsed.steps[0];
    expect(step.characterIds).toEqual(["55555555-5555-4555-8555-555555555555"]);
    expect(step.scenePresetIds).toEqual(["66666666-6666-4666-8666-666666666666"]);
    expect(step.sourceAssetId).toBe("77777777-7777-4777-8777-777777777777");
    expect(step.sourceUrl).toBe("https://cdn.example.com/ref.png");
  });

  it("still parses legacy generate step without CA-01 fields", () => {
    const parsed = completePlanSchema.parse({
      summary,
      steps: [{
        id: "legacy-gen",
        kind: "generate",
        title: "舊版生成步驟",
        status: "pending",
        actorType: "ai",
        modelId: "fal-ai/fast-lightning-sdxl",
        prompt: "城市微光主視覺",
      }],
    });
    expect(parsed.steps[0].characterIds).toBeUndefined();
    expect(parsed.steps[0].scenePresetIds).toBeUndefined();
    expect(parsed.steps[0].sourceAssetId).toBeUndefined();
    expect(parsed.steps[0].sourceUrl).toBeUndefined();
    expect(parsed.steps[0].prompt).toBe("城市微光主視覺");
  });
});
