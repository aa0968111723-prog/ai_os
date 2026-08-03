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

  it("shows the measured window, and never a number it could not measure", () => {
    openPanel({
      ...basePreview,
      model: "SDXL Lightning",
      modelId: "fal-ai/fast-lightning-sdxl",
      request: { positivePrompt: "晨光禪堂點香\n\n[素材設定] 材質鎖定 紅傘：正紅色長柄傘" },
      // 伺服器實測的結果（server/services/promptTokens）；前端只畫，不自己算
      promptBudget: {
        encoder: { label: "雙 CLIP（SDXL）", note: "窗口 77", measured: true, sequenceTokens: 77, contentTokens: 75 },
        segments: [
          { key: "instruction", tokens: 60, chars: 6, startToken: 0, status: "inside" },
          { key: "prop", tokens: 40, chars: 20, startToken: 60, status: "truncated" },
        ],
        totalTokens: 100,
        totalChars: 26,
        overflows: true,
        chunks: [
          { text: "晨光禪堂點香", tokens: 60, startToken: 0, key: "instruction", status: "inside" },
          { text: "正紅色長柄傘", tokens: 40, startToken: 60, key: "prop", status: "truncated" },
        ],
      },
    });

    const window = screen.getByTestId("prompt-encoder-window");
    expect(window).toHaveTextContent("實測 100 / 75 token");
    expect(window).toHaveTextContent("不是估算");
    expect(screen.getByTestId("prompt-flow-node-prop")).toHaveTextContent("後半沒進模型");
    // 逐詞佔用：模型讀到哪些字，是量出來的
    expect(screen.getByTestId("prompt-token-map")).toHaveTextContent("正紅色長柄傘");
  });

  it("reports characters only when the model's tokenizer is not built in", () => {
    openPanel({
      ...basePreview,
      model: "FLUX.1 [dev]",
      modelId: "fal-ai/flux/dev",
      request: { positivePrompt: "晨光禪堂點香" },
      promptBudget: {
        encoder: { label: "T5-XXL（FLUX.1）", note: "窗口 512", measured: false, documentedLimitTokens: 512 },
        segments: [{ key: "instruction", tokens: null, chars: 6, startToken: null, status: "unmeasured" }],
        totalTokens: null,
        totalChars: 6,
        overflows: false,
        chunks: [],
      },
    });

    const window = screen.getByTestId("prompt-encoder-window");
    expect(window).toHaveTextContent("6 字・token 未量測");
    expect(window).toHaveTextContent("不假裝算得出來");
    // 量不到就不畫條帶、不畫逐詞圖、不下截斷判斷
    expect(screen.queryByTestId("token-budget-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prompt-token-map")).not.toBeInTheDocument();
    expect(screen.queryByText(/沒進模型/)).not.toBeInTheDocument();
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
