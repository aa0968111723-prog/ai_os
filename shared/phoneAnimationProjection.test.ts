import { describe, expect, it } from "vitest";
import type { AnimationRepairPlan } from "./animationPipeline";
import {
  assertNoTechnicalLeak,
  classifyPhoneAnimationIntent,
  derivePhoneRepairResume,
  filterPhoneFindings,
  parsePhoneDimensionFilter,
  phoneAnimationCostCard,
  phoneAnimationSummaryCard,
  phoneFindingKey,
  phoneShotLabel,
  projectPhoneAnimationSummary,
  nextPhoneCompareItem,
  projectPhoneCompareQueue,
  projectPhoneRepairProposal,
  resolvePhoneRepairTargets,
  animationRepairJobsFromProposal,
  pickAnimationCompareItem,
  type PhoneAnimationBoardInput,
  type PhoneAnimationBoardShot,
  type PhoneAnimationFinding,
} from "./phoneAnimationProjection";

const shot = (over: Partial<PhoneAnimationBoardShot> & Pick<PhoneAnimationBoardShot, "shotId" | "orderIndex">): PhoneAnimationBoardShot => ({
  title: `第 ${String(over.orderIndex + 1).padStart(2, "0")} 鏡`,
  lifecycle: "continuity_review",
  needsReview: true,
  stale: false,
  visualCheckStatus: "completed",
  currentKind: "image",
  nextAction: { kind: "review_continuity", label: "檢查前後連貫" },
  findings: [],
  ...over,
});

const finding = (over: Partial<PhoneAnimationFinding> & Pick<PhoneAnimationFinding, "key" | "shotId" | "dimension" | "reason">): PhoneAnimationFinding => ({
  shotLabel: "第 05 鏡",
  dimensionLabel: "人物",
  severity: "warning",
  severityLabel: "需確認",
  confidenceLabel: "高可信",
  repairable: true,
  ...over,
});

function board(rows: PhoneAnimationBoardShot[]): PhoneAnimationBoardInput {
  const reviewQueue = rows.filter((row) => row.needsReview);
  return {
    projectId: "11111111-1111-4111-8111-111111111111",
    rows,
    reviewQueue,
    primaryAction: reviewQueue[0]
      ? { shotId: reviewQueue[0].shotId, kind: reviewQueue[0].nextAction.kind, label: reviewQueue[0].nextAction.label }
      : null,
    summary: { total: rows.length, needsReview: reviewQueue.length, complete: rows.filter((row) => row.lifecycle === "complete").length },
  };
}

describe("projectPhoneAnimationSummary", () => {
  it("counts review / blocker / not_checked from board truth and never leaks technical ids", () => {
    const rows = [
      shot({
        shotId: "s4",
        orderIndex: 3,
        title: "Shot 04",
        findings: [{
          code: "identity_drift",
          dimension: "identity",
          severity: "warning",
          confidence: "high",
          reason: "人物外觀偏移",
          evidenceSourceIds: ["packet-fingerprint-should-not-leak"],
        }],
      }),
      shot({
        shotId: "s5",
        orderIndex: 4,
        title: "Shot 05",
        findings: [{
          code: "hand_swap",
          dimension: "physics",
          severity: "blocker",
          confidence: "high",
          reason: "左右手持物與上一鏡不一致",
          evidenceSourceIds: [],
        }],
      }),
      shot({
        shotId: "s8",
        orderIndex: 7,
        title: "Shot 08",
        visualCheckStatus: "not_checked",
        findings: [],
        needsReview: false,
        lifecycle: "complete",
        nextAction: { kind: "done", label: "已完成" },
      }),
    ];
    const summary = projectPhoneAnimationSummary(board(rows));
    expect(summary.counts.needsReview).toBe(2);
    expect(summary.counts.blocked).toBe(1);
    expect(summary.counts.notChecked).toBe(1);
    expect(summary.dimensionCounts.identity).toBe(1);
    expect(summary.dimensionCounts.physics).toBe(1);
    expect(summary.topFindings[0]?.reason).toBe("人物外觀偏移");
    const blob = JSON.stringify(summary.topFindings.map((row) => `${row.shotLabel}${row.reason}${row.confidenceLabel}`));
    expect(assertNoTechnicalLeak(blob)).toBe(true);
    expect(blob).not.toContain("packet-fingerprint");
  });

  it("stale shot without findings still becomes a human continuity finding", () => {
    const summary = projectPhoneAnimationSummary(board([
      shot({ shotId: "s1", orderIndex: 0, stale: true, findings: [] }),
    ]));
    expect(summary.topFindings[0]?.reason).toContain("上游設定已變更");
    expect(summary.topFindings[0]?.dimension).toBe("temporal");
  });
});

