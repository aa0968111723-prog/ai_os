/**
 * WB-02: DirectGenerateMode — disable reasons, cost summary points, submit payload shape.
 * P2: recent generations strip shares listByProject + invalidate on submit.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { emptyDraft, type CreationDraft, type DraftPatch } from "../creationDraft";
import { buildGenerationSubmitInput } from "../generationGates";
import { DirectGenerateMode } from "../modes/DirectGenerateMode";

const submitMutate = vi.fn();
const saveMutate = vi.fn();
const listByProject = vi.fn();
const invalidateListByProject = vi.fn();
const invalidateListByProjectPaged = vi.fn();
const invalidateQuota = vi.fn();
const revealWorkbenchAnchor = vi.fn();

vi.mock("../../../api", () => ({
  trpc: {
    useUtils: () => ({
      prompts: { list: { invalidate: vi.fn() } },
      generation: {
        listByProject: { invalidate: (...a: unknown[]) => invalidateListByProject(...a) },
        listByProjectPaged: { invalidate: (...a: unknown[]) => invalidateListByProjectPaged(...a) },
      },
      quota: { my: { invalidate: (...a: unknown[]) => invalidateQuota(...a) } },
    }),
    projects: {
      assets: {
        useQuery: () => ({
          data: [
            { id: "asset-img", title: "禪堂", kind: "image" },
            { id: "asset-aud", title: "鐘聲", kind: "audio" },
          ],
        }),
      },
    },
    quota: {
      my: {
        useQuery: () => ({
          data: {
            totalRemaining: 100,
            weeklyQuota: 50,
            weeklyUsed: 3,
            dailyQuota: null,
            dailyUsed: 0,
            approvalThreshold: 20,
          },
        }),
      },
    },
    prompts: {
      save: {
        useMutation: () => ({ mutate: (...a: unknown[]) => saveMutate(...a), isPending: false }),
      },
    },
    generation: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
      },
      submit: {
        useMutation: (opts?: { onSuccess?: Function; onSettled?: Function }) => ({
          mutate: (vars: unknown) => {
            submitMutate(vars);
            opts?.onSuccess?.({ status: "queued", id: "g1" }, vars);
            opts?.onSettled?.();
          },
          isPending: false,
          error: null,
        }),
      },
    },
  },
}));

vi.mock("../../../components/ModelPicker", () => ({
  ModelPicker: ({ onChange }: { onChange: (m: unknown) => void }) => {
    queueMicrotask(() =>
      onChange({
        id: "fal-ai/flux/schnell",
        label: "FLUX Schnell",
        points: 1,
        needs: null,
        sourceHint: null,
        kind: "image",
        tierLabel: "經濟",
        strengths: "快",
        verified: true,
        recommended: true,
      }),
    );
    return (
      <div data-testid="model-picker">
        <label htmlFor="mp-category">創作類別</label>
        <select id="mp-category" defaultValue="text-to-image">
          <option value="text-to-image">文生圖</option>
        </select>
        <label htmlFor="mp-model">模型(點數透明)</label>
        <select id="mp-model" defaultValue="fal-ai/flux/schnell">
          <option value="fal-ai/flux/schnell">FLUX Schnell — 1 點</option>
        </select>
      </div>
    );
  },
}));

vi.mock("../../../components/GenerationList", () => ({
  GenerationList: () => <div data-testid="generation-list">generation-list</div>,
}));

vi.mock("../../../realtime", () => ({
  CollabZone: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("../workbenchNav", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workbenchNav")>();
  return {
    ...actual,
    revealWorkbenchAnchor: (...args: unknown[]) => revealWorkbenchAnchor(...args),
  };
});

function Harness({
  canEdit = true,
  myRole = "member",
  characterIds = [] as string[],
  scenePresetIds = [] as string[],
  initialPrompt = "",
  applyRequest = null as
    | {
        nonce: number;
        prompt?: string;
        modelId?: string | null;
        sourceAssetId?: string | null;
        sourceAsset?: { id: string; title: string; kind: string } | null;
      }
    | null,
  onSourceChange,
}: {
  canEdit?: boolean;
  myRole?: string;
  characterIds?: string[];
  scenePresetIds?: string[];
  initialPrompt?: string;
  applyRequest?: {
    nonce: number;
    prompt?: string;
    modelId?: string | null;
    sourceAssetId?: string | null;
    sourceAsset?: { id: string; title: string; kind: string } | null;
  } | null;
  onSourceChange?: (id: string | null) => void;
}) {
  const [draft, setDraftState] = useState<CreationDraft>(() => ({
    ...emptyDraft("generate"),
    prompt: initialPrompt,
  }));
  const setDraft = (patch: DraftPatch) =>
    setDraftState((prev) => ({
      ...prev,
      ...patch,
      sourceAssetIds: patch.sourceAssetIds ?? prev.sourceAssetIds,
      characterIds: patch.characterIds ?? prev.characterIds,
      scenePresetIds: patch.scenePresetIds ?? prev.scenePresetIds,
    }));

  return (
    <DirectGenerateMode
      projectId="proj-1"
      groupId="group-1"
      canEdit={canEdit}
      myRole={myRole}
      projectFormat="橫式 16:9"
      worldview={{ tones: ["靜謐"], styles: [], taboos: [] }}
      wvReady
      characterIds={characterIds}
      scenePresetIds={scenePresetIds}
      panelId="panel-gen"
      labelledBy="tab-gen"
      active
      draft={draft}
      setDraft={setDraft}
      applyRequest={applyRequest}
      onSourceChange={onSourceChange}
    />
  );
}

const SAMPLE_GENERATIONS = [
  {
    id: "gen-1",
    prompt: "清晨禪堂，柔和光線灑落木地板",
    name: null,
    status: "running",
    kind: "image",
    resultUrl: null,
  },
  {
    id: "gen-2",
    prompt: "晚鐘迴盪的山門",
    name: "山門草稿",
    status: "done",
    kind: "image",
    resultUrl: "https://example.com/thumb-2.png",
  },
  {
    id: "gen-3",
    prompt: "雨後苔石小路",
    name: null,
    status: "queued",
    kind: "image",
    resultUrl: null,
  },
];

describe("DirectGenerateMode", () => {
  beforeEach(() => {
    submitMutate.mockReset();
    saveMutate.mockReset();
    listByProject.mockReset();
    invalidateListByProject.mockReset();
    invalidateListByProjectPaged.mockReset();
    invalidateQuota.mockReset();
    revealWorkbenchAnchor.mockReset();
    listByProject.mockReturnValue({
      data: SAMPLE_GENERATIONS,
      isLoading: false,
      isError: false,
    });
  });

  it("surfaces disable reason when prompt is empty", async () => {
    render(<Harness />);
    await waitFor(() => {
      expect(screen.getByText("先填一句提示詞，描述想要的畫面")).toBeVisible();
    });
    const btn = screen.getByRole("button", { name: /生成/ });
    expect(btn).toBeDisabled();
  });

  it("surfaces viewer read-only disable reason", async () => {
    render(<Harness canEdit={false} initialPrompt="禪堂" />);
    await waitFor(() => {
      expect(
        screen.getByText(/你在此專案是檢視者（唯讀），不能生成/),
      ).toBeVisible();
    });
    expect(screen.getByRole("button", { name: /生成/ })).toBeDisabled();
  });

  it("shows cost summary with estimated points", async () => {
    render(<Harness initialPrompt="清晨禪堂" />);
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/預估消耗：約 \d+ 點/);
    });
    expect(screen.getByRole("status")).toHaveTextContent("本次模式：直接出圖");
  });

  it("keeps #sec-studio and #gen-prompt anchors", () => {
    render(<Harness />);
    expect(document.getElementById("sec-studio")).toBeTruthy();
    expect(document.getElementById("gen-prompt")).toBeTruthy();
  });

  it("submit uses buildGenerationSubmitInput payload shape", async () => {
    const user = userEvent.setup();
    render(<Harness initialPrompt="清晨禪堂，柔和光線" characterIds={["c1"]} />);

    const genBtn = await screen.findByRole("button", { name: /生成（−/ });
    expect(genBtn).not.toBeDisabled();
    await user.click(genBtn);

    const confirm = await screen.findByRole("button", { name: "確認生成" });
    await user.click(confirm);

    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(1));
    const payload = submitMutate.mock.calls[0][0];
    const expected = buildGenerationSubmitInput({
      projectId: "proj-1",
      model: {
        id: "fal-ai/flux/schnell",
        points: 1,
        needs: null,
      },
      prompt: "清晨禪堂，柔和光線",
      sourceAsset: null,
      sourceUrl: "",
      characterIds: ["c1"],
      scenePresetIds: [],
      clientRequestId: payload.clientRequestId,
    });
    expect(payload).toEqual(expected);
    expect(payload.prompt).toBe("清晨禪堂，柔和光線");
    expect(payload.characterIds).toEqual(["c1"]);
    expect(payload.modelId).toBe("fal-ai/flux/schnell");
    expect(typeof payload.clientRequestId).toBe("string");
  });

  it("keeps advanced and AI understanding collapsed on the main path", async () => {
    render(<Harness initialPrompt="清晨禪堂" characterIds={["c1"]} />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /生成（−/ })).toBeInTheDocument();
    });
    const advanced = screen.getByTestId("generate-advanced");
    expect(advanced).not.toHaveAttribute("open");
    // jsdom still mounts <details> children; assert they are not visible until expanded.
    expect(within(advanced).getByRole("button", { name: /一致性鎖定/ })).not.toBeVisible();
    const ai = screen.getByTestId("ai-understanding-details");
    expect(ai).not.toHaveAttribute("open");
    expect(within(ai).getByRole("button", { name: "AI 會怎麼理解？" })).not.toBeVisible();
    // Cost row stays visible without expand.
    expect(screen.getByRole("status")).toHaveTextContent(/預估消耗：約 \d+ 點/);
  });

  it("shows consistency locking for selected cards and submits the user's choice", async () => {
    const user = userEvent.setup();
    render(<Harness initialPrompt="清晨禪堂" characterIds={["c1"]} />);
    // P0: expand 進階設定 before interacting with continuity lock.
    const advanced = await screen.findByTestId("generate-advanced");
    await user.click(within(advanced).getByText(/進階設定/));
    const lock = await screen.findByRole("button", { name: "一致性鎖定：開" });
    expect(lock).toHaveAttribute("aria-pressed", "true");
    await user.click(lock);
    expect(screen.getByRole("button", { name: "一致性鎖定：關" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: /生成（−/ }));
    await user.click(await screen.findByRole("button", { name: "確認生成" }));
    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(1));
    expect(submitMutate.mock.calls[0][0]).toMatchObject({ continuityMode: false });
  });

  it("shows ctx-summary chips for worldview / roles / scenes", () => {
    render(<Harness characterIds={["a", "b"]} scenePresetIds={["s1"]} />);
    const group = screen.getByRole("group", { name: "這次生成會帶入的上下文" });
    // C2：摘要句 + chip 都含「角色 2」——用 role=button 鎖定 chip
    expect(within(group).getByRole("button", { name: /角色 2/ })).toBeVisible();
    expect(within(group).getByRole("button", { name: /場景 1/ })).toBeVisible();
    expect(within(group).getByTestId("gen-bring-in-summary")).toHaveTextContent(/角色 2/);
  });

  it("resolves applyRequest sourceAssetId and notifies onSourceChange", async () => {
    const onSourceChange = vi.fn();
    const { rerender } = render(
      <Harness
        onSourceChange={onSourceChange}
        applyRequest={{ nonce: 1, sourceAssetId: "asset-img" }}
      />,
    );
    await waitFor(() => {
      expect(onSourceChange).toHaveBeenCalledWith("asset-img");
    });
    // Parent can clear by applying empty object form
    rerender(
      <Harness
        onSourceChange={onSourceChange}
        applyRequest={{
          nonce: 2,
          sourceAsset: null,
        }}
      />,
    );
    // sourceAsset: null in apply does not clear today — only form UI clear does.
    // Setting a new object source updates highlight:
    rerender(
      <Harness
        onSourceChange={onSourceChange}
        applyRequest={{
          nonce: 3,
          sourceAsset: { id: "asset-aud", title: "鐘聲", kind: "audio" },
        }}
      />,
    );
    await waitFor(() => {
      expect(onSourceChange).toHaveBeenCalledWith("asset-aud");
    });
  });

  it("P2: recent generations strip shows listByProject items (client-sliced)", async () => {
    render(<Harness initialPrompt="清晨禪堂" />);
    const strip = await screen.findByTestId("recent-generations-strip");
    expect(strip).toBeVisible();
    expect(within(strip).getByText("最近生成")).toBeVisible();
    // Same query key as GenerationList for cache sharing.
    expect(listByProject).toHaveBeenCalledWith(
      { projectId: "proj-1" },
      expect.objectContaining({ refetchInterval: expect.any(Function) }),
    );
    const items = within(strip).getAllByTestId("recent-generation-item");
    expect(items).toHaveLength(3);
    expect(within(strip).getByText("生成中…")).toBeVisible();
    expect(within(strip).getByText("山門草稿")).toBeVisible();
    expect(within(strip).getByText("排隊中")).toBeVisible();
    // Done image with resultUrl gets a compact thumb (alt="" is decorative).
    const thumb = strip.querySelector('img[src="https://example.com/thumb-2.png"]');
    expect(thumb).toBeTruthy();
  });

  it("P2: 全部紀錄 opens the generations drawer anchor", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const strip = await screen.findByTestId("recent-generations-strip");
    await user.click(within(strip).getByRole("button", { name: "全部紀錄" }));
    expect(revealWorkbenchAnchor).toHaveBeenCalledWith("#sec-generations", {
      projectId: "proj-1",
    });
  });

  it("P2: submit still invalidates listByProject (strip + drawer share cache)", async () => {
    const user = userEvent.setup();
    render(<Harness initialPrompt="清晨禪堂，柔和光線" />);

    await user.click(await screen.findByRole("button", { name: /生成（−/ }));
    await user.click(await screen.findByRole("button", { name: "確認生成" }));

    await waitFor(() => expect(submitMutate).toHaveBeenCalledTimes(1));
    expect(invalidateListByProject).toHaveBeenCalledWith({ projectId: "proj-1" });
    expect(invalidateListByProjectPaged).toHaveBeenCalledWith({ projectId: "proj-1" });
    expect(invalidateQuota).toHaveBeenCalled();
    // Notice still surfaces near the form (above the strip); cost summary also uses role=status.
    expect(
      screen.getAllByRole("status").some((el) => /已送出/.test(el.textContent ?? "")),
    ).toBe(true);
  });
});
