/**
 * WB-05: CreationResourceDrawer open/close a11y, apply_prompt without auto-submit,
 * GenerationList reuse path, entry anchors, poller exclusivity, cancel confirm.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreationResourceDrawer } from "../CreationResourceDrawer";
import type { CreationAction } from "../creationActions";
import { revealWorkbenchAnchor } from "../workbenchNav";

const listByProject = vi.fn();
const promptsList = vi.fn();
const generationList = vi.fn();
const generationSubmit = vi.fn();

vi.mock("../../../api", () => ({
  trpc: {
    useUtils: () => ({
      prompts: { list: { invalidate: vi.fn() } },
      generation: {
        listByProject: { invalidate: vi.fn() },
        listByProjectPaged: { invalidate: vi.fn() },
      },
      quota: { my: { invalidate: vi.fn() } },
      scenes: { listByProject: { invalidate: vi.fn() } },
      projects: { assets: { invalidate: vi.fn() } },
    }),
    agents: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
      },
    },
    prompts: {
      list: {
        useQuery: (...args: unknown[]) => promptsList(...args),
      },
      remove: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
    },
    // 抽屜內嵌 PromptLibrary，每列都有靈感頻道「發布」鈕；少了這個替身整個抽屜渲染就炸
    community: {
      publishFromSource: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
    },
    generation: {
      listByProject: {
        useQuery: (...args: unknown[]) => generationList(...args),
      },
      listByProjectPaged: {
        useInfiniteQuery: () => ({
          data: undefined,
          isLoading: false,
          isError: false,
          fetchNextPage: vi.fn(),
          hasNextPage: false,
          isFetchingNextPage: false,
        }),
      },
      submit: {
        useMutation: () => ({ mutate: generationSubmit, isPending: false, error: null }),
      },
    },
  },
}));

vi.mock("@shared/models", () => ({
  getModel: (id: string) => (id === "fal-ai/flux/schnell" ? { label: "FLUX Schnell" } : undefined),
}));

/** Embed stub so drawer tests do not pull full GenerationList trpc surface. */
vi.mock("../../../components/GenerationList", () => ({
  GenerationList: ({
    onReuse,
  }: {
    projectId: string;
    canEdit?: boolean;
    onReuse?: (text: string, settings?: { modelId?: string | null }) => void;
  }) => (
    <div data-testid="generation-list">
      <button type="button" onClick={() => onReuse?.("舊生成", { modelId: "fal-ai/flux/schnell" })}>
        再用此設定
      </button>
    </div>
  ),
}));

vi.mock("../../../components/interactions", async () => {
  const actual = await vi.importActual<typeof import("../../../components/interactions")>(
    "../../../components/interactions",
  );
  return {
    ...actual,
    ConfirmButton: ({
      children,
      onConfirm,
    }: {
      children: React.ReactNode;
      onConfirm: () => void;
    }) => (
      <button type="button" onClick={() => onConfirm()}>
        {children}
      </button>
    ),
  };
});

const samplePrompt = {
  id: "p1",
  text: "清晨禪堂，一炷香緩緩升起",
  useCount: 2,
  modelId: "fal-ai/flux/schnell",
  characterIds: ["char-1"],
  scenePresetIds: ["scene-1"],
};

