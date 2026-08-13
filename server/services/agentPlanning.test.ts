import { describe, expect, it } from "vitest";
import {
  completePlanDraftSchema,
  extractPlanJson,
  resolveCompletePlanDraft,
  summarizePlanDraftIssues,
  type PlannerAliases,
} from "./agentPlanning";

const aliases: PlannerAliases = {
  members: [{ ref: "member1", id: "11111111-1111-4111-8111-111111111111", label: "安倢" }],
  notes: [{ ref: "note1", id: "22222222-2222-4222-8222-222222222222", label: "城市微光企劃" }],
  schedules: [{ ref: "schedule1", id: "33333333-3333-4333-8333-333333333333", label: "活動執行日" }],
  tasks: [],
  databases: [{
    ref: "db1",
    id: "44444444-4444-4444-8444-444444444444",
    label: "成果資料庫",
    fields: [{ key: "title", label: "標題", type: "text" }],
  }],
  // CA-01：角色／場景／素材設定／素材庫代號
  characters: [{ ref: "char1", id: "55555555-5555-4555-8555-555555555555", label: "安倢" }],
  scenePresets: [{ ref: "preset1", id: "66666666-6666-4666-8666-666666666666", label: "暖色清晨" }],
  props: [{ ref: "prop1", id: "88888888-8888-4888-8888-888888888888", label: "紅傘" }],
  assets: [{ ref: "asset1", id: "77777777-7777-4777-8777-777777777777", label: "分鏡首格" }],
};

/** 已驗證、needs:image 的圖生圖模型（CA-01 safeModel 雙閘門） */
const NEEDS_IMAGE_MODEL = "fal-ai/flux/dev/image-to-image";

function summary() {
  return {
    goal: "完成城市微光活動前置準備",
    successCriteria: ["議題、宣傳與人員分工均確認"],
    assumptions: ["企劃筆記是目前版本"],
    missingInformation: [],
    expectedOutputs: ["活動摘要、任務、排程與核准結果"],
    risks: [{ title: "審核延誤", impact: "宣傳素材無法準時發布", mitigation: "預留一天核准時間" }],
    milestones: [{ id: "ready", title: "活動準備完成", dueAt: "2026-08-06T18:00:00+08:00" }],
    estimatedDurationMinutes: 240,
  };
}

