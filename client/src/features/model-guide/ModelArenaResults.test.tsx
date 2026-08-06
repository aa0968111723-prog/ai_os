import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelArenaResults } from "./ModelArenaResults";

const rows = vi.fn();
vi.mock("../../api", () => ({
  trpc: {
    generation: {
      benchResult: {
        useQuery: () => ({ data: rows(), isLoading: false, error: null }),
      },
    },
  },
}));

describe("ModelArenaResults", () => {
  it("把同題並跑的成品並排，並標出最快與最省的那顆", () => {
    rows.mockReturnValue([
      { id: "a", modelId: "fal-ai/flux/dev", modelLabel: "FLUX.1 dev", status: "done", kind: "image", resultUrl: "https://example.com/a.png", resultText: null, error: null, points: 30, elapsedSeconds: 40 },
      { id: "b", modelId: "fal-ai/flux/schnell", modelLabel: "FLUX.1 schnell", status: "done", kind: "image", resultUrl: "https://example.com/b.png", resultText: null, error: null, points: 4, elapsedSeconds: 6 },
    ]);
    render(<ModelArenaResults projectId="p1" runId="r1" />);

    const images = screen.getAllByRole("img");
    expect(images[0]).toHaveAttribute("src", "https://example.com/a.png");
    expect(screen.getByText(/全部收斂/)).toBeInTheDocument();
    // 決策依據不是只有畫面：點數與秒數要跟成品擺在同一格
    expect(screen.getByText(/4 點 · 6 秒 · 最快 · 最省/)).toBeInTheDocument();
    expect(screen.getByText(/30 點 · 40 秒/)).toBeInTheDocument();
  });

  it("底層模型跟著成品一起顯示（同基座換過去風格不會變）", () => {
    rows.mockReturnValue([
      { id: "a", modelId: "fal-ai/flux/dev", modelLabel: "FLUX.1 dev", status: "done", kind: "image", resultUrl: "https://example.com/a.png", resultText: null, error: null, points: 30, elapsedSeconds: 40 },
    ]);
    render(<ModelArenaResults projectId="p1" runId="r1" />);
    expect(screen.getByText("FLUX.1 [dev]")).toBeInTheDocument();
  });

  it("還在跑的顆數如實回報，失敗的顆數顯示原因", () => {
    rows.mockReturnValue([
      { id: "a", modelId: "fal-ai/flux/dev", modelLabel: "FLUX.1 dev", status: "running", kind: "image", resultUrl: null, resultText: null, error: null, points: 30, elapsedSeconds: null },
      { id: "b", modelId: "fal-ai/kolors", modelLabel: "Kolors", status: "failed", kind: "image", resultUrl: null, resultText: null, error: "模型拒絕請求", points: 5, elapsedSeconds: 3 },
    ]);
    render(<ModelArenaResults projectId="p1" runId="r1" />);
    expect(screen.getByText(/1 顆還在跑/)).toBeInTheDocument();
    expect(screen.getByText("生成中")).toBeInTheDocument();
    expect(screen.getByText("模型拒絕請求")).toBeInTheDocument();
  });

  it("第一筆結果進來之前不佔畫面", () => {
    rows.mockReturnValue([]);
    const { container } = render(<ModelArenaResults projectId="p1" runId="r1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