describe("classifyPhoneAnimationIntent", () => {
  it("maps production questions to read intents", () => {
    expect(classifyPhoneAnimationIntent("這一幕還有什麼問題？")).toEqual({ kind: "summary" });
    expect(classifyPhoneAnimationIntent("還有幾鏡沒檢查？")).toEqual({ kind: "not_checked" });
    expect(classifyPhoneAnimationIntent("為什麼 Shot 5 需要修？")).toEqual({ kind: "explain_shot", shotRef: "5" });
    expect(classifyPhoneAnimationIntent("哪些鏡頭人物不一致？").kind).toBe("list_findings");
  });

  it("maps repair / confirm / adopt language without guessing generate_media", () => {
    expect(classifyPhoneAnimationIntent("人物跟連戲先修，畫風不要").kind).toBe("plan_repair");
    expect(classifyPhoneAnimationIntent("第二個不要").kind).toBe("plan_repair");
    expect(classifyPhoneAnimationIntent("只處理這三鏡").kind).toBe("plan_repair");
    expect(classifyPhoneAnimationIntent("照這個計畫執行")).toEqual({ kind: "confirm_execute" });
    expect(classifyPhoneAnimationIntent("採用這版")).toEqual({ kind: "adopt" });
    expect(classifyPhoneAnimationIntent("原本比較好")).toEqual({ kind: "keep" });
    expect(classifyPhoneAnimationIntent("把第二幕改成晚上")).toEqual({ kind: "none" });
  });
});

describe("parsePhoneDimensionFilter + resolvePhoneRepairTargets", () => {
  const findings: PhoneAnimationFinding[] = [
    finding({ key: "s4::identity_drift", shotId: "s4", shotLabel: "Shot 04", dimension: "identity", reason: "人物外觀偏移" }),
    finding({ key: "s5::hand_swap", shotId: "s5", shotLabel: "Shot 05", dimension: "physics", dimensionLabel: "動作", reason: "左右手持物與上一鏡不一致" }),
    finding({ key: "s8::style_drift", shotId: "s8", shotLabel: "Shot 08", dimension: "style", dimensionLabel: "畫風", reason: "畫風陰影偏離目前 Style" }),
  ];
  const shots = [
    shot({ shotId: "s4", orderIndex: 3, title: "Shot 04" }),
    shot({ shotId: "s5", orderIndex: 4, title: "Shot 05" }),
    shot({ shotId: "s8", orderIndex: 7, title: "Shot 08" }),
  ];

  it("人物跟連戲先修、畫風不要 → identity/look/temporal/physics only", () => {
    const filter = parsePhoneDimensionFilter("人物跟連戲先修，畫風不要");
    expect(filter.include).toEqual(expect.arrayContaining(["identity", "look", "temporal", "physics"]));
    expect(filter.exclude).toContain("style");
    const selected = filterPhoneFindings(findings, filter);
    expect(selected.map((row) => row.dimension).sort()).toEqual(["identity", "physics"]);
  });

  it("ambiguous style target must clarify and must not resolve", () => {
    const extra = finding({ key: "s9::style_b", shotId: "s9", shotLabel: "Shot 09", dimension: "style", dimensionLabel: "畫風", reason: "另一個畫風偏移" });
    const resolved = resolvePhoneRepairTargets({
      text: "修掉那個畫風問題",
      findings: [...findings, extra],
      shots,
    });
    expect(resolved.status).toBe("clarify");
  });

  it("全部規劃 after clarify resolves every current finding", () => {
    const resolved = resolvePhoneRepairTargets({
      text: "全部規劃（3 鏡）",
      findings,
      shots,
    });
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.shotIds).toHaveLength(3);
    }
  });

  it("幫我修一下 with multiple shots must clarify instead of planning all paid work", () => {
    const resolved = resolvePhoneRepairTargets({
      text: "幫我修一下",
      findings,
      shots,
    });
    expect(resolved.status).toBe("clarify");
  });

  it("第二個不要 removes the second item from the current proposal", () => {
    const resolved = resolvePhoneRepairTargets({
      text: "第二個不要",
      findings,
      shots,
      previousFindingKeys: findings.map((row) => row.key),
    });
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.findingKeys).toEqual(["s4::identity_drift", "s8::style_drift"]);
    }
  });

  it("typed filterOverride drops style even when the reconstructed text has no 不要", () => {
    const resolved = resolvePhoneRepairTargets({
      text: "規劃修復",
      findings,
      shots,
      filterOverride: {
        include: ["identity", "look", "temporal", "physics"],
        exclude: ["style"],
      },
    });
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.dimensions).toEqual(expect.arrayContaining(["identity", "physics"]));
      expect(resolved.dimensions).not.toContain("style");
      expect(resolved.shotIds).toEqual(["s4", "s5"]);
    }
  });

  it("只處理這三鏡 keeps the current review set and does not invent extra shots", () => {
    const resolved = resolvePhoneRepairTargets({
      text: "只處理這三鏡",
      findings,
      shots,
    });
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.shotIds).toHaveLength(3);
    }
  });

  it("selected shot scopes 幫我修一下 to that shot", () => {
    const resolved = resolvePhoneRepairTargets({
      text: "幫我修一下",
      findings,
      shots,
      selectedShotId: "s5",
    });
    expect(resolved.status).toBe("resolved");
    if (resolved.status === "resolved") {
      expect(resolved.shotIds).toEqual(["s5"]);
    }
  });
});

