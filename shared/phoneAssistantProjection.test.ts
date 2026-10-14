import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./agentEvents";
import type { AssistantActiveGoal } from "./assistantGoalFrame";
import type { AssistantInteractionRequest } from "./assistantInteractions";
import type { AssistantActionResult } from "./assistantActions";
import {
  composePhoneGoal,
  derivePhoneActionTally,
  derivePhoneCard,
  derivePhoneContextCapsule,
  derivePhoneWorkSteps,
  phoneCapabilityAffordance,
  resolvePhoneDestructiveTarget,
  MAX_PHONE_WORK_STEPS,
} from "./phoneAssistantProjection";

const event = (over: Partial<AgentEvent> & Pick<AgentEvent, "type" | "status" | "title">): AgentEvent => ({
  eventId: over.eventId ?? `e-${Math.random().toString(16).slice(2)}`,
  runId: "run-1",
  timestamp: "2026-08-17T00:00:00.000Z",
  phase: "step",
  text: over.title,
  ...over,
} as AgentEvent);

const goal = (over: Partial<AssistantActiveGoal> = {}): AssistantActiveGoal => ({
  goalId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  status: "running",
  frame: {
    intent: "MODIFY",
    operation: "UPDATE",
    objectType: "SCENE",
    scope: {},
    referents: [],
    constraints: [],
    desiredOutcome: "PERSIST_STORYBOARD",
    missingSlots: [],
    understandingConfidence: "high",
    sourceConfidence: "high",
    entityConfidence: "high",
    capabilityConfidence: "high",
  },
  resolvedSlots: {},
  missingSlots: [],
  resultRefIds: [],
  ...over,
});

describe("derivePhoneWorkSteps", () => {
  it("摺疊同一個 stepId：started 之後的 completed 覆寫同一列，不是兩列", () => {
    const steps = derivePhoneWorkSteps([
      event({ type: "tool.started", status: "running", title: "讀取目前專案", stepId: "s1" }),
      event({ type: "tool.completed", status: "ok", title: "讀取目前專案", stepId: "s1", resultCount: 12 }),
    ]);
    expect(steps).toEqual([{ key: "s1", label: "讀取目前專案", state: "done", count: 12 }]);
  });

  it("擋掉 chain-of-thought：agent.thinking 永遠不會變成一列工作階段", () => {
    const steps = derivePhoneWorkSteps([
      event({ type: "agent.thinking", status: "running", title: "正在推敲要先做哪一件", stepId: "t1" }),
      event({ type: "tool.completed", status: "ok", title: "找到第 3 幕", stepId: "s1" }),
    ]);
    expect(steps.map((s) => s.label)).toEqual(["找到第 3 幕"]);
  });

  it("resultCount 是 0 時仍顯示（找到 0 筆是有意義的答案，不是沒量到）", () => {
    const [step] = derivePhoneWorkSteps([
      event({ type: "source.read", status: "empty", title: "搜尋素材庫", stepId: "s1", resultCount: 0 }),
    ]);
    expect(step.count).toBe(0);
  });

  it("沒量到就不補零：undefined 不會變成 0", () => {
    const [step] = derivePhoneWorkSteps([
      event({ type: "source.read", status: "ok", title: "讀取腳本", stepId: "s1" }),
    ]);
    expect(step.count).toBeUndefined();
  });

  it("只留最後幾列——手機不重建一份 log", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      event({ type: "tool.completed", status: "ok", title: `步驟 ${i}`, stepId: `s${i}` }));
    const steps = derivePhoneWorkSteps(many);
    expect(steps).toHaveLength(MAX_PHONE_WORK_STEPS);
    expect(steps.at(-1)?.label).toBe("步驟 11");
  });

  it("等待使用者確認是 blocked，不是 done", () => {
    const [step] = derivePhoneWorkSteps([
      event({ type: "waiting.permission", status: "waiting", title: "等待你的核准", stepId: "s1" }),
    ]);
    expect(step.state).toBe("blocked");
  });
});

