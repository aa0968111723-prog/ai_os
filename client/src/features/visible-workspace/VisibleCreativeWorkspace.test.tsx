import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * 這個表面的價值全在「畫面上的每一格都由 server truth 撐著」。
 * 因此測的是：候選的成功／失敗／待核准分別顯示、成本只算實際結算的、
 * 血緣看得到、命令列的 placeholder 跟著選取走——而不是測它畫了幾個 div。
 */
const listByProject = vi.fn();
const versionsQuery = vi.fn();
const continuityQuery = vi.fn();

vi.mock("../../api", () => ({
  trpc: {
    scenes: {
      listByProject: { useQuery: (...a: unknown[]) => listByProject(...a) },
      versions: { useQuery: (...a: unknown[]) => versionsQuery(...a) },
      setVisualFromAsset: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
    story: { continuityCheck: { useQuery: (...a: unknown[]) => continuityQuery(...a) } },
    useUtils: () => ({
      scenes: { versions: { invalidate: vi.fn() }, listByProject: { invalidate: vi.fn() } },
      story: { continuityCheck: { invalidate: vi.fn() } },
    }),
  },
}));

import { VisibleCreativeWorkspace } from "./VisibleCreativeWorkspace";

const SHOTS = [
  { id: "s1", title: "海面破曉", orderIndex: 1, assetUrl: "/api/assets/a1/file", assetKind: "image", narrationUrl: null, reviewStatus: "draft", generatingVisual: false },
  { id: "s2", title: "回頭", orderIndex: 2, assetUrl: null, assetKind: null, narrationUrl: null, reviewStatus: "draft", generatingVisual: true },
];

function version(over: Record<string, unknown>) {
  return {
    index: 1, role: "visual", state: "candidate", isCurrent: false, generationId: "g1",
    modelId: "m", prompt: "p", sourceUrl: null, error: null, createdAt: "2026-01-01T00:00:00Z",
    assetId: "a1", assetUrl: "/api/assets/a1/file", assetKind: "image", points: 12,
    canSetCurrent: true, canRefineFrom: true, canReusePrompt: true,
    creative: { batchId: "b1", directionId: "closer", directionLabel: "靠近人物", batchSize: 3 },
    parentIndex: null,
    ...over,
  };
}

function setup(versions: unknown[], summary = { generating: false }) {
  listByProject.mockReturnValue({ data: SHOTS, isLoading: false });
  continuityQuery.mockReturnValue({ data: { outdated: [], total: 0 } });
  versionsQuery.mockReturnValue({ data: { versions, summary } });
  render(<VisibleCreativeWorkspace projectId="p1" canEdit />);
}

describe("VisibleCreativeWorkspace", () => {
  it("每一鏡的狀態都來自 server truth，生成中的那一鏡標生成中", () => {
    setup([version({})]);
    expect(screen.getByLabelText("Shot 1 海面破曉，已完成")).toBeTruthy();
    expect(screen.getByLabelText("Shot 2 回頭，生成中")).toBeTruthy();
  });

  it("部分失敗時成功／失敗／待核准分別顯示，不是整組 failed", () => {
    setup([
      version({ index: 1, state: "candidate", creative: { batchId: "b1", directionId: "closer", directionLabel: "靠近人物", batchSize: 3 } }),
      version({ index: 2, state: "failed", assetId: null, assetUrl: null, error: "供應商逾時，已退點", points: 0, canSetCurrent: false, creative: { batchId: "b1", directionId: "low", directionLabel: "低機位逆光", batchSize: 3 } }),
      version({ index: 3, state: "awaiting_approval", assetId: null, assetUrl: null, points: 0, canSetCurrent: false, creative: { batchId: "b1", directionId: "wide", directionLabel: "廣角留白", batchSize: 3 } }),
    ]);
    expect(screen.getByText("可採用")).toBeTruthy();
    expect(screen.getByText("失敗")).toBeTruthy();
    expect(screen.getByText("待核准")).toBeTruthy();
    expect(screen.getByText("供應商逾時，已退點")).toBeTruthy();
    // 成本只算實際結算的那一筆：失敗已退點、待核從未扣點
    expect(screen.getByText(/已結算 12 點/)).toBeTruthy();
  });

  it("血緣看得到：這一版是從第幾版延伸的", () => {
    setup([version({ index: 5, parentIndex: 2 })]);
    expect(screen.getByText("延伸自第 2 版")).toBeTruthy();
  });

  it("命令列的 placeholder 跟著選取的 Shot 走", () => {
    setup([version({})]);
    expect(screen.getByPlaceholderText("告訴 Aios 想怎麼修改 Shot 01…")).toBeTruthy();
  });
});