describe("projectPhoneRepairProposal", () => {
  it("shows untouched shots, estimated points, and candidate-only notes", () => {
    const rows = Array.from({ length: 20 }, (_, index) => shot({
      shotId: `s${index}`,
      orderIndex: index,
      title: `Shot ${String(index + 1).padStart(2, "0")}`,
      needsReview: index < 3,
    }));
    const plan: AnimationRepairPlan = {
      affectedShotIds: ["s3", "s4", "s7"],
      affectedStages: ["keyframe", "evaluation"],
      dimensions: ["identity", "physics"],
      reasons: ["人物外觀偏移"],
      referenceRolesToStrengthen: ["identity"],
      projectedPaidOperations: 3,
      preservedAssetIds: [],
      requiresExplicitConfirmation: true,
    };
    const view = projectPhoneRepairProposal({
      board: board(rows),
      plan,
      findings: [
        finding({ key: phoneFindingKey("s3", "a"), shotId: "s3", shotLabel: "Shot 04", dimension: "identity", reason: "人物外觀偏移" }),
      ],
    });
    expect(view.untouchedCount).toBe(17);
    expect(view.untouchedLabel).toBe("其他 17 鏡不動");
    expect(view.estimatedPoints).toBe(3);
    expect(view.notes.some((line) => line.includes("候選"))).toBe(true);
    expect(view.notes.some((line) => line.includes("不會被覆蓋"))).toBe(true);
    const card = phoneAnimationCostCard(view);
    expect(card.primaryAction?.paid).toBe(true);
    expect(card.lines.some((line) => line.includes("點"))).toBe(true);
    expect(card.lines).toContain("其他 17 鏡不動");
    expect(card.steps.some((step) => step.label.includes("仍只是候選"))).toBe(true);
  });
});

describe("compare queue + resume", () => {
  it("only lists shots that already have a candidate, and marks not_checked honestly", () => {
    const queue = projectPhoneCompareQueue(board([
      shot({
        shotId: "s5",
        orderIndex: 4,
        title: "Shot 05",
        visualCheckStatus: "not_checked",
        candidate: { generationId: "g1", assetId: "a1", kind: "image", url: "/c.png" },
        current: { assetId: "a0", kind: "image", url: "/cur.png" },
      }),
      shot({ shotId: "s6", orderIndex: 5, title: "Shot 06", candidate: null }),
    ]));
    expect(queue).toHaveLength(1);
    expect(queue[0]?.notChecked).toBe(true);
    expect(queue[0]?.generationId).toBe("g1");
  });

  it("next compare skips shots the user already Adopted or Kept, without decrementing server queue", () => {
    const items = [
      { shotId: "s4", shotLabel: "Shot 04", generationId: "g4", candidate: { kind: "image", url: "/4.png" }, goals: [], notChecked: false },
      { shotId: "s5", shotLabel: "Shot 05", generationId: "g5", candidate: { kind: "image", url: "/5.png" }, goals: [], notChecked: false },
    ];
    expect(nextPhoneCompareItem({ items, decidedShotIds: [] })?.shotId).toBe("s4");
    expect(nextPhoneCompareItem({ items, decidedShotIds: ["s4"] })?.shotId).toBe("s5");
    expect(nextPhoneCompareItem({ items, decidedShotIds: ["s4", "s5"] })).toBeNull();
  });

  it("resume state is derived from existing generation / candidate counts", () => {
    expect(derivePhoneRepairResume({ awaitingGenerations: 2, runningGenerations: 0, compareCount: 0 })?.state).toBe("awaiting_approval");
    expect(derivePhoneRepairResume({ awaitingGenerations: 0, runningGenerations: 1, compareCount: 0 })?.state).toBe("running");
    expect(derivePhoneRepairResume({ awaitingGenerations: 0, runningGenerations: 0, compareCount: 3 })?.state).toBe("review_ready");
    expect(derivePhoneRepairResume({ awaitingGenerations: 0, runningGenerations: 0, compareCount: 0 })).toBeNull();
  });
});