describe("CreationResourceDrawer (WB-05)", () => {
  const projectId = "project-1";

  beforeEach(() => {
    listByProject.mockReset();
    listByProject.mockReturnValue({ data: [], isLoading: false });
    promptsList.mockReset();
    promptsList.mockReturnValue({ data: [samplePrompt], isLoading: false });
    generationList.mockReset();
    generationList.mockReturnValue({
      data: [
        {
          id: "g1",
          status: "done",
          kind: "image",
          prompt: "舊生成",
          modelId: "fal-ai/flux/schnell",
          resultUrl: null,
          error: null,
          favorite: false,
          title: null,
          characterIds: null,
          scenePresetIds: null,
          sourceAssetId: null,
          sceneId: null,
          points: 1,
          createdAt: new Date().toISOString(),
        },
      ],
      isLoading: false,
      isError: false,
    });
    generationSubmit.mockReset();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("renders entry buttons and sec-prompts anchor without opening the dialog", () => {
    render(
      <CreationResourceDrawer projectId={projectId} currentMode="generate" canEdit />,
    );
    expect(document.getElementById("sec-prompts")).toBeTruthy();
    expect(screen.getByRole("group", { name: "開啟資源抽屜" })).toBeVisible();
    expect(screen.getByRole("button", { name: /提示詞庫/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /生成紀錄/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /執行軌跡/ })).toBeVisible();
    expect(screen.queryByRole("dialog", { name: "資源與結果" })).not.toBeInTheDocument();
  });

  it("when closed, generation-list-poller is mounted; open generations tab swaps to single list", async () => {
    const user = userEvent.setup();
    render(
      <CreationResourceDrawer projectId={projectId} currentMode="generate" canEdit />,
    );

    expect(screen.getByTestId("generation-list-poller")).toBeInTheDocument();
    // Poller hosts the list while closed
    expect(within(screen.getByTestId("generation-list-poller")).getByTestId("generation-list")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /生成紀錄/ }));
    const dialog = screen.getByRole("dialog", { name: "資源與結果" });
    expect(screen.queryByTestId("generation-list-poller")).not.toBeInTheDocument();
    expect(within(dialog).getAllByTestId("generation-list")).toHaveLength(1);
  });

  it("opens dialog with focus trap target, closes on Escape, returns focus to opener", async () => {
    const user = userEvent.setup();
    render(
      <CreationResourceDrawer projectId={projectId} currentMode="ask" canEdit />,
    );

    const openBtn = screen.getByRole("button", { name: /提示詞庫/ });
    await user.click(openBtn);
    const dialog = screen.getByRole("dialog", { name: "資源與結果" });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveAttribute("aria-modal", "true");

    // Escape closes (useFocusTrap) and returns focus to opener chip
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "資源與結果" })).not.toBeInTheDocument();
    expect(openBtn).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /生成紀錄/ }));
    expect(screen.getByRole("dialog", { name: "資源與結果" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "關閉資源抽屜" }));
    expect(screen.queryByRole("dialog", { name: "資源與結果" })).not.toBeInTheDocument();
  });

  it("ArrowRight on resource tablist moves selection (roving tabindex)", async () => {
    const user = userEvent.setup();
    render(
      <CreationResourceDrawer projectId={projectId} currentMode="ask" canEdit />,
    );

    await user.click(screen.getByRole("button", { name: /提示詞庫/ }));
    const promptsTab = screen.getByRole("tab", { name: /提示詞庫/ });
    expect(promptsTab).toHaveAttribute("aria-selected", "true");
    promptsTab.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /生成紀錄/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /生成紀錄/ })).toHaveFocus();
  });

  it("PromptLibrary 帶入目前模式 uses apply_prompt and does not auto-submit; notice on entry row", async () => {
    const user = userEvent.setup();
    const onCreationAction = vi.fn();
    render(
      <CreationResourceDrawer
        projectId={projectId}
        currentMode="generate"
        canEdit
        onCreationAction={onCreationAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: /提示詞庫/ }));
    const dialog = screen.getByRole("dialog", { name: "資源與結果" });
    const applyBtn = within(dialog).getByRole("button", {
      name: /帶入目前模式（直接出圖）/,
    });
    await user.click(applyBtn);

    expect(onCreationAction).toHaveBeenCalledOnce();
    const action = onCreationAction.mock.calls[0]![0] as CreationAction;
    expect(action).toMatchObject({
      type: "apply_prompt",
      promptId: "p1",
      targetMode: "generate",
      promptText: samplePrompt.text,
      modelId: samplePrompt.modelId,
    });
    expect(generationSubmit).not.toHaveBeenCalled();
    // Drawer closes after apply; notice is on entry row (visible when closed)
    expect(screen.queryByRole("dialog", { name: "資源與結果" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/已帶入「直接出圖」/);
  });

  it("apply_prompt to ask mode does not charge or submit", async () => {
    const user = userEvent.setup();
    const onCreationAction = vi.fn();
    render(
      <CreationResourceDrawer
        projectId={projectId}
        currentMode="ask"
        canEdit
        onCreationAction={onCreationAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: /提示詞庫/ }));
    await user.click(
      screen.getByRole("button", { name: /帶入目前模式（一起想）/ }),
    );

    expect(onCreationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "apply_prompt",
        targetMode: "ask",
        promptText: samplePrompt.text,
      }),
    );
    expect(generationSubmit).not.toHaveBeenCalled();
  });

  it("when onReuseGenerate is set for generate mode, uses that path without submit", async () => {
    const user = userEvent.setup();
    const onReuseGenerate = vi.fn(() => true);
    const onCreationAction = vi.fn();
    render(
      <CreationResourceDrawer
        projectId={projectId}
        currentMode="generate"
        canEdit
        onReuseGenerate={onReuseGenerate}
        onCreationAction={onCreationAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: /提示詞庫/ }));
    await user.click(screen.getByRole("button", { name: /帶入目前模式（直接出圖）/ }));

    expect(onReuseGenerate).toHaveBeenCalledOnce();
    expect(onReuseGenerate).toHaveBeenCalledWith(samplePrompt.text, {
      modelId: samplePrompt.modelId,
      characterIds: samplePrompt.characterIds,
      scenePresetIds: samplePrompt.scenePresetIds,
    });
    // Parent path owns generate apply — avoid double fill via apply_prompt
    expect(onCreationAction).not.toHaveBeenCalled();
    expect(generationSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "資源與結果" })).not.toBeInTheDocument();
  });

  it("when onReuseGenerate returns false (cancel confirm), drawer stays open with no success toast", async () => {
    const user = userEvent.setup();
    const onReuseGenerate = vi.fn(() => false);
    render(
      <CreationResourceDrawer
        projectId={projectId}
        currentMode="generate"
        canEdit
        onReuseGenerate={onReuseGenerate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /提示詞庫/ }));
    await user.click(screen.getByRole("button", { name: /帶入目前模式（直接出圖）/ }));

    expect(onReuseGenerate).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "資源與結果" })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(generationSubmit).not.toHaveBeenCalled();
  });

  it("GenerationList reuse still works and does not submit", async () => {
    const user = userEvent.setup();
    const onReuseGenerate = vi.fn(() => true);
    render(
      <CreationResourceDrawer
        projectId={projectId}
        currentMode="generate"
        canEdit
        onReuseGenerate={onReuseGenerate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /生成紀錄/ }));
    const dialog = screen.getByRole("dialog", { name: "資源與結果" });
    expect(within(dialog).getByTestId("generation-list")).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: /再用此設定/ }));
    expect(onReuseGenerate).toHaveBeenCalledWith("舊生成", { modelId: "fal-ai/flux/schnell" });
    expect(generationSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "資源與結果" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/已帶回直接出圖/);
  });

  it("GenerationList reuse cancel keeps drawer open", async () => {
    const user = userEvent.setup();
    const onReuseGenerate = vi.fn(() => false);
    render(
      <CreationResourceDrawer
        projectId={projectId}
        currentMode="generate"
        canEdit
        onReuseGenerate={onReuseGenerate}
      />,
    );

    await user.click(screen.getByRole("button", { name: /生成紀錄/ }));
    await user.click(screen.getByRole("button", { name: /再用此設定/ }));
    expect(onReuseGenerate).toHaveBeenCalledOnce();
    expect(screen.getByRole("dialog", { name: "資源與結果" })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("revealWorkbenchAnchor opens matching tab for #sec-prompts / generations / trail", async () => {
    const user = userEvent.setup();
    render(
      <CreationResourceDrawer projectId={projectId} currentMode="plan" canEdit />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    revealWorkbenchAnchor("#sec-prompts", { projectId });
    expect(await screen.findByRole("dialog", { name: "資源與結果" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /提示詞庫/ })).toHaveAttribute("aria-selected", "true");

    // Close via Escape then open generations
    await user.keyboard("{Escape}");
    revealWorkbenchAnchor("#sec-generations", { projectId });
    expect(await screen.findByRole("dialog", { name: "資源與結果" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /生成紀錄/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Escape}");
    revealWorkbenchAnchor("#sec-trail", { projectId });
    expect(await screen.findByRole("dialog", { name: "資源與結果" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /執行軌跡/ })).toHaveAttribute("aria-selected", "true");
  });

  it("execution trail links to plan mode via requestWorkbenchMode", async () => {
    const user = userEvent.setup();
    listByProject.mockReturnValue({
      data: [
        {
          id: "run-1",
          goal: "拆三格分鏡並出圖",
          status: "awaiting_approval",
          steps: [],
          planSummary: null,
        },
      ],
      isLoading: false,
    });

    render(
      <CreationResourceDrawer projectId={projectId} currentMode="ask" canEdit />,
    );

    await user.click(screen.getByRole("button", { name: /執行軌跡/ }));
    expect(screen.getByText(/拆三格分鏡並出圖/)).toBeVisible();
    expect(screen.getByRole("button", { name: /開啟計畫/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /前往多步開拍模式/ })).toBeVisible();
  });
});
