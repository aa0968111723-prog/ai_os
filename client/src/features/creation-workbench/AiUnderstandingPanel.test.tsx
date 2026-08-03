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
  const basePreview: AiOperationPreview = {
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

  const openPanel = (preview: AiOperationPreview = basePreview) => {
    const onPreview = vi.fn();
    render(
      <AiUnderstandingPanel
        projectId="project-1"
        preview={preview}
        onPreview={onPreview}
        onOverrideChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "AI 會怎麼理解？" }));
    return { onPreview };
  };

  it("defaults to the flow map so the assembled prompt reads as a diagram, not a wall of text", () => {
    const { onPreview } = openPanel();
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("prompt-flow-map")).toBeInTheDocument();
    expect(screen.getByTestId("prompt-flow-node-instruction")).toHaveTextContent("角色設定");
    // 終點節點承接 provider／模型／參數，故不再另外印一排 chips
    const modelNode = screen.getByTestId("prompt-flow-node-model");
    expect(modelNode).toHaveTextContent("fal.ai");
    expect(modelNode).toHaveTextContent("Test Model");
    expect(screen.getByText("畫面比例")).toBeInTheDocument();
    expect(screen.getByText("9:16")).toBeInTheDocument();
    // 負向提示詞在圖解裡是獨立的一段「擋掉什麼」
    expect(screen.getByTestId("prompt-flow-node-negative")).toHaveTextContent("不要改變臉部");
    expect(screen.getByText("開發者資料：完整請求 JSON").closest("details")).not.toHaveAttribute("open");
  });

  it("puts each section of the assembled prompt on its own node", () => {
    openPanel({
      ...basePreview,
      request: {
        positivePrompt: "晨光禪堂點香\n\n[專案背景] 調性:療癒|核心訊息:把心交給佛\n\n[角色定裝] 外觀鎖定 安捷：紅色雨傘",
      },
      warnings: [{
        code: "card_images_not_sent",
        severity: "warning",
        title: "卡片參考圖沒有直接送給模型",
        detail: "本次只有卡片文字錨點進入 prompt。",
      }],
    });

    expect(screen.getByTestId("prompt-flow-node-instruction")).toHaveTextContent("晨光禪堂點香");
    expect(screen.getByTestId("prompt-flow-node-background")).toHaveTextContent("把心交給佛");
    const characterNode = screen.getByTestId("prompt-flow-node-character");
    expect(characterNode).toHaveTextContent("安捷");
    // 警告掛在它描述的那一段旁邊，不再堆在面板最上方讓使用者自己對照
    expect(characterNode).toHaveTextContent("卡片參考圖沒有直接送給模型");
  });

  it("flags the sections a 77-token CLIP window cannot reach", () => {
    openPanel({
      ...basePreview,
      model: "SDXL Lightning",
      modelId: "fal-ai/fast-lightning-sdxl",
      request: {
        positivePrompt: [
          "一位訪客在晨光禪堂點起一炷香，在陪伴與整理之間，把浮躁的心慢慢交還給平靜",
          "[專案背景] 調性:療癒|視覺風格:手繪插畫|核心訊息:把心交給佛，日子就有了呼吸的空隙",
          "[素材設定] 材質鎖定 紅傘：正紅色長柄傘、木質握把、傘面微舊",
        ].join("\n\n"),
      },
    });

    expect(screen.getByTestId("prompt-encoder-window")).toHaveTextContent("雙 CLIP（SDXL）");
    // 截斷從尾端發生：最後疊上去的素材設定確定有內容進不了模型
    expect(screen.getByTestId("prompt-flow-node-prop")).toHaveTextContent(/沒進模型/);
    // 開頭的使用者指令一定在窗口內，不該被標成截斷
    expect(screen.getByTestId("prompt-flow-node-instruction")).not.toHaveTextContent(/沒進模型/);
  });

  it("does not claim truncation for a model whose window is undisclosed", () => {
    openPanel({
      ...basePreview,
      model: "Ideogram v4",
      modelId: "fal-ai/ideogram/v4",
      request: { positivePrompt: `很長的一段中文${"，再加一段描述".repeat(60)}` },
    });

    const window = screen.getByTestId("prompt-encoder-window");
    expect(window).toHaveTextContent("未公開");
    expect(window).toHaveTextContent("token");
    expect(screen.queryByText(/沒進模型/)).not.toBeInTheDocument();
    expect(screen.queryByText("可能超出窗口")).not.toBeInTheDocument();
  });

  it("still shows the verbatim prompt after switching to the text view", () => {
    openPanel();
    fireEvent.click(screen.getByRole("button", { name: "看原文" }));
    expect(screen.queryByTestId("prompt-flow-map")).not.toBeInTheDocument();
    expect(screen.getByTestId("readable-positive-prompt").textContent).toBe("角色設定\n場景設定\n素材設定");
    expect(screen.getByText("畫面比例")).toBeInTheDocument();
    expect(screen.getByText("9:16")).toBeInTheDocument();
  });
});
