import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiOperationPreview } from "@shared/aiTrace";
import { AiUnderstandingPanel, friendlyPreviewError, presentAiRequest } from "./AiUnderstandingPanel";

vi.mock("../../api", () => ({
  trpc: {
    aiTrace: {
      review: {
        useMutation: () => ({ data: undefined, error: null, isPending: false, mutate: vi.fn() }),
      },
      get: {
        useQuery: () => ({ data: undefined, error: null, isLoading: false }),
      },
    },
  },
}));

describe("presentAiRequest", () => {
  it("extracts readable prompts and short provider parameters without exposing URLs", () => {
    expect(presentAiRequest({
      positivePrompt: "第一段\n第二段",
      negativePrompt: "不要變形",
      providerInput: {
        prompt: "duplicated prompt",
        image_urls: ["https://example.com/private-reference"],
        aspect_ratio: "9:16",
        num_images: 2,
      },
    })).toEqual({
      positivePrompt: "第一段\n第二段",
      negativePrompt: "不要變形",
      parameters: [
        { key: "aspect_ratio", label: "畫面比例", value: "9:16" },
        { key: "num_images", label: "生成張數", value: "2" },
      ],
    });
  });
});

describe("friendlyPreviewError", () => {
  it("replaces raw browser network errors with an actionable local fallback", () => {
    expect(friendlyPreviewError("Failed to fetch")).toContain("不必重新提問");
    expect(friendlyPreviewError("權限不足")).toBe("權限不足");
  });
});

describe("AiUnderstandingPanel request presentation", () => {
  it("shows real prompt line breaks while keeping raw JSON collapsed", () => {
    const onPreview = vi.fn();
    const preview: AiOperationPreview = {
      mode: "generate",
      title: "測試預覽",
      provider: "fal.ai",
      model: "Test Model",
      context: [],
      warnings: [],
      request: {
        positivePrompt: "角色設定\n場景設定\n素材設定",
        negativePrompt: "不要改變臉部",
        providerInput: { prompt: "duplicate", aspect_ratio: "9:16" },
      },
      estimatedPoints: 4,
      canOverrideCreativePrompt: true,
    };

    render(
      <AiUnderstandingPanel
        projectId="project-1"
        preview={preview}
        onPreview={onPreview}
        onOverrideChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "AI 會怎麼理解？" }));
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("readable-positive-prompt").textContent).toBe("角色設定\n場景設定\n素材設定");
    expect(screen.getByText("畫面比例")).toBeInTheDocument();
    expect(screen.getByText("9:16")).toBeInTheDocument();
    expect(screen.getByText("開發者資料：完整請求 JSON").closest("details")).not.toHaveAttribute("open");
  });
});
