import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModelHeatmap } from "./ModelHeatmap";

const catalog = vi.fn();
const analytics = vi.fn();
vi.mock("../../api", () => ({
  trpc: {
    models: {
      byCategory: { useQuery: () => ({ data: catalog(), isLoading: false, isError: false, refetch: () => undefined }) },
      analytics: { useQuery: () => ({ data: analytics(), isLoading: false, error: null }) },
    },
  },
}));

const CATEGORIES = [{ id: "text-to-image", label: "文生圖" }, { id: "llm", label: "大型語言模型" }];

function renderHeatmap(overrides: Partial<Parameters<typeof ModelHeatmap>[0]> = {}) {
  return render(
    <ModelHeatmap
      category="text-to-image"
      categories={CATEGORIES}
      onCategoryChange={() => undefined}
      onCompare={() => undefined}
      comparedIds={[]}
      compareFull={false}
      {...overrides}
    />,
  );
}

describe("ModelHeatmap", () => {
  it("每一列都標出它的底層模型，而不只是端點名稱", () => {
    catalog.mockReturnValue([
      { id: "fal-ai/flux/dev", label: "FLUX.1 dev", points: 30, verified: true, health: "live_ok", textEncoderLimit: 512, supportsNegativePrompt: false, supportsSeed: true },
    ]);
    analytics.mockReturnValue({ days: 90, models: [] });
    renderHeatmap();
    expect(screen.getByText("FLUX.1 dev")).toBeInTheDocument();
    expect(screen.getByText("FLUX.1 [dev]")).toBeInTheDocument();
  });

  it("沒有資料的格子標成「未公開」而不是低分——兩者不可混為一談", () => {
    catalog.mockReturnValue([
      { id: "fal-ai/ideogram/v3", label: "Ideogram v3", points: 60, verified: false, health: "never_probed", textEncoderLimit: null, supportsNegativePrompt: null, supportsSeed: null },
    ]);
    analytics.mockReturnValue({ days: 90, models: [] });
    const { container } = renderHeatmap();
    expect(screen.getByText("窗口未公開")).toBeInTheDocument();
    // 空格用斜線樣式標示，不塗顏色
    expect(container.querySelectorAll(".model-heatmap__cell.is-empty").length).toBeGreaterThan(0);
  });

  it("實測欄取自使用者自己的紀錄；沒跑過就照實說空的", async () => {
    catalog.mockReturnValue([
      { id: "fal-ai/flux/dev", label: "FLUX.1 dev", points: 30, verified: true, health: "live_ok", textEncoderLimit: 512, supportsNegativePrompt: false, supportsSeed: true },
    ]);
    analytics.mockReturnValue({ days: 90, models: [{ modelId: "fal-ai/flux/dev", submits: 4, done: 3, failed: 1, points: 90, avgSeconds: 25, lastUsedAt: null }] });
    renderHeatmap();
    expect(screen.getByText("75%（3/4）")).toBeInTheDocument();
    expect(screen.getByText("平均 25 秒")).toBeInTheDocument();

    // 關掉實測欄後只剩規格欄
    await userEvent.click(screen.getByText("含我的實測"));
    expect(screen.queryByText("75%（3/4）")).not.toBeInTheDocument();
  });

  it("點模型名稱可以展開它的底層基座說明", async () => {
    catalog.mockReturnValue([
      { id: "fal-ai/flux/dev", label: "FLUX.1 dev", points: 30, verified: true, health: "live_ok", textEncoderLimit: 512, supportsNegativePrompt: false, supportsSeed: true },
    ]);
    analytics.mockReturnValue({ days: 90, models: [] });
    renderHeatmap();
    await userEvent.click(screen.getByRole("button", { name: /FLUX.1 dev/ }));
    expect(screen.getByText("Black Forest Labs")).toBeInTheDocument();
    expect(screen.getByText(/權重公開——/)).toBeInTheDocument();
  });

  it("整體較強的模型排在前面（綜合分排序）", () => {
    catalog.mockReturnValue([
      { id: "fal-ai/ideogram/v3", label: "Ideogram v3", points: 60, verified: false, health: "openapi_404", textEncoderLimit: null, supportsNegativePrompt: null, supportsSeed: null },
      { id: "fal-ai/flux/dev", label: "FLUX.1 dev", points: 30, verified: true, health: "live_ok", textEncoderLimit: 512, supportsNegativePrompt: true, supportsSeed: true },
    ]);
    analytics.mockReturnValue({ days: 90, models: [] });
    renderHeatmap();
    const rows = screen.getAllByRole("row").slice(1); // 去掉表頭
    expect(within(rows[0]).getByText("FLUX.1 dev")).toBeInTheDocument();
  });

  it("加入比較的按鈕在已滿 4 顆時停用，不讓人白點", () => {
    catalog.mockReturnValue([
      { id: "fal-ai/flux/dev", label: "FLUX.1 dev", points: 30, verified: true, health: "live_ok", textEncoderLimit: 512, supportsNegativePrompt: false, supportsSeed: true },
    ]);
    analytics.mockReturnValue({ days: 90, models: [] });
    renderHeatmap({ compareFull: true, comparedIds: ["a", "b", "c", "d"] });
    expect(screen.getByRole("button", { name: "加入比較" })).toBeDisabled();
  });
});