describe("derivePhoneActionTally", () => {
  it("只數 action.*：查詢與驗證不算進使用者以為的產出", () => {
    const tally = derivePhoneActionTally([
      event({ type: "tool.completed", status: "ok", title: "查了三次", stepId: "t1" }),
      event({ type: "source.read", status: "ok", title: "讀了腳本", stepId: "t2" }),
      event({ type: "action.completed", status: "ok", title: "建立分鏡", stepId: "a1" }),
    ]);
    expect(tally).toEqual({ done: 1, failed: 0, total: 1 });
  });

  it("三步有一步失敗＝2/3，不會被摺成完成", () => {
    const tally = derivePhoneActionTally([
      event({ type: "action.completed", status: "ok", title: "加入角色", stepId: "a1" }),
      event({ type: "action.completed", status: "ok", title: "建立分鏡", stepId: "a2" }),
      event({ type: "action.failed", status: "failed", title: "生成候選", stepId: "a3" }),
    ]);
    expect(tally).toEqual({ done: 2, failed: 1, total: 3 });
  });
});

describe("phoneCapabilityAffordance", () => {
  it("付費能力一定標成 paid 且需要確認（generate_media 是 COSTFUL）", () => {
    const affordance = phoneCapabilityAffordance("generate_media");
    expect(affordance).toMatchObject({ paid: true, requiresConfirmation: true, access: "WRITE" });
  });

  it("SAFE_WRITE 的既有直接能力不需要額外確認，也不是付費", () => {
    expect(phoneCapabilityAffordance("create_task")).toMatchObject({
      paid: false, requiresConfirmation: false, executable: true,
    });
  });

  it("EXTERNAL 動作仍需確認（會影響站外系統）", () => {
    expect(phoneCapabilityAffordance("add_schedule_item")).toMatchObject({ requiresConfirmation: true });
  });

  it("不存在的能力回 undefined——手機不得自行發明一個能力", () => {
    expect(phoneCapabilityAffordance("delete_everything")).toBeUndefined();
  });
});

describe("derivePhoneContextCapsule", () => {
  it("專案＋焦點＋一句話進度＝三行，且不含任何 uuid", () => {
    const capsule = derivePhoneContextCapsule({
      projectTitle: "百日夢島",
      page: { pageType: "storyboard", entityType: "shot", entityId: "0f8fad5b-d9cb-469f-a165-70867728950e", entityLabel: "第 3 鏡" },
      statusLine: "8 鏡完成 3 鏡",
    });
    expect(capsule.lines).toEqual(["百日夢島", "第 3 鏡", "8 鏡完成 3 鏡"]);
    expect(capsule.lines.join(" ")).not.toContain("0f8fad5b");
  });

  it("多選時顯示件數而不是第一個的名字（避免看起來只會動到一個）", () => {
    const capsule = derivePhoneContextCapsule({
      page: {
        pageType: "storyboard",
        entityType: "shot",
        entityLabel: "第 3 鏡",
        selectedEntityIds: [
          "0f8fad5b-d9cb-469f-a165-70867728950e",
          "1f8fad5b-d9cb-469f-a165-70867728950e",
        ],
      },
    });
    expect(capsule.lines).toEqual(["分鏡", "已選 2 個分鏡"]);
    expect(capsule.selectionCount).toBe(2);
  });

  it("沒有任何上下文時回空陣列（呼叫端據此整塊收起來）", () => {
    expect(derivePhoneContextCapsule({}).lines).toEqual([]);
  });

  it("只有專案、沒有焦點時整塊收起來——第一屏已經印過專案名了", () => {
    const capsule = derivePhoneContextCapsule({ projectTitle: "百日夢島", statusLine: "8 鏡完成 3 鏡" });
    expect(capsule.lines).toEqual([]);
    // 但 composePhoneGoal 仍拿得到專案身分（顯示與解析是兩件事）
    expect(capsule.projectTitle).toBe("百日夢島");
  });
});

