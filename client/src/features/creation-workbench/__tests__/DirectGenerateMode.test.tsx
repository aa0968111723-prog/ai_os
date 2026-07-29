/**
 * WB-02: DirectGenerateMode — disable reasons, cost summary points, submit payload shape.
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

vi.mock("../../../api", () => ({
  trpc: {
    useUtils: () => ({
      prompts: { list: { invalidate: vi.fn() } },
      generation: {
        listByProject: { invalidate: vi.fn() },
        listByProjectPaged: { invalidate: vi.fn() },
      },
      quota: { my: { invalidate: vi.fn() } },
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

describe("DirectGenerateMode", () => {
  beforeEach(() => {
    submitMutate.mockReset();
    saveMutate.mockReset();
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
    expect(screen.getByRole("status")).toHaveTextContent("本次模式：直接生成");
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

  it("shows ctx-summary chips for worldview / roles / scenes", () => {
    render(<Harness characterIds={["a", "b"]} scenePresetIds={["s1"]} />);
    const group = screen.getByRole("group", { name: "這次生成會帶入的上下文" });
    expect(within(group).getByText(/角色 2/)).toBeVisible();
    expect(within(group).getByText(/場景 1/)).toBeVisible();
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
});