describe("complete AI planning safety resolver", () => {
  it("resolves safe aliases into an executable cross-domain plan", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [
        {
          id: "research",
          kind: "create_note",
          title: "整理企劃重點",
          content: "依城市微光企劃整理議題、邀約、物資與攝影分工。",
          sourceRefs: ["note1"],
          milestoneId: "ready",
        },
        {
          id: "confirm",
          kind: "create_task",
          title: "確認六個議題",
          assigneeRef: "member1",
          dueAt: "2026-08-05T18:00:00+08:00",
          dependsOn: ["research"],
        },
        {
          id: "wait-confirm",
          kind: "wait_for_human",
          title: "等待議題確認",
          taskStepId: "confirm",
          dependsOn: ["confirm"],
        },
        {
          id: "rehearsal",
          kind: "create_schedule",
          title: "流程演練",
          startsAt: "2026-08-06T14:00:00+08:00",
          endsAt: "2026-08-06T16:00:00+08:00",
          ownerRef: "member1",
          dependsOn: ["wait-confirm"],
        },
        {
          id: "approval",
          kind: "request_approval",
          title: "核准宣傳內容",
          approverRole: "group_leader",
          dependsOn: ["rehearsal"],
        },
        {
          id: "record",
          kind: "record_to_database",
          title: "寫入成果資料庫",
          dbRef: "db1",
          data: { title: "活動準備完成" },
          dependsOn: ["approval"],
        },
      ],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.steps).toHaveLength(6);
    expect(plan.steps.find((step) => step.id === "confirm")?.assigneeId).toBe(aliases.members[0].id);
    expect(plan.steps.find((step) => step.id === "research")?.sourceRefs).toEqual([
      { type: "note", id: aliases.notes[0].id, label: "城市微光企劃" },
    ]);
    expect(plan.steps.find((step) => step.id === "rehearsal")?.ownerId).toBe(aliases.members[0].id);
    expect(plan.steps.find((step) => step.id === "record")?.tableId).toBe(aliases.databases[0].id);
    expect(plan.summary.estimatedPoints).toBe(0);
    expect(plan.summary.missingInformation).toEqual([]);
  });

  it("carries decision-trace rationale and contextUsed through resolution", () => {
    const draft = completePlanDraftSchema.parse({
      summary: {
        ...summary(),
        rationale: "企劃筆記已完整，先整理重點再指派確認即可，不需生成步驟。",
        contextUsed: ["專案筆記", "團隊成員", "專案筆記"],
      },
      steps: [{
        id: "research",
        kind: "create_note",
        title: "整理企劃重點",
        rationale: "先集中資訊，後續任務才有依據。",
        content: "依城市微光企劃整理議題與分工。",
        sourceRefs: ["note1"],
        milestoneId: "ready",
      }],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.summary.rationale).toContain("不需生成步驟");
    expect(plan.summary.contextUsed).toEqual(["專案筆記", "團隊成員"]);
    expect(plan.steps[0].rationale).toBe("先集中資訊，後續任務才有依據。");
  });

  it("never invents an absolute date from a vague weekday", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [
        {
          id: "brief",
          kind: "create_note",
          title: "建立活動摘要",
          content: "先整理已知活動需求。",
        },
        {
          id: "meeting",
          kind: "create_schedule",
          title: "議題熟悉會議",
          startsAt: "活動前一週星期五下午",
          dependsOn: ["brief"],
        },
      ],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.steps.map((step) => step.id)).toEqual(["brief"]);
    expect(plan.summary.missingInformation.join(" ")).toContain("含時區的確切日期時間");
  });

  it("keeps a human task unassigned when the model invents a member alias", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "task",
        kind: "create_task",
        title: "確認攝影器材",
        assigneeRef: "member99",
      }],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.steps[0].assigneeId).toBeUndefined();
    expect(plan.summary.missingInformation).toContain("找不到任務負責人代號「member99」");
  });

  it("removes an invalid schedule end time before the runner can persist it", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "meeting",
        kind: "create_schedule",
        title: "流程演練",
        startsAt: "2026-08-06T16:00:00+08:00",
        endsAt: "2026-08-06T14:00:00+08:00",
      }],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.steps[0].endsAt).toBeUndefined();
    expect(plan.summary.missingInformation.join(" ")).toContain("必須晚於開始時間");
  });

  it("drops an unknown database target and removes dependent references safely", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [
        {
          id: "bad-db",
          kind: "record_to_database",
          title: "寫入不存在資料庫",
          dbRef: "db99",
          data: { title: "x" },
        },
        {
          id: "note",
          kind: "create_note",
          title: "保留可執行成果",
          content: "安全步驟仍可執行。",
          dependsOn: ["bad-db"],
        },
      ],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.steps.map((step) => step.id)).toEqual(["note"]);
    expect(plan.steps[0].dependsOn).toBeUndefined();
    expect(plan.summary.missingInformation.join(" ")).toContain("db99");
    expect(plan.summary.missingInformation.join(" ")).toContain("依賴未能建立");
  });

  it("rejects dependency cycles before persistence", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [
        { id: "a", kind: "create_note", title: "A", content: "A", dependsOn: ["b"] },
        { id: "b", kind: "create_note", title: "B", content: "B", dependsOn: ["a"] },
      ],
    });
    expect(() => resolveCompletePlanDraft(draft, aliases)).toThrow(/循環/);
  });

  it("extracts a single JSON object from fenced model output and rejects malformed JSON", () => {
    expect(extractPlanJson("```json\n{\"summary\":{},\"steps\":[]}\n```")).toEqual({ summary: {}, steps: [] });
    expect(extractPlanJson("not json {oops}")).toBeNull();
  });

  it("summarizes validation paths for one-shot plan repair without leaking full data", () => {
    const result = completePlanDraftSchema.safeParse({ summary: {}, steps: [] });
    expect(result.success).toBe(false);
    if (result.success) return;
    const issues = summarizePlanDraftIssues(result.error);
    expect(issues.length).toBeLessThanOrEqual(12);
    expect(issues.some((issue) => issue.startsWith("summary.goal:"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("steps:"))).toBe(true);
  });

  it("rejects a 31-step draft at parse time, not only in the planner prompt", () => {
    const steps = Array.from({ length: 31 }, (_, index) => ({
      id: `n${index + 1}`,
      kind: "create_note" as const,
      title: `筆記 ${index + 1}`,
      content: "內容需超過二十個字才會通過草稿長度下限。",
    }));
    expect(completePlanDraftSchema.safeParse({ summary: summary(), steps }).success).toBe(false);
  });

  // ── CA-01：generate 代號解析＋safeModel 雙閘門 ──

  it("resolves characterRefs / scenePresetRefs / sourceAssetRef to UUIDs and sourceRefs", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "gen",
        kind: "generate",
        title: "定裝＋場景圖生圖",
        prompt: "暖色清晨的安倢站在窗邊",
        modelId: NEEDS_IMAGE_MODEL,
        characterRefs: ["char1"],
        scenePresetRefs: ["preset1"],
        propRefs: ["prop1"],
        sourceAssetRef: "asset1",
      }],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);
    const step = plan.steps[0];

    expect(plan.steps).toHaveLength(1);
    expect(step.characterIds).toEqual([aliases.characters[0].id]);
    expect(step.scenePresetIds).toEqual([aliases.scenePresets[0].id]);
    expect(step.propIds).toEqual([aliases.props[0].id]);
    expect(step.sourceAssetId).toBe(aliases.assets[0].id);
    expect(step.modelId).toBe(NEEDS_IMAGE_MODEL);

    const types = (step.sourceRefs ?? []).map((r) => r.type);
    expect(types).toContain("character");
    expect(types).toContain("scene_preset");
    expect(types).toContain("prop");
    expect(types).toContain("asset");
    expect(step.sourceRefs).toEqual(expect.arrayContaining([
      { type: "character", id: aliases.characters[0].id, label: "安倢" },
      { type: "scene_preset", id: aliases.scenePresets[0].id, label: "暖色清晨" },
      { type: "prop", id: aliases.props[0].id, label: "紅傘" },
      { type: "asset", id: aliases.assets[0].id, label: "分鏡首格" },
    ]));
    expect(plan.summary.missingInformation).toEqual([]);
  });

  it("keeps a needs model when sourceAssetRef is present (no silent downgrade)", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "img2img",
        kind: "generate",
        title: "以首格重繪",
        prompt: "把背景換成暖色清晨",
        modelId: NEEDS_IMAGE_MODEL,
        sourceAssetRef: "asset1",
      }],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0].modelId).toBe(NEEDS_IMAGE_MODEL);
    expect(plan.steps[0].sourceAssetId).toBe(aliases.assets[0].id);
    expect(plan.summary.missingInformation).toEqual([]);
  });

  it("drops a needs model without source and records sourceAssetRef in missingInformation", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "needs-no-src",
        kind: "generate",
        title: "缺來源的圖生圖",
        prompt: "改背景",
        modelId: NEEDS_IMAGE_MODEL,
      }],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.steps.map((s) => s.id)).not.toContain("needs-no-src");
    const missing = plan.summary.missingInformation.join(" ");
    expect(missing).toMatch(/來源素材|sourceAssetRef/);
  });

  it("unknown characterRefs → missingInformation; step kept without that id when model is safe", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "partial-char",
        kind: "generate",
        title: "未知角色代號",
        prompt: "一位路人在街角",
        characterRefs: ["char99", "char1"],
      }],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);
    const step = plan.steps.find((s) => s.id === "partial-char");

    expect(step).toBeDefined();
    // 已知 char1 保留；未知 char99 不寫入
    expect(step!.characterIds).toEqual([aliases.characters[0].id]);
    expect(plan.summary.missingInformation.some((m) => m.includes("char99"))).toBe(true);
    expect(plan.summary.missingInformation.some((m) => m.includes("角色定裝"))).toBe(true);
  });

  it("invalid explicit modelId → missingInformation, no silent default to another model", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "bad-model",
        kind: "generate",
        title: "指定無效模型",
        prompt: "測試無效 modelId",
        modelId: "this-model-does-not-exist-anywhere",
      }],
    });

    const plan = resolveCompletePlanDraft(draft, aliases);

    expect(plan.steps.map((s) => s.id)).not.toContain("bad-model");
    const missing = plan.summary.missingInformation.join(" ");
    expect(missing).toMatch(/模型無效|尚未通過正式生成驗證/);
    // 不得靜默塞 DEFAULT：步驟整筆 drop，而非換成其他 modelId
    expect(plan.steps.every((s) => s.modelId !== "this-model-does-not-exist-anywhere")).toBe(true);
  });
});