describe("phone cards", () => {
  it("summary card stays human and offers one primary CTA", () => {
    const card = phoneAnimationSummaryCard(projectPhoneAnimationSummary(board([
      shot({
        shotId: "s4",
        orderIndex: 3,
        title: "Shot 04",
        findings: [{
          code: "identity_drift",
          dimension: "identity",
          severity: "warning",
          confidence: "high",
          reason: "人物外觀偏移",
          evidenceSourceIds: [],
        }],
      }),
    ])));
    expect(card.title).toBe("動畫檢查");
    expect(card.primaryAction?.label).toBe("查看問題");
    expect(card.lines.join("")).not.toMatch(/fingerprint|uuid/i);
    expect(phoneShotLabel({ orderIndex: 4, title: "" })).toBe("第 05 鏡");
  });
});

describe("animation assistant compare / repair jobs", () => {
  it("does not silently pick the first candidate when several shots wait", () => {
    const items = [
      { shotId: "s4", shotLabel: "第 04 鏡", generationId: "g4", candidate: { kind: "image", url: "/4.png" }, goals: [], notChecked: false },
      { shotId: "s5", shotLabel: "第 05 鏡", generationId: "g5", candidate: { kind: "image", url: "/5.png" }, goals: [], notChecked: false },
    ];
    expect(pickAnimationCompareItem([])).toEqual({ status: "none" });
    expect(pickAnimationCompareItem(items)).toEqual({ status: "ambiguous", items });
    expect(pickAnimationCompareItem(items, "s5")).toEqual({ status: "picked", item: items[1] });
    expect(pickAnimationCompareItem([items[0]!])).toEqual({ status: "picked", item: items[0] });
  });

  it("repair jobs skip evaluation and keep the disclosed model ids", () => {
    const jobs = animationRepairJobsFromProposal({
      affectedShotIds: ["s4"],
      findingKeys: ["s4::identity_drift"],
      dimensions: ["identity"],
      shots: [{
        shotId: "s4",
        shotLabel: "第 04 鏡",
        stageLabel: "關鍵影格與影片",
        stages: ["keyframe", "evaluation", "video"],
        reason: "人物外觀偏移",
      }],
      untouchedCount: 0,
      untouchedLabel: "",
      projectedPaidOperations: 2,
      estimatedPoints: 7,
      requiresApproval: false,
      capabilityDowngrades: [],
      notes: [],
      keyframeModelId: "fal-ai/flux/dev",
      videoModelId: "fal-ai/wan/v2.2-a14b/image-to-video",
    });
    expect(jobs).toEqual([
      { shotId: "s4", shotLabel: "第 04 鏡", stage: "keyframe_generation", modelId: "fal-ai/flux/dev" },
      { shotId: "s4", shotLabel: "第 04 鏡", stage: "video_generation", modelId: "fal-ai/wan/v2.2-a14b/image-to-video" },
    ]);
  });
});

describe("phone repair session isolation", () => {
  it("resets in-memory session when the project changes", async () => {
    const { shouldResetPhoneAnimationRepair, shouldUnlockPhoneRepairConfirm } = await import("./phoneAnimationProjection");
    expect(shouldResetPhoneAnimationRepair("proj-a", "proj-b")).toBe(true);
    expect(shouldResetPhoneAnimationRepair("proj-a", "proj-a")).toBe(false);
    expect(shouldUnlockPhoneRepairConfirm(1)).toBe(true);
    expect(shouldUnlockPhoneRepairConfirm(0)).toBe(false);
  });
});
