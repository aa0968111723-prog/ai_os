/**
 * WB-00 baseline: GenerationList canEdit gate for 加入分鏡 / 再用此設定.
 * Isolated trpc mocks — does not mount ProjectPage.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationList } from "./GenerationList";

const listByProject = vi.fn();
const listByProjectPaged = vi.fn();
const scenesList = vi.fn();
const charactersList = vi.fn();
const scenePresetsList = vi.fn();
const meQuery = vi.fn();
const addFromGeneration = vi.fn();
const invalidate = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      generation: {
        listByProject: { invalidate },
        listByProjectPaged: { invalidate },
      },
      quota: { my: { invalidate } },
      scenes: { listByProject: { invalidate } },
      projects: { assets: { invalidate } },
    }),
    generation: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
      },
      listByProjectPaged: {
        useQuery: (...args: unknown[]) => listByProjectPaged(...args),
        useInfiniteQuery: (...args: unknown[]) => listByProjectPaged(...args),
      },
      status: {
        useQuery: () => ({ data: { status: "done" } }),
      },
      retry: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
      rename: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      toggleFavorite: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      decideCost: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
    },
    scenes: {
      listByProject: {
        useQuery: (...args: unknown[]) => scenesList(...args),
      },
      addFromGeneration: {
        useMutation: (opts?: { onSuccess?: (d: unknown, v: { generationId: string }) => void }) => ({
          mutate: (input: { generationId: string }) => {
            addFromGeneration(input);
            opts?.onSuccess?.(null, input);
          },
          isPending: false,
          error: null,
        }),
      },
      setVisualFromGeneration: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
    },
    characters: {
      list: {
        useQuery: (...args: unknown[]) => charactersList(...args),
      },
    },
    scenePresets: {
      list: {
        useQuery: (...args: unknown[]) => scenePresetsList(...args),
      },
    },
    auth: {
      me: {
        useQuery: (...args: unknown[]) => meQuery(...args),
      },
    },
  },
}));

vi.mock("./Icon", () => ({
  Icon: () => <span aria-hidden="true" />,
}));

vi.mock("./interactions", () => ({
  ConfirmButton: ({
    children,
    onConfirm,
  }: {
    children: ReactNode;
    onConfirm: () => void;
  }) => (
    <button type="button" onClick={() => onConfirm()}>
      {children}
    </button>
  ),
}));

vi.mock("./GenerationCopy", () => ({
  GenerationPromptCopy: ({ text }: { text: string }) => <div>{text}</div>,
  GenerationResultCopy: ({ text }: { text: string }) => <div>{text}</div>,
}));

vi.mock("./MediaFallback", () => ({
  AssetVideo: () => <div data-testid="asset-video" />,
  AssetAudio: () => <div data-testid="asset-audio" />,
  MissingMediaBox: () => <div data-testid="missing-media" />,
}));

vi.mock("../discuss", () => ({
  discussInMessages: vi.fn(),
}));

vi.mock("@shared/models", () => ({
  getModel: () => ({ label: "FLUX" }),
}));

const doneImage = {
  id: "gen-1",
  status: "done",
  kind: "image",
  prompt: "禪堂清晨",
  resultUrl: "https://cdn.example/a.png",
  resultText: null,
  error: null,
  modelId: "fal-ai/flux/schnell",
  pointsEst: 1,
  groupId: "group-1",
  sceneId: null,
  characterIds: null,
  scenePresetIds: null,
  sourceUrl: null,
  favorite: false,
  name: null,
  createdAt: new Date("2026-01-15T10:00:00Z").toISOString(),
};

describe("GenerationList canEdit gates (WB-00)", () => {
  beforeEach(() => {
    listByProject.mockReset();
    listByProjectPaged.mockReset();
    scenesList.mockReset();
    charactersList.mockReset();
    scenePresetsList.mockReset();
    meQuery.mockReset();
    addFromGeneration.mockReset();
    invalidate.mockReset();

    listByProject.mockReturnValue({ data: [doneImage], isLoading: false });
    listByProjectPaged.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    scenesList.mockReturnValue({ data: [] });
    charactersList.mockReturnValue({ data: [] });
    scenePresetsList.mockReturnValue({ data: [] });
    meQuery.mockReturnValue({ data: { user: { id: "u1" }, groups: [] } });
  });

  it("shows 加入分鏡 for editors and mutates addFromGeneration", async () => {
    const user = userEvent.setup();
    render(<GenerationList projectId="project-1" canEdit onReuse={vi.fn()} />);

    const addBtn = screen.getByRole("button", { name: /加入分鏡/ });
    expect(addBtn).toBeVisible();
    await user.click(addBtn);
    expect(addFromGeneration).toHaveBeenCalledWith({ generationId: "gen-1" });
  });

  it("hides 加入分鏡 and 再用此設定 when canEdit is false (viewer)", () => {
    render(<GenerationList projectId="project-1" canEdit={false} onReuse={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /加入分鏡/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "再用此設定" })).not.toBeInTheDocument();
    // status pill still visible for read-only browsing
    expect(screen.getByText("完成 ✓")).toBeVisible();
    expect(screen.getByText("禪堂清晨")).toBeVisible();
  });

  it("再用此設定 passes full settings when canEdit", async () => {
    const user = userEvent.setup();
    const onReuse = vi.fn();
    listByProject.mockReturnValue({
      data: [
        {
          ...doneImage,
          characterIds: ["c1"],
          scenePresetIds: ["s1"],
        },
      ],
      isLoading: false,
    });

    render(<GenerationList projectId="project-1" canEdit onReuse={onReuse} />);
    await user.click(screen.getByRole("button", { name: "再用此設定" }));
    expect(onReuse).toHaveBeenCalledWith("禪堂清晨", {
      modelId: "fal-ai/flux/schnell",
      characterIds: ["c1"],
      scenePresetIds: ["s1"],
      sourceAssetId: null,
    });
  });
});