describe("composePhoneGoal", () => {
  const capsule = derivePhoneContextCapsule({
    projectTitle: "百日夢島",
    page: { pageType: "storyboard", entityType: "shot", entityLabel: "第 3 鏡" },
  });

  it("專案內的說法補上專案名（首頁說「第二幕」才有所指），但不竄改他指的那一幕", () => {
    expect(composePhoneGoal("把第二幕改成晚上", capsule)).toBe("在「百日夢島」：把第二幕改成晚上");
  });

  it("純代名詞才把「正在看哪一個」也補進去", () => {
    expect(composePhoneGoal("把這個改成晚上", capsule)).toBe("在「百日夢島」的第 3 鏡：把這個改成晚上");
  });

  it("明講要另開專案時不補目前專案——補上去會把意思改掉", () => {
    expect(composePhoneGoal("幫我開一個新專案，主題是海邊日出", capsule))
      .toBe("幫我開一個新專案，主題是海邊日出");
  });

  it("已經指名就原樣送出，不加工", () => {
    expect(composePhoneGoal("幫我建立一個新專案", capsule)).toBe("幫我建立一個新專案");
  });

  it("句子已含專案名時不重複", () => {
    expect(composePhoneGoal("「百日夢島」這個專案還缺什麼？", capsule))
      .toBe("「百日夢島」這個專案還缺什麼？");
  });

  it("沒有上下文可補時原樣送出——不得捏造一個專案", () => {
    expect(composePhoneGoal("繼續剛剛的", derivePhoneContextCapsule({}))).toBe("繼續剛剛的");
  });
});

describe("resolvePhoneDestructiveTarget", () => {
  const two = [
    { id: "a", label: "第 3 鏡" },
    { id: "b", label: "百日夢島" },
  ];

  it("兩個合理對象時不准猜（Flow F）", () => {
    const result = resolvePhoneDestructiveTarget("刪掉這個", two);
    expect(result.status).toBe("needs_choice");
    expect(result.status === "needs_choice" && result.candidates).toHaveLength(2);
  });

  it("只有一個對象時是唯一解，不是猜", () => {
    expect(resolvePhoneDestructiveTarget("刪掉這個", [two[0]]))
      .toEqual({ status: "resolved", candidate: two[0] });
  });

  it("句子已指名就放行（「刪掉第 3 鏡」沒有歧義）", () => {
    expect(resolvePhoneDestructiveTarget("刪掉第 3 鏡", two).status).toBe("resolved");
  });

  it("非破壞性請求完全不經過這道門", () => {
    expect(resolvePhoneDestructiveTarget("把這個改成晚上", two).status).toBe("not_destructive");
  });

  it("重複 id 只算一個候選（同一個東西被兩處註冊不構成歧義）", () => {
    const dup = [{ id: "a", label: "第 3 鏡" }, { id: "a", label: "第 3 鏡" }];
    expect(resolvePhoneDestructiveTarget("刪掉這個", dup).status).toBe("resolved");
  });
});

