import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PhoneAssistantCardView } from "./PhoneAssistantCards";
import {
  phoneAnimationCompareCard,
  phoneAnimationCostCard,
  phoneAnimationSummaryCard,
  projectPhoneAnimationSummary,
  type PhoneAnimationBoardShot,
} from "@shared/phoneAnimationProjection";

const shot = (over: Partial<PhoneAnimationBoardShot> & Pick<PhoneAnimationBoardShot, "shotId" | "orderIndex">): PhoneAnimationBoardShot => ({
  title: `Shot ${String(over.orderIndex + 1).padStart(2, "0")}`,
  lifecycle: "continuity_review",
  needsReview: true,
  stale: false,
  visualCheckStatus: "completed",
  currentKind: "image",
  nextAction: { kind: "review_continuity", label: "檢查前後連貫" },
  findings: [{
    code: "identity_drift",
    dimension: "identity",
    severity: "warning",
    confidence: "high",
    reason: "人物外觀偏移",
    evidenceSourceIds: [],
  }],
  ...over,
});

describe("Phone animation production cards", () => {
  it("summary card shows human counts and one primary CTA", () => {
    const onRun = vi.fn();
    const card = phoneAnimationSummaryCard(projectPhoneAnimationSummary({
      projectId: "p1",
      rows: [shot({ shotId: "s4", orderIndex: 3 })],
      reviewQueue: [shot({ shotId: "s4", orderIndex: 3 })],
      primaryAction: { shotId: "s4", kind: "review_continuity", label: "檢查前後連貫" },
      summary: { total: 1, needsReview: 1, complete: 0 },
    }));
    render(<PhoneAssistantCardView card={card} onRun={onRun} />);
    expect(screen.getByText("動畫檢查")).toBeInTheDocument();
    expect(screen.getByText(/1 鏡需要處理/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /查看問題/ }));
    expect(onRun).toHaveBeenCalledWith(expect.objectContaining({ kind: "phone_command" }));
  });

  it("cost card marks paid confirmation and compare shows both versions", () => {
    const onRun = vi.fn();
    render(<PhoneAssistantCardView card={phoneAnimationCostCard({
      affectedShotIds: ["s4"],
      findingKeys: ["s4::identity_drift"],
      dimensions: ["identity"],
      shots: [{ shotId: "s4", shotLabel: "Shot 04", stageLabel: "關鍵影格", stages: ["keyframe"], reason: "人物外觀偏移" }],
      untouchedCount: 17,
      untouchedLabel: "其他 17 鏡不動",
      projectedPaidOperations: 1,
      estimatedPoints: 1,
      requiresApproval: false,
      capabilityDowngrades: [],
      notes: [],
      keyframeModelId: "fal-ai/flux/dev",
      videoModelId: "fal-ai/wan/v2.2-a14b/image-to-video",
    })} onRun={onRun} />);
    expect(screen.getByText("執行前確認")).toBeInTheDocument();
    expect(screen.getByText("需點數")).toBeInTheDocument();
    expect(screen.getByText("其他 17 鏡不動")).toBeInTheDocument();
    expect(screen.getByText(/仍只是候選/)).toBeInTheDocument();

    render(<PhoneAssistantCardView card={phoneAnimationCompareCard({
      shotId: "s5",
      shotLabel: "Shot 05",
      generationId: "g1",
      current: { kind: "image", url: "/cur.png" },
      candidate: { kind: "image", url: "/cand.png" },
      goals: ["右手持物延續"],
      notChecked: true,
    })} onRun={onRun} />);
    expect(screen.getByText("視覺一致性尚未檢查")).toBeInTheDocument();
    expect(screen.getByAltText("現用版本")).toBeInTheDocument();
    expect(screen.getByAltText("修復候選")).toBeInTheDocument();
  });
});