/**
 * A1 剪輯步驟（update_scene／reorder_scenes）：真代理路線圖「一個提示詞操作剪輯」的
 * 資料層入口。時間軸唯一真相是 scenes 表，這兩種 kind 就是代理的剪刀。
 */
describe("editing step kinds (update_scene / reorder_scenes)", () => {
  it("update_scene 的欄位完整映射進 AgentStep（prompt→scenePrompt，與 create_scene 同慣例）", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "tighten",
        kind: "update_scene",
        title: "縮短第 3 鏡",
        note: "把第 3 鏡收到 3 秒並修出點",
        sceneNo: 3,
        durationSec: 3,
        prompt: "夕陽下的教室，逆光剪影",
        ambience: "遠處蟬鳴",
        trimStartMs: 500,
        trimEndMs: 3500,
      }],
    });
    const plan = resolveCompletePlanDraft(draft, aliases);
    const step = plan.steps.find((s) => s.id === "tighten")!;
    expect(step.kind).toBe("update_scene");
    expect(step.sceneNo).toBe(3);
    expect(step.durationSec).toBe(3);
    expect(step.scenePrompt).toBe("夕陽下的教室，逆光剪影");
    expect(step.ambience).toBe("遠處蟬鳴");
    expect(step.trimStartMs).toBe(500);
    expect(step.trimEndMs).toBe(3500);
    // 免費步驟：估點 0，核准畫面不該出現幽靈點數
    expect(step.points).toBe(0);
    expect(step.actorType).toBe("ai");
  });

  it("reorder_scenes 帶完整的新順序編號；少於 2 個被 schema 擋下", () => {
    const draft = completePlanDraftSchema.parse({
      summary: summary(),
      steps: [{
        id: "resort",
        kind: "reorder_scenes",
        title: "把結尾提前",
        note: "第 3 鏡移到開頭",
        orderedSceneNos: [3, 1, 2],
      }],
    });
    const plan = resolveCompletePlanDraft(draft, aliases);
    expect(plan.steps.find((s) => s.id === "resort")?.orderedSceneNos).toEqual([3, 1, 2]);

    expect(() =>
      completePlanDraftSchema.parse({
        summary: summary(),
        steps: [{ id: "bad", kind: "reorder_scenes", title: "壞", note: "壞", orderedSceneNos: [1] }],
      }),
    ).toThrow();
  });

  it("update_scene 沒有任何刪除能力——schema 不存在 remove 類欄位（applyScript 站規：永不刪除）", () => {
    const parsed = completePlanDraftSchema.safeParse({
      summary: summary(),
      steps: [{ id: "x", kind: "remove_scene", title: "刪", note: "刪", sceneNo: 1 }],
    });
    expect(parsed.success).toBe(false);
  });
});