describe("derivePhoneCard", () => {
  it("等待使用者選擇時優先顯示 clarify，且標成需要注意", () => {
    const interaction: AssistantInteractionRequest = {
      interactionId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      runId: "run-1",
      goalId: "1f8fad5b-d9cb-469f-a165-70867728950e",
      type: "CONFIRMATION_CARD",
      title: "要用哪一個來源？",
      required: true,
      resumeToken: "2f8fad5b-d9cb-469f-a165-70867728950e",
      expiresAt: "2999-01-01T00:00:00.000Z",
      expectedResultType: "confirmation",
      status: "pending",
      createdAt: "2026-08-17T00:00:00.000Z",
    };
    const card = derivePhoneCard({ pendingInteraction: interaction });
    expect(card).toMatchObject({ kind: "clarify", title: "要用哪一個來源？", attention: true });
    expect(card?.primaryAction?.kind).toBe("open_assistant");
  });

  it("串流還在跑時是 progress，只顯示真的發生過的階段", () => {
    const card = derivePhoneCard({
      running: true,
      events: [event({ type: "tool.completed", status: "ok", title: "分析 6 鏡", stepId: "s1", resultCount: 6 })],
    });
    expect(card?.kind).toBe("progress");
    expect(card?.steps.map((s) => s.label)).toEqual(["分析 6 鏡"]);
    // 沒有百分比、沒有預測步驟
    expect(card?.lines).toEqual([]);
  });

  it("有待確認提議時是 proposal，不會因為助手講了「已完成」就變 result", () => {
    const card = derivePhoneCard({
      answer: "我已經把第二幕改成夜晚了。",
      pendingProposals: [{ id: "p1", label: "更新第二幕：時間 → 夜晚" }],
    });
    expect(card?.kind).toBe("proposal");
    expect(card?.lines).toEqual(["更新第二幕：時間 → 夜晚"]);
  });

  it("提議牽涉付費能力時，按鈕標出費用而不是「一鍵完成」", () => {
    const card = derivePhoneCard({
      pendingProposals: [{ id: "p1", label: "生成 3 個候選", capabilityId: "generate_media" }],
    });
    expect(card?.primaryAction).toMatchObject({ paid: true, kind: "open_assistant" });
    expect(card?.primaryAction?.label).toContain("費用");
  });

  it("已驗證的收據才算結果；生成結果導到裁決畫面，不代 Adopt", () => {
    const results: AssistantActionResult[] = [{
      type: "generation",
      generationIds: ["g1", "g2"],
      projectId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      verification: { status: "verified", message: "已註冊 2 筆生成" },
    }];
    const card = derivePhoneCard({ results, activeGoal: goal({ status: "completed" }) });
    expect(card?.kind).toBe("result");
    expect(card?.lines.some((line) => line.includes("候選待裁決"))).toBe(true);
    expect(card?.primaryAction).toMatchObject({ kind: "navigate", label: "去裁決候選" });
  });

  it("部分成功顯示「完成 2 / 3」，不摺成完成", () => {
    const card = derivePhoneCard({
      activeGoal: goal({ status: "completed" }),
      events: [
        event({ type: "action.completed", status: "ok", title: "加入角色", stepId: "a1" }),
        event({ type: "action.completed", status: "ok", title: "建立分鏡", stepId: "a2" }),
        event({ type: "action.failed", status: "failed", title: "生成候選", stepId: "a3" }),
      ],
    });
    expect(card?.title).toBe("部分完成");
    expect(card?.lines[0]).toBe("完成 2 / 3");
    expect(card?.attention).toBe(true);
  });

  it("未驗證的收據不會被當成結果（呼叫端沒濾時這裡也不承認）", () => {
    const results: AssistantActionResult[] = [{
      type: "create_task",
      taskIds: ["t1"],
      count: 1,
      projectId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      verification: { status: "unverified", message: "讀回失敗" },
    }];
    const card = derivePhoneCard({ answer: "已建立任務。", results });
    expect(card?.kind).toBe("answer");
  });

  it("純回答就是 answer，而且只給「看完整回覆」這種唯讀動作", () => {
    const card = derivePhoneCard({ answer: "第三幕完成度 72%\n缺：2 個畫面\n待確認：1 個角色造型" });
    expect(card?.kind).toBe("answer");
    expect(card?.title).toBe("第三幕完成度 72%");
    expect(card?.lines).toEqual(["缺：2 個畫面", "待確認：1 個角色造型"]);
    expect(card?.primaryAction).toBeUndefined();
  });

  it("什麼都沒有就不畫卡（空卡片比沒有卡片更糟）", () => {
    expect(derivePhoneCard({})).toBeNull();
  });

  it("P4：不確定 fallback＋已有完成讀取時，標題取最後完成步驟而非不確定首行", () => {
    const card = derivePhoneCard({
      answer: "我不太確定，可以換個問法再問一次。",
      events: [
        event({ type: "tool.completed", status: "ok", title: "已讀取全組現況", stepId: "s1", resultCount: 17 }),
        event({ type: "source.read", status: "ok", title: "已完成盤點 618", stepId: "s2", resultCount: 618 }),
      ],
    });
    expect(card?.kind).toBe("answer");
    expect(card?.title).toBe("已完成盤點 618");
  });

  it("P4：真不確定（無完成步驟）時維持不確定標題", () => {
    const card = derivePhoneCard({ answer: "我不太確定，可以換個問法再問一次。" });
    expect(card?.title).toContain("不太確定");
  });
});
