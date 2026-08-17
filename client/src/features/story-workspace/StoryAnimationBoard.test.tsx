import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StoryAnimationBoard } from "./StoryAnimationBoard";

const reviewMutate = vi.fn();
vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({
      creativeContext: {
        animationBoard: { invalidate: vi.fn() },
        workspace: { invalidate: vi.fn() },
      },
    }),
    creativeContext: {
      animationBoard: {
        useQuery: () => ({
          data: {
            summary: { total: 3, needsReview: 1, complete: 1 },
            primaryAction: { shotId: "s2", kind: "review_continuity", label: "檢查前後連貫" },
            reviewQueue: [{
              shotId: "s2",
              orderIndex: 1,
              title: "交接藏寶圖",
              lifecycle: "continuity_review",
              findings: [{ reason: "藏寶圖換手但沒有交接" }],
              stale: false,
              nextAction: { label: "檢查前後連貫" },
            }],
            rows: [{
              shotId: "s2",
              orderIndex: 1,
              title: "交接藏寶圖",
              lifecycle: "continuity_review",
              needsReview: true,
              nextAction: { kind: "review_continuity", label: "檢查前後連貫" },
              stale: false,
              reviewStatus: null,
              previous: { shotId: "s1", title: "上一鏡", assetId: "a1", url: "/prev.png" },
              current: { assetId: "a2", kind: "image", url: "/current.png" },
              candidate: { generationId: "g2", assetId: "a3", kind: "image", url: "/candidate.png" },
              next: { shotId: "s3", title: "下一鏡", assetId: "a4", url: "/next.png" },
              findings: [{
                code: "prop_teleport",
                dimension: "temporal",
                severity: "warning",
                confidence: "high",
                reason: "藏寶圖換手但沒有交接",
                evidenceSourceIds: ["a1", "a3"],
                repairHint: "加入上一鏡結尾影格",
              }],
            }],
          },
        }),
      },
      animationRepairPlan: {
        useQuery: (_input: unknown, options: { enabled: boolean }) => ({
          data: options.enabled ? {
            affectedShotIds: ["s2"],
            affectedStages: ["video", "evaluation"],
            projectedPaidOperations: 1,
            preservedAssetIds: ["a2"],
          } : undefined,
        }),
      },
    },
    scenes: {
      review: {
        useMutation: () => ({ mutate: reviewMutate, isPending: false }),
      },
    },
  },
}));

describe("StoryAnimationBoard", () => {
  it("shows one primary CTA, focused four-frame comparison and exact findings", async () => {
    const user = userEvent.setup();
    render(<StoryAnimationBoard projectId="p1" canEdit />);
    expect(screen.getByTestId("animation-production-board")).toHaveTextContent("3 鏡 · 1 鏡需確認 · 1 鏡完成");
    expect(screen.getAllByRole("button", { name: "檢查前後連貫" })).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "檢查前後連貫" }));
    expect(screen.getByRole("region", { name: "交接藏寶圖 比較" })).toBeVisible();
    expect(screen.getByAltText("上一鏡已採用畫面")).toHaveAttribute("src", "/prev.png");
    expect(screen.getByAltText("目前採用")).toHaveAttribute("src", "/current.png");
    expect(screen.getByAltText("候選結果")).toHaveAttribute("src", "/candidate.png");
    expect(screen.getByAltText("下一鏡已採用畫面")).toHaveAttribute("src", "/next.png");
    expect(screen.getAllByText("藏寶圖換手但沒有交接")).toHaveLength(2);
  });

  it("reveals a targeted repair plan without executing paid work", async () => {
    const user = userEvent.setup();
    render(<StoryAnimationBoard projectId="p1" canEdit />);
    await user.click(screen.getByRole("button", { name: "檢查前後連貫" }));
    await user.click(screen.getByRole("button", { name: "規劃修復" }));
    expect(screen.getByRole("status")).toHaveTextContent("只影響：1 鏡");
    expect(screen.getByRole("status")).toHaveTextContent("video → evaluation");
    expect(screen.getByRole("status")).toHaveTextContent("預計付費生成：1 次；不會自動執行");
  });

  it("offers explicit keep-current for warnings, never silent Adopt", async () => {
    const user = userEvent.setup();
    render(<StoryAnimationBoard projectId="p1" canEdit />);
    await user.click(screen.getByRole("button", { name: "檢查前後連貫" }));
    await user.click(screen.getByRole("button", { name: "保留現用版本" }));
    expect(reviewMutate).toHaveBeenCalledWith({ sceneId: "s2", status: "approved" });
  });
});

