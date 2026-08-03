import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AblationResultGrid } from "./AblationResultGrid";

const rows = vi.fn();
vi.mock("../../api", () => ({
  trpc: {
    generation: {
      ablationResult: {
        useQuery: () => ({ data: rows(), isLoading: false, error: null }),
      },
    },
  },
}));

describe("AblationResultGrid", () => {
  it("shows the real generated images side by side, baseline first", () => {
    rows.mockReturnValue([
      { id: "b", section: "character", status: "done", kind: "image", resultUrl: "https://example.com/no-character.png" },
      { id: "a", section: "baseline", status: "done", kind: "image", resultUrl: "https://example.com/baseline.png" },
    ]);
    render(<AblationResultGrid projectId="p1" runId="r1" seedPinned />);

    const images = screen.getAllByRole("img");
    // 基準排第一格：其他格都是「跟它比」
    expect(images[0]).toHaveAttribute("alt", "完整版（基準）");
    expect(images[0]).toHaveAttribute("src", "https://example.com/baseline.png");
    expect(images[1]).toHaveAttribute("alt", "拿掉「角色定裝」");
    expect(screen.getByText(/全部完成/)).toBeInTheDocument();
  });

  it("keeps the noise caveat attached to the comparison when seed is not pinned", () => {
    rows.mockReturnValue([{ id: "a", section: "baseline", status: "done", kind: "image", resultUrl: "https://example.com/a.png" }]);
    render(<AblationResultGrid projectId="p1" runId="r1" seedPinned={false} />);
    expect(screen.getByText(/差異裡混著噪聲/)).toBeInTheDocument();
  });

  it("reports each run's status while the images are still being generated", () => {
    rows.mockReturnValue([
      { id: "a", section: "baseline", status: "done", kind: "image", resultUrl: "https://example.com/a.png" },
      { id: "b", section: "prop", status: "running", kind: "image", resultUrl: null },
      { id: "c", section: "scene", status: "failed", kind: "image", resultUrl: null, error: "模型拒絕請求" },
    ]);
    render(<AblationResultGrid projectId="p1" runId="r1" seedPinned />);
    expect(screen.getByText(/1 張生成中/)).toBeInTheDocument();
    expect(screen.getByText("生成中")).toBeInTheDocument();
    expect(screen.getByText("模型拒絕請求")).toBeInTheDocument();
  });

  it("renders nothing before the first row arrives", () => {
    rows.mockReturnValue([]);
    const { container } = render(<AblationResultGrid projectId="p1" runId="r1" seedPinned />);
    expect(container).toBeEmptyDOMElement();
  });
});
