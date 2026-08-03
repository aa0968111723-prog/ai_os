/**
 * 逐鏡預覽：出圖前先看 AI 實際會收到什麼（不扣點、不送出）。
 * 重點是「送出的是這一鏡的卡片」——預覽若用了別的參數，它就在說謊。
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScenePromptPreview } from "./ScenePromptPreview";

const previewMutate = vi.fn();
let previewState: { data?: unknown; isPending: boolean; error: { message: string } | null } = {
  data: undefined,
  isPending: false,
  error: null,
};

vi.mock("../api", () => ({
  trpc: {
    generation: {
      preview: {
        useMutation: () => ({
          mutate: previewMutate,
          isPending: previewState.isPending,
          error: previewState.error,
          data: previewState.data,
        }),
      },
    },
  },
}));

const PREVIEW = {
  mode: "generate",
  title: "這次生成，AI 會怎麼理解",
  provider: "fal.ai",
  model: "SDXL Lightning",
  endpoint: "fal-ai/x",
  context: [
    { type: "worldview", label: "專案世界觀", included: true },
    { type: "character", label: "角色定裝 1", included: true },
    { type: "source", label: "沒有來源素材", included: false },
  ],
  request: { prompt: "清晨禪堂\n\n[角色定裝] 外觀鎖定 安倢：紅傘" },
  warnings: [],
  estimatedPoints: 3,
};

describe("ScenePromptPreview", () => {
  beforeEach(() => {
    previewMutate.mockReset();
    previewState = { data: undefined, isPending: false, error: null };
  });

  it("按下先預覽會用這一鏡的卡片送出（不是生成台的勾選）", async () => {
    const user = userEvent.setup();
    render(
      <ScenePromptPreview
        projectId="p1"
        modelId="m1"
        prompt="清晨禪堂"
        characterIds={["char-1"]}
        scenePresetIds={[]}
        propIds={["prop-1"]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /先預覽/ }));

    await waitFor(() => expect(previewMutate).toHaveBeenCalled());
    expect(previewMutate.mock.calls[0][0]).toStrictEqual({
      projectId: "p1",
      modelId: "m1",
      prompt: "清晨禪堂",
      characterIds: ["char-1"],
      // 空陣列不送 undefined 以外的東西——後端據此區分「沒帶」與「帶了空的」
      scenePresetIds: undefined,
      propIds: ["prop-1"],
    });
  });

  it("沒有提示詞時不能預覽（避免送出必定失敗的請求）", () => {
    render(
      <ScenePromptPreview projectId="p1" modelId="m1" prompt="   " characterIds={[]} scenePresetIds={[]} propIds={[]} />,
    );
    expect(screen.getByRole("button", { name: /先預覽/ })).toBeDisabled();
  });

  it("展開後列出帶入與沒帶入的項目，並顯示實際送出的提示詞與預估點數", async () => {
    const user = userEvent.setup();
    previewState = { data: PREVIEW, isPending: false, error: null };
    render(
      <ScenePromptPreview projectId="p1" modelId="m1" prompt="清晨禪堂" characterIds={["char-1"]} scenePresetIds={[]} propIds={[]} />,
    );

    await user.click(screen.getByRole("button", { name: /先預覽/ }));

    expect(screen.getByText(/帶入：專案世界觀・角色定裝 1/)).toBeVisible();
    expect(screen.getByText(/沒帶入：沒有來源素材/)).toBeVisible();
    expect(screen.getByText(/約 −3 點/)).toBeVisible();
    expect(screen.getByText(/\[角色定裝\] 外觀鎖定 安倢：紅傘/)).toBeVisible();
  });

  it("預覽失敗要說出原因，不是靜靜什麼都不顯示", async () => {
    const user = userEvent.setup();
    previewState = { data: undefined, isPending: false, error: { message: "此模型需要來源:image" } };
    render(
      <ScenePromptPreview projectId="p1" modelId="m1" prompt="清晨禪堂" characterIds={[]} scenePresetIds={[]} propIds={[]} />,
    );

    await user.click(screen.getByRole("button", { name: /先預覽/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("此模型需要來源:image");
  });
});
