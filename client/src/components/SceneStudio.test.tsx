/**
 * 單格工作室（SceneStudio）：把一格拉出來獨立修的三件事——修正／重畫／版本切換。
 * 隔離 trpc mock，不掛 ProjectPage。重點在「花錢的鈕何時可按」與「檢視者唯讀」，
 * 這兩件事錯了就是扣了點或越權，畫面看不出來。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSceneVersions, type SceneVersionGenerationRow } from "@shared/sceneVersions";
import { SceneStudio } from "./SceneStudio";

const versionsQuery = vi.fn();
const updateMutate = vi.fn();
const regenMutate = vi.fn();
const refineMutate = vi.fn();
const voiceMutate = vi.fn();
const setCurrentMutate = vi.fn();
const invalidate = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({ scenes: { versions: { invalidate } } }),
    scenes: {
      versions: { useQuery: (...args: unknown[]) => versionsQuery(...args) },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false, isSuccess: false, error: null }) },
      generateInto: { useMutation: () => ({ mutate: regenMutate, isPending: false, error: null }) },
      refine: { useMutation: () => ({ mutate: refineMutate, isPending: false, error: null }) },
      generateVoiceover: { useMutation: () => ({ mutate: voiceMutate, isPending: false, error: null }) },
      setVisualFromAsset: { useMutation: () => ({ mutate: setCurrentMutate, isPending: false, error: null }) },
    },
  },
}));

function genRow(over: Partial<SceneVersionGenerationRow> & { generationId: string; createdAt: string }): SceneVersionGenerationRow {
  return {
    status: "done",
    sceneRole: "visual",
    modelId: "fal-ai/fast-lightning-sdxl",
    prompt: "黃昏的海邊",
    sourceUrl: null,
    error: null,
    pointsEst: 1,
    pointsActual: 1,
    pointsRefunded: 0,
    assetId: `asset-${over.generationId}`,
    assetUrl: `https://example.test/${over.generationId}.png`,
    assetKind: "image",
    ...over,
  };
}

/** 伺服器回傳的形狀（scenes.versions）——用真的 buildSceneVersions 產生，避免 mock 與正式投影分岔 */
function serverData(opts: { rows?: SceneVersionGenerationRow[]; currentAssetId?: string | null; prompt?: string | null; voiceover?: string | null } = {}) {
  const rows = opts.rows ?? [genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" })];
  const currentAssetId = opts.currentAssetId === undefined ? "asset-g1" : opts.currentAssetId;
  const versions = buildSceneVersions(rows, { assetId: currentAssetId, narrationAssetId: null });
  return {
    sceneId: "s-1",
    projectId: "p-1",
    title: "海邊遠景",
    prompt: opts.prompt === undefined ? "黃昏的海邊" : opts.prompt,
    voiceover: opts.voiceover ?? null,
    assetId: currentAssetId,
    narrationAssetId: null,
    versions,
    summary: {
      visual: versions.filter((v) => v.role === "visual").length,
      narration: 0,
      generating: versions.some((v) => v.state === "generating"),
      currentVisualIndex: versions.find((v) => v.isCurrent)?.index ?? null,
      currentNarrationIndex: null,
    },
    truncated: false,
  };
}

type DecideProps = {
  isLeader?: boolean;
  meLoading?: boolean;
  sceneStatus?: string;
  pendingApprovalId?: string;
  rejectReason?: string | null;
  approvalsError?: boolean;
  deciding?: boolean;
  onDecide?: (decision: "approved" | "needs_work", reason?: string) => void;
};

function mountStudio(over: { canEdit?: boolean } & DecideProps = {}) {
  const { canEdit, ...decide } = over;
  return render(
    <SceneStudio
      sceneId="s-1"
      projectId="p-1"
      sceneNumber={3}
      canEdit={canEdit ?? true}
      onClose={vi.fn()}
      onChanged={vi.fn()}
      {...decide}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  versionsQuery.mockReturnValue({ data: serverData(), isLoading: false, isError: false, refetch: vi.fn() });
});

describe("SceneStudio", () => {
  it("開起來就是這一格：標題帶鏡次，預設停在「修正這張」", () => {
    mountStudio();
    expect(screen.getByRole("dialog", { name: /第 3 鏡・單格工作室/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /修正這張/ })).toHaveAttribute("aria-selected", "true");
  });

  it("有現用畫面時，底圖預設就是它，寫了指示才能送修正", async () => {
    const user = userEvent.setup();
    mountStudio();
    expect(screen.getByText(/底圖：這一格現用畫面/)).toBeInTheDocument();
    // 還沒寫「要改哪裡」→ 不能送（送出去也只是白扣點）
    expect(screen.getByRole("button", { name: /修正這張/ })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /要改哪裡/ }), "把天空換成黃昏");
    expect(screen.getByRole("button", { name: /修正這張/ })).toBeEnabled();
  });

  it("送出修正會帶底圖與冪等鍵（同一格的重試不重複扣點）", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.type(screen.getByRole("textbox", { name: /要改哪裡/ }), "把天空換成黃昏");
    await user.click(screen.getByRole("button", { name: /修正這張/ }));
    await user.click(screen.getByRole("button", { name: "確認修正" }));
    expect(refineMutate).toHaveBeenCalledTimes(1);
    const arg = refineMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.sceneId).toBe("s-1");
    expect(arg.sourceAssetId).toBe("asset-g1");
    expect(arg.prompt).toBe("把天空換成黃昏");
    expect(typeof arg.clientRequestId).toBe("string");
  });

  it("這一格還沒有畫面：不給修正，指路去重畫", () => {
    versionsQuery.mockReturnValue({
      data: serverData({ rows: [], currentAssetId: null }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    expect(screen.getByText(/還沒有可以當底圖的圖片/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /修正這張（/ })).not.toBeInTheDocument();
  });

  it("影片版本不能當底圖（圖生圖吃不了影片）", () => {
    versionsQuery.mockReturnValue({
      data: serverData({ rows: [genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z", assetKind: "video" })] }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    expect(screen.getByText(/還沒有可以當底圖的圖片/)).toBeInTheDocument();
  });

  it("這一格正在生成時，修正與重畫都鎖住（不讓同一格併發送出、重複扣點）", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [
          genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" }),
          genRow({ generationId: "g2", createdAt: "2026-07-02T00:00:00.000Z", status: "running", assetId: null, assetUrl: null, assetKind: null }),
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.type(screen.getByRole("textbox", { name: /要改哪裡/ }), "改天空");
    expect(screen.getByRole("button", { name: "生成中…" })).toBeDisabled();
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    expect(screen.getByRole("button", { name: "生成中…" })).toBeDisabled();
  });

  it("配音生成中不鎖畫面：修正與重畫照樣可送（旁白與畫面互不阻擋）", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [
          genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" }),
          // 進行中的是「旁白」生成——後端明寫兩者互不阻擋，分鏡列的 pendingGenStatus 也排除 narration。
          // 若這裡改回吃 summary.generating（不分 role），下面兩個斷言會立刻紅。
          genRow({
            generationId: "g2",
            createdAt: "2026-07-02T00:00:00.000Z",
            sceneRole: "narration",
            status: "running",
            assetId: null,
            assetUrl: null,
            assetKind: null,
          }),
        ],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.type(screen.getByRole("textbox", { name: /要改哪裡/ }), "改天空");
    expect(screen.getByRole("button", { name: /修正這張/ })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    expect(screen.getByRole("button", { name: /重畫這格（/ })).toBeEnabled();
  });

  it("重畫這格用的是這一格的提示詞；提示詞空白就不給按", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    await user.click(screen.getByRole("button", { name: /重畫這格（/ }));
    await user.click(screen.getByRole("button", { name: "確認重畫" }));
    expect(regenMutate.mock.calls[0]![0]).toMatchObject({ sceneId: "s-1", prompt: "黃昏的海邊" });
  });

  it("提示詞改了還沒存：提醒先存，重畫才會用新的", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.type(screen.getByRole("textbox", { name: /這一格的提示詞/ }), "，逆光");
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    expect(screen.getByText(/提示詞還沒儲存/)).toBeInTheDocument();
  });

  it("儲存提示詞只改這一格", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.type(screen.getByRole("textbox", { name: /這一格的提示詞/ }), "，逆光");
    await user.click(screen.getByRole("button", { name: /儲存提示詞/ }));
    expect(updateMutate).toHaveBeenCalledWith({ sceneId: "s-1", prompt: "黃昏的海邊，逆光" });
  });

  it("版本頁列出每一版，現用的那版不給「設為現用」，舊版可以切回", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [
          genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" }),
          genRow({ generationId: "g2", createdAt: "2026-07-02T00:00:00.000Z" }),
        ],
        currentAssetId: "asset-g2",
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /版本/ }));
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    // 新到舊：第一筆是現用的第 2 版
    expect(within(items[0]!).getByText("畫面第 2 版")).toBeInTheDocument();
    expect(within(items[0]!).queryByRole("button", { name: /設為現用/ })).not.toBeInTheDocument();
    await user.click(within(items[1]!).getByRole("button", { name: /設為現用/ }));
    expect(setCurrentMutate).toHaveBeenCalledWith({ sceneId: "s-1", assetId: "asset-g1" });
  });

  it("「以這版為底圖」會跳回修正頁並換掉底圖", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [
          genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" }),
          genRow({ generationId: "g2", createdAt: "2026-07-02T00:00:00.000Z" }),
        ],
        currentAssetId: "asset-g2",
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /版本/ }));
    const older = screen.getAllByRole("listitem")[1]!;
    await user.click(within(older).getByRole("button", { name: /以這版為底圖/ }));
    expect(screen.getByRole("tab", { name: /修正這張/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/底圖：第 1 版/)).toBeInTheDocument();
  });

  it("「用這版提示詞」把舊版指示抄回這一格（尚未儲存，交給人確認）", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z", prompt: "清晨薄霧" })],
        prompt: "黃昏的海邊",
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /版本/ }));
    await user.click(screen.getByRole("button", { name: /用這版提示詞/ }));
    expect(screen.getByRole("textbox", { name: /這一格的提示詞/ })).toHaveValue("清晨薄霧");
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("失敗的版本標示已退點，且不能設為現用", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z", status: "failed", error: "供應商逾時", assetId: null, assetUrl: null, assetKind: null, pointsRefunded: 1 })],
        currentAssetId: null,
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /版本/ }));
    expect(screen.getByText(/供應商逾時（已退點）/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /設為現用/ })).not.toBeInTheDocument();
  });

  it("配音頁：還沒填配音詞→生成鈕鎖住並指路；填了要先儲存", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /配音/ }));
    expect(screen.getByText(/先填配音詞並儲存/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^生成配音/ })).toBeDisabled();
    // 打了字＝尚未儲存：儲存鈕亮起、生成仍鎖（後端唸的是已儲存的稿）
    await user.type(screen.getByRole("textbox", { name: /這一格的配音詞/ }), "各位同學大家好");
    expect(screen.getByRole("button", { name: /儲存配音詞/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^生成配音/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /儲存配音詞/ }));
    expect(updateMutate).toHaveBeenCalledWith({ sceneId: "s-1", voiceover: "各位同學大家好" });
  });

  it("配音詞已儲存：生成配音帶冪等鍵送出（重試不重複扣點）", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({ voiceover: "各位同學大家好" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /配音/ }));
    await user.click(screen.getByRole("button", { name: /^生成配音/ }));
    await user.click(screen.getByRole("button", { name: "確認生成" }));
    expect(voiceMutate).toHaveBeenCalledTimes(1);
    const arg = voiceMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.sceneId).toBe("s-1");
    expect(typeof arg.clientRequestId).toBe("string");
  });

  it("檢視者的配音頁：唯讀，沒有編輯與生成鈕", async () => {
    const user = userEvent.setup();
    mountStudio({ canEdit: false });
    await user.click(screen.getByRole("tab", { name: /配音/ }));
    expect(screen.getByText(/只能試聽旁白/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /這一格的配音詞/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^生成配音/ })).not.toBeInTheDocument();
  });

  it("檢視者：看得到版本與成本，但沒有任何寫入鈕（2.3 唯讀）", async () => {
    const user = userEvent.setup();
    mountStudio({ canEdit: false });
    expect(screen.getByText(/你是檢視者/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /儲存提示詞/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /版本/ }));
    expect(screen.getByText("畫面第 1 版")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /設為現用/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /以這版為底圖/ })).not.toBeInTheDocument();
  });

  it("版本讀不到時給重試，不會假裝成「沒有版本」", async () => {
    const refetch = vi.fn();
    versionsQuery.mockReturnValue({ data: undefined, isLoading: false, isError: true, refetch });
    const user = userEvent.setup();
    mountStudio();
    expect(screen.getByRole("alert")).toHaveTextContent(/版本讀不到/);
    await user.click(screen.getByRole("button", { name: "再試一次" }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("SceneStudio 就地裁決", () => {
  const leaderPending = {
    isLeader: true,
    sceneStatus: "pending",
    pendingApprovalId: "ap-1",
  } as const;

  it("組長看待審的這一鏡：通過與退回都在工作室內", () => {
    mountStudio({ ...leaderPending, onDecide: vi.fn() });
    expect(screen.getByRole("button", { name: /通過/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /退回/ })).toBeEnabled();
  });

  it("按通過直接回報決定，不必先回分鏡列", async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    mountStudio({ ...leaderPending, onDecide });
    await user.click(screen.getByRole("button", { name: /通過/ }));
    expect(onDecide).toHaveBeenCalledWith("approved");
  });

  it("退回必須帶理由，且常用理由可一鍵帶入（手機上不必打字）", async () => {
    const onDecide = vi.fn();
    const user = userEvent.setup();
    mountStudio({ ...leaderPending, onDecide });

    await user.click(screen.getByRole("button", { name: /退回/ }));
    await user.click(screen.getByRole("button", { name: "人物長相跑掉" }));
    await user.click(screen.getByRole("button", { name: "退回" }));
    expect(onDecide).toHaveBeenCalledWith("needs_work", "人物長相跑掉");
  });

  it("非組長、非待審、或沒有待裁決審批：一律不畫裁決鈕", () => {
    const cases = [
      { ...leaderPending, isLeader: false },
      { ...leaderPending, sceneStatus: "approved" },
      { ...leaderPending, pendingApprovalId: undefined },
    ];
    for (const props of cases) {
      const { unmount } = mountStudio({ ...props, onDecide: vi.fn() });
      expect(screen.queryByRole("button", { name: /通過/ })).toBeNull();
      unmount();
    }
  });

  it("auth.me 還沒回來時先不畫，避免按鈕先缺後補的閃爍", () => {
    mountStudio({ ...leaderPending, meLoading: true, onDecide: vi.fn() });
    expect(screen.queryByRole("button", { name: /通過/ })).toBeNull();
  });

  it("審批清單讀不到時說明原因，而不是沉默地少一排按鈕", () => {
    mountStudio({ isLeader: true, sceneStatus: "pending", approvalsError: true, onDecide: vi.fn() });
    expect(screen.getByText(/審批狀態讀不到/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /通過/ })).toBeNull();
  });

  it("被退回的鏡在工作室內就看得到理由", () => {
    mountStudio({ sceneStatus: "needs_work", rejectReason: "文字有錯字" });
    expect(screen.getByText(/退回理由：文字有錯字/)).toBeInTheDocument();
  });

  it("裁決送出中兩顆鈕都鎖住，避免重複送出", () => {
    mountStudio({ ...leaderPending, deciding: true, onDecide: vi.fn() });
    expect(screen.getByRole("button", { name: /通過/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /退回/ })).toBeDisabled();
  });
});
