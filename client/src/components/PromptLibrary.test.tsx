/**
 * WB-00 baseline: PromptLibrary 再用 / 製作範本 / 複製 / empty null.
 * Locks prompt reuse settings shape before workbench refactor.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PromptLibrary } from "./PromptLibrary";

const listQuery = vi.fn();
const removeMutate = vi.fn();
const invalidate = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      prompts: { list: { invalidate } },
    }),
    prompts: {
      list: {
        useQuery: (...args: unknown[]) => listQuery(...args),
      },
      remove: {
        useMutation: (opts?: { onSuccess?: () => void }) => ({
          mutate: (input: unknown) => {
            removeMutate(input);
            opts?.onSuccess?.();
          },
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("@shared/models", () => ({
  getModel: (id: string) => (id === "fal-ai/flux/schnell" ? { label: "FLUX Schnell" } : undefined),
}));

vi.mock("./interactions", () => ({
  ConfirmButton: ({
    children,
    disabled,
    onConfirm,
  }: {
    children: ReactNode;
    disabled?: boolean;
    onConfirm: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={() => onConfirm()}>
      {children}
    </button>
  ),
}));

const samplePrompt = {
  id: "p1",
  text: "清晨禪堂，一炷香緩緩升起",
  useCount: 3,
  modelId: "fal-ai/flux/schnell",
  characterIds: ["char-1", "char-2"],
  scenePresetIds: ["scene-1"],
};

describe("PromptLibrary", () => {
  beforeEach(() => {
    listQuery.mockReset();
    removeMutate.mockReset();
    invalidate.mockReset();
    listQuery.mockReturnValue({ data: [samplePrompt] });
  });

  it("returns null when the prompt list is empty (does not occupy layout)", () => {
    listQuery.mockReturnValue({ data: [] });
    const { container } = render(
      <PromptLibrary projectId="project-1" onUse={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("returns null while list data is still undefined", () => {
    listQuery.mockReturnValue({ data: undefined });
    const { container } = render(
      <PromptLibrary projectId="project-1" onUse={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("preserves server list order in the DOM (client does not re-sort) and shows settings chips", () => {
    // Server returns useCount-desc; client must render in array order without reordering.
    listQuery.mockReturnValue({
      data: [
        { ...samplePrompt, id: "p-high", text: "高頻咒語", useCount: 9 },
        { ...samplePrompt, id: "p-low", text: "低頻咒語", useCount: 1, modelId: null, characterIds: null, scenePresetIds: null },
      ],
    });
    render(<PromptLibrary projectId="project-1" onUse={vi.fn()} onUseForWorkflow={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /提示詞庫/ })).toBeVisible();
    const rows = document.querySelectorAll(".gen-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("高頻咒語");
    expect(rows[1]).toHaveTextContent("低頻咒語");
    expect(screen.getByText("用過 9 次")).toBeVisible();
    expect(screen.getByText(/FLUX Schnell・角色 2・場景 1/)).toBeVisible();
  });

  it("再用 passes text and full reuse settings (model / characters / scenes)", async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    render(<PromptLibrary projectId="project-1" onUse={onUse} />);

    await user.click(screen.getByRole("button", { name: "再用" }));
    expect(onUse).toHaveBeenCalledOnce();
    expect(onUse).toHaveBeenCalledWith(samplePrompt.text, {
      modelId: samplePrompt.modelId,
      characterIds: samplePrompt.characterIds,
      scenePresetIds: samplePrompt.scenePresetIds,
    });
  });

  it("製作範本 only appears when onUseForWorkflow is provided and passes text", async () => {
    const user = userEvent.setup();
    const onUseForWorkflow = vi.fn();

    const { rerender } = render(
      <PromptLibrary projectId="project-1" onUse={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "製作範本" })).not.toBeInTheDocument();

    rerender(
      <PromptLibrary projectId="project-1" onUse={vi.fn()} onUseForWorkflow={onUseForWorkflow} />,
    );
    await user.click(screen.getByRole("button", { name: "製作範本" }));
    expect(onUseForWorkflow).toHaveBeenCalledOnce();
    expect(onUseForWorkflow).toHaveBeenCalledWith(samplePrompt.text);
  });

  it("複製 writes prompt text to the clipboard and flashes 已複製", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<PromptLibrary projectId="project-1" onUse={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "複製" }));
    expect(writeText).toHaveBeenCalledWith(samplePrompt.text);
    expect(await screen.findByRole("button", { name: "已複製" })).toBeVisible();
  });

  it("delete mutates remove after confirm handler (ConfirmButton mock fires onConfirm)", async () => {
    // Real ConfirmButton two-step dialog is covered elsewhere; this locks mutate+invalidate contract.
    const user = userEvent.setup();
    render(<PromptLibrary projectId="project-1" onUse={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "刪除" }));
    expect(removeMutate).toHaveBeenCalledWith({ id: "p1" });
    expect(invalidate).toHaveBeenCalledWith({ projectId: "project-1" });
  });
});
