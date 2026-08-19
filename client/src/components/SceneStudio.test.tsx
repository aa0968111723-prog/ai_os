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
const charactersQuery = vi.fn();
const updateMutate = vi.fn();
const regenMutate = vi.fn();
const variantsMutate = vi.fn();
const refineMutate = vi.fn();
const voiceMutate = vi.fn();
const ambienceMutate = vi.fn();
const setCurrentMutate = vi.fn();
const invalidate = vi.fn();
/** 標注清單（預設空；tMs 情境會覆寫） */
const annotationsQuery = vi.fn(() => ({ data: [] as unknown[], isLoading: false }));

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      scenes: { versions: { invalidate } },
      messages: { listByRef: { invalidate }, openCountsByScene: { invalidate } },
      quota: { my: { invalidate } },
      teamAssistant: { agentOverview: { invalidate } },
      characters: { list: { invalidate } },
      creativeContext: { workspace: { invalidate } },
    }),
    characters: {
      list: { useQuery: (...args: unknown[]) => charactersQuery(...args) },
      generateSheet: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      honorGeneratedSheet: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
    generation: {
      status: { useQuery: () => ({ data: null }) },
    },
    scenes: {
      versions: { useQuery: (...args: unknown[]) => versionsQuery(...args) },
      update: { useMutation: () => ({ mutate: updateMutate, isPending: false, isSuccess: false, error: null }) },
      generateInto: { useMutation: () => ({ mutate: regenMutate, isPending: false, error: null }) },
      generateVariants: { useMutation: () => ({ mutate: variantsMutate, isPending: false, error: null }) },
      refine: { useMutation: () => ({ mutate: refineMutate, isPending: false, error: null }) },
      generateVoiceover: { useMutation: () => ({ mutate: voiceMutate, isPending: false, error: null }) },
      generateAmbience: { useMutation: () => ({ mutate: ambienceMutate, isPending: false, error: null }) },
      setVisualFromAsset: { useMutation: () => ({ mutate: setCurrentMutate, isPending: false, error: null }) },
    },
    // 圖上標注：本檔專注在版本與生成的狀態機，標注另有專屬情境；這裡回空清單
    messages: {
      listByRef: { useQuery: () => annotationsQuery() },
      postAnnotation: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
      resolveAnnotation: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
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
function serverData(opts: { rows?: SceneVersionGenerationRow[]; currentAssetId?: string | null; prompt?: string | null; voiceover?: string | null; ambience?: string | null; action?: string | null; dialogue?: string | null; music?: string | null } = {}) {
  const rows = opts.rows ?? [genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z" })];
  const currentAssetId = opts.currentAssetId === undefined ? "asset-g1" : opts.currentAssetId;
  const versions = buildSceneVersions(rows, { assetId: currentAssetId, narrationAssetId: null, ambienceAssetId: null });
  return {
    sceneId: "s-1",
    projectId: "p-1",
    title: "海邊遠景",
    prompt: opts.prompt === undefined ? "黃昏的海邊" : opts.prompt,
    voiceover: opts.voiceover ?? null,
    ambience: opts.ambience ?? null,
    action: opts.action ?? null,
    dialogue: opts.dialogue ?? null,
    music: opts.music ?? null,
    assetId: currentAssetId,
    narrationAssetId: null,
    ambienceAssetId: null,
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

function mountStudio(over: { canEdit?: boolean; charIds?: string[] } = {}) {
  return render(
    <SceneStudio
      sceneId="s-1"
      projectId="p-1"
      sceneNumber={3}
      canEdit={over.canEdit ?? true}
      charIds={over.charIds}
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  versionsQuery.mockReturnValue({ data: serverData(), isLoading: false, isError: false, refetch: vi.fn() });
  charactersQuery.mockReturnValue({ data: undefined, isLoading: false });
  annotationsQuery.mockReturnValue({ data: [], isLoading: false });
});

describe("SceneStudio", () => {
  it("開起來就是這一格：標題帶鏡次，預設停在「修正這張」", () => {
    mountStudio();
    expect(screen.getByRole("dialog", { name: /第 3 鏡・單格工作室/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /修正這張/ })).toHaveAttribute("aria-selected", "true");
  });

  it("單格工作室面板有 HonorSheetControl：生成時帶入 / 已選 n/6，不是只有角色卡", () => {
    mountStudio();
    expect(screen.getByRole("group", { name: "生成時帶入角色參考圖" })).toBeInTheDocument();
    expect(screen.getByText(/生成時帶入 · 已選 0\/6/)).toBeInTheDocument();
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

  it("選 經濟・Qwen Image 2.0 後確認重畫送出的是 Qwen，不是預設 SDXL Lightning", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: /用哪個模型重畫/ }),
      "fal-ai/qwen-image-2/text-to-image",
    );
    await user.click(screen.getByRole("button", { name: /重畫這格（/ }));
    expect(screen.getByText(/即將重畫這一格（Qwen Image 2.0/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "確認重畫" }));
    expect(regenMutate.mock.calls[0]![0]).toMatchObject({
      sceneId: "s-1",
      modelId: "fal-ai/qwen-image-2/text-to-image",
    });
  });

  it("重畫這格 honours 單格帶入：有自己的定裝圖才能變成 1/6", async () => {
    const user = userEvent.setup();
    const xiaohuaId = "11111111-1111-4111-8111-111111111111";
    charactersQuery.mockReturnValue({
      data: [{
        id: xiaohuaId,
        name: "小華",
        referenceAssetId: "22222222-2222-4222-8222-222222222222",
        referenceUrl: "https://example.test/xiaohua-sheet.png",
      }],
      isLoading: false,
    });
    mountStudio({ charIds: [xiaohuaId] });
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    expect(screen.getByRole("group", { name: "生成時帶入角色參考圖" })).toBeInTheDocument();
    expect(screen.getByText(/已選 1\/6/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /重畫這格（/ }));
    await user.click(screen.getByRole("button", { name: "確認重畫" }));
    const arg = regenMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.characterIds).toEqual([xiaohuaId]);
    expect(arg).not.toHaveProperty("sourceAssetId");
  });

  it("已選 0/6：小華沒有自己的定裝圖時重畫只走文字錨點，不掛 1/50", async () => {
    const user = userEvent.setup();
    const xiaohuaId = "11111111-1111-4111-8111-111111111111";
    charactersQuery.mockReturnValue({
      data: [{ id: xiaohuaId, name: "小華", referenceAssetId: null, referenceUrl: null }],
      isLoading: false,
    });
    mountStudio({ charIds: [xiaohuaId] });
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    expect(screen.getByText(/已選 0\/6/)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /小華/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /重畫這格（/ }));
    await user.click(screen.getByRole("button", { name: "確認重畫" }));
    const arg = regenMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("characterIds");
    expect(arg).not.toHaveProperty("sourceAssetId");
  });

  it("有定裝圖但取消 HonorSheet：重畫不帶 characterIds，文字錨點仍在", async () => {
    const user = userEvent.setup();
    const xiaohuaId = "11111111-1111-4111-8111-111111111111";
    charactersQuery.mockReturnValue({
      data: [{
        id: xiaohuaId,
        name: "小華",
        referenceAssetId: "22222222-2222-4222-8222-222222222222",
        referenceUrl: "https://example.test/xiaohua-sheet.png",
      }],
      isLoading: false,
    });
    mountStudio({ charIds: [xiaohuaId] });
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    expect(screen.getByText(/已選 1\/6/)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /小華/ }));
    expect(screen.getByText(/已選 0\/6/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /重畫這格（/ }));
    await user.click(screen.getByRole("button", { name: "確認重畫" }));
    const arg = regenMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("characterIds");
    expect(arg).not.toHaveProperty("sourceAssetId");
  });

  it("第一張候選（尚未現用）舞台顯示該版模型並給採用，不標成 SDXL / 現用", () => {
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [genRow({
          generationId: "g-qwen",
          createdAt: "2026-08-18T00:00:00.000Z",
          modelId: "fal-ai/qwen-image-2/text-to-image",
        })],
        currentAssetId: null,
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    expect(screen.getByText(/Qwen Image 2.0/)).toBeInTheDocument();
    expect(screen.queryByText(/SDXL Lightning/)).not.toBeInTheDocument();
    expect(screen.getByText("可切回")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /採用這一版/ })).toBeInTheDocument();
    expect(screen.queryByText("現用")).not.toBeInTheDocument();
  });

  it("產生方向：每個 slot 一把冪等鍵＋一個真的不同的方向", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    await user.click(screen.getByRole("button", { name: /產生 3 個方向/ }));
    await user.click(screen.getByRole("button", { name: "確認產生 3 個方向" }));
    const arg = variantsMutate.mock.calls[0]![0] as {
      sceneId: string;
      batchId: string;
      variants: Array<{ clientRequestId: string; direction?: { id: string; label: string; keep?: string[] } }>;
    };
    expect(arg).toMatchObject({ sceneId: "s-1" });
    expect(arg.variants).toHaveLength(3);
    // 每個 slot 各自的計費／冪等收據
    expect(new Set(arg.variants.map((v) => v.clientRequestId)).size).toBe(3);
    // 一批共用一個分組鍵：reload 之後靠它把這批湊回來（不靠前端記憶）
    expect(arg.batchId).toMatch(/^[0-9a-f-]{36}$/i);
    // 三個真的不同的方向，不是同一 prompt ×3
    const labels = arg.variants.map((v) => v.direction?.label);
    expect(new Set(labels).size).toBe(3);
    // Reference Lock：每個方向都宣告保持角色／造型／場景／Style
    for (const variant of arg.variants) {
      expect(variant.direction?.keep).toEqual(expect.arrayContaining(["character", "look", "scene", "style"]));
    }
  });

  it("方向卡可以取消勾選，估點跟著實際要送的方向數走", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    const cards = screen.getAllByRole("button", { pressed: true });
    await user.click(cards[0]!); // 取消其中一個方向
    await user.click(screen.getByRole("button", { name: /產生 2 個方向/ }));
    await user.click(screen.getByRole("button", { name: "確認產生 2 個方向" }));
    const arg = variantsMutate.mock.calls[0]![0] as { variants: unknown[] };
    expect(arg.variants).toHaveLength(2);
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
    // 併發契約（shared/revision.ts）：每一支存檔都要帶「我載入時的版本」與「該欄原值」，
    // 伺服器才分得出「我們改了同一欄」與「我們各改各的」。少了它就會回到靜默覆蓋。
    expect(updateMutate).toHaveBeenCalledWith({
      sceneId: "s-1",
      prompt: "黃昏的海邊，逆光",
      expectedRev: undefined,
      // baseline 是「我載入時這一欄長什麼樣」——伺服器靠它判斷夥伴有沒有真的動過這欄
      baseline: { prompt: "黃昏的海邊" },
    });
  });

  it("版本頁列出每一版，現用的那版不給「採用這一版」，舊版可以切回", async () => {
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
    expect(within(items[0]!).queryByRole("button", { name: /採用這一版/ })).not.toBeInTheDocument();
    await user.click(within(items[1]!).getByRole("button", { name: /採用這一版/ }));
    /*
     * 單格工作室是「人正看著這一鏡」的地方，所以兩個旗標都帶：
     *  - acknowledgeApproved：已通過的鏡在這裡換得掉畫面（伺服器會把審核狀態退回「需要修改」）；
     *  - syncShotDirection：若這一版是某個方向跑出來的，把該方向的鏡頭語言還原回本鏡，
     *    並由 UI 明白列出同步了什麼。
     * 分鏡中心的批次套用兩個都不帶——所以它換不動已通過的鏡，也不會用一張圖的
     * 凍結設定覆寫 N 鏡的鏡頭語言。
     */
    expect(setCurrentMutate).toHaveBeenCalledWith({
      sceneId: "s-1",
      assetId: "asset-g1",
      acknowledgeApproved: true,
      syncShotDirection: true,
    });
  });

  it("用 real sceneVersions 並排比較，Adopt 更新既有 current pointer 且不刪其他版本", async () => {
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
    const toggles = screen.getAllByRole("checkbox", { name: /加入比較/ });
    await user.click(toggles[0]!);
    await user.click(toggles[1]!);
    await user.click(screen.getByRole("button", { name: /比較 2/ }));

    const compare = screen.getByRole("dialog", { name: /第 3 鏡版本比較/ });
    expect(within(compare).getByText("V1")).toBeInTheDocument();
    expect(within(compare).getByText("V2")).toBeInTheDocument();
    await user.click(within(compare).getByRole("button", { name: /採用 V1/ }));
    expect(setCurrentMutate).toHaveBeenCalledWith({
      sceneId: "s-1",
      assetId: "asset-g1",
      acknowledgeApproved: true,
      syncShotDirection: true,
    });
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("Compare 快速切換：同位置換圖，一次只掛一個媒體元素", async () => {
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
    const toggles = screen.getAllByRole("checkbox", { name: /加入比較/ });
    await user.click(toggles[0]!);
    await user.click(toggles[1]!);
    await user.click(screen.getByRole("button", { name: /比較 2/ }));

    const compare = screen.getByRole("dialog", { name: /第 3 鏡版本比較/ });
    await user.click(within(compare).getByRole("tab", { name: "快速切換" }));
    // 兩個版本兩顆切換鍵，但舞台上只有一張圖——三段影片同時掛在手機上會直接吃掉記憶體
    const switches = within(compare).getAllByRole("tab", { name: /V[12]/ });
    expect(switches).toHaveLength(2);
    expect(compare.querySelectorAll(".scene-compare-ab__stage img, .scene-compare-ab__stage video")).toHaveLength(1);
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
    expect(screen.queryByRole("button", { name: /採用這一版/ })).not.toBeInTheDocument();
  });

  it("配音頁：旁白與對白都空→生成鈕鎖住並指路；填了要先儲存", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /配音/ }));
    expect(screen.getByText(/先填旁白或對白並儲存/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^生成配音/ })).toBeDisabled();
    // 打了字＝尚未儲存：儲存鈕亮起、生成仍鎖（後端唸的是已儲存的稿）
    await user.type(screen.getByRole("textbox", { name: /這一格的配音詞/ }), "各位同學大家好");
    expect(screen.getByRole("button", { name: /儲存配音詞/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^生成配音/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /儲存配音詞/ }));
    expect(updateMutate).toHaveBeenCalledWith({
      sceneId: "s-1",
      voiceover: "各位同學大家好",
      expectedRev: undefined,
      baseline: { voiceover: null },
    });
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

  it("只寫了對白也能配音——旁白空但有台詞時生成鈕不該鎖住", async () => {
    versionsQuery.mockReturnValue({
      data: serverData({ voiceover: null, dialogue: "@師父：坐吧。" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await userEvent.setup().click(screen.getByRole("tab", { name: /配音/ }));
    expect(screen.getByRole("button", { name: /^生成配音/ })).toBeEnabled();
    expect(screen.queryByText(/先填旁白或對白並儲存/)).not.toBeInTheDocument();
  });

  it("對白即時回饋讀懂了幾句、誰是誰——@ 打錯當場看得出來", async () => {
    versionsQuery.mockReturnValue({
      data: serverData({ dialogue: "@旁白：那一年。\n@師父：坐吧。\n@安倢：謝謝。" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await userEvent.setup().click(screen.getByRole("tab", { name: /配音/ }));
    expect(screen.getByText(/2 句對白・1 句旁白/)).toBeInTheDocument();
  });

  it("走位是獨立欄位，與提示詞各自儲存（不互相污染 pending 狀態）", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.type(screen.getByRole("textbox", { name: /這一鏡的動作走位/ }), "從門口走到窗邊");
    await user.click(screen.getByRole("button", { name: /儲存走位/ }));
    expect(updateMutate).toHaveBeenCalledWith({
      sceneId: "s-1",
      action: "從門口走到窗邊",
      expectedRev: undefined,
      baseline: { action: null },
    });
  });

  it("走位欄位明講「只送影片模型」——使用者才知道重畫靜圖時它不會生效", async () => {
    mountStudio();
    expect(screen.getByText(/只送影片模型，出靜圖不吃/)).toBeInTheDocument();
  });

  it("環境音頁：還沒填描述→生成鈕鎖住並指路；填了要先儲存", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /環境音/ }));
    expect(screen.getByText(/先填環境音描述並儲存/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^生成環境音/ })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: /這一鏡聽得到什麼/ }), "遠處鐘聲");
    expect(screen.getByRole("button", { name: /^生成環境音/ })).toBeDisabled(); // 未儲存＝後端讀不到
    await user.click(screen.getByRole("button", { name: /儲存描述/ }));
    expect(updateMutate).toHaveBeenCalledWith({
      sceneId: "s-1",
      ambience: "遠處鐘聲",
      expectedRev: undefined,
      baseline: { ambience: null },
    });
  });

  it("描述已儲存：生成環境音帶冪等鍵，且送的是環境音而非配音", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({ ambience: "遠處鐘聲，細微蟲鳴" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /環境音/ }));
    await user.click(screen.getByRole("button", { name: /^生成環境音/ }));
    await user.click(screen.getByRole("button", { name: "確認生成" }));
    expect(ambienceMutate).toHaveBeenCalledTimes(1);
    // 兩條路各走各的：按環境音不該送出配音生成（會扣到錯的模型的點）
    expect(voiceMutate).not.toHaveBeenCalled();
    const arg = ambienceMutate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.sceneId).toBe("s-1");
    expect(typeof arg.clientRequestId).toBe("string");
  });

  it("配樂標記可寫，並即時說明這一鏡是起還是止", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({ music: "起｜單音鋼琴" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /環境音/ }));
    expect(screen.getByText(/從這一鏡開始播/)).toBeInTheDocument();
  });

  it("配樂寫「止」時說明改成停止——使用者不必記語法也看得懂", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({ music: "止" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mountStudio();
    await user.click(screen.getByRole("tab", { name: /環境音/ }));
    expect(screen.getByText(/這一鏡起停止配樂/)).toBeInTheDocument();
  });

  it("檢視者的環境音頁：唯讀，沒有編輯與生成鈕", async () => {
    const user = userEvent.setup();
    mountStudio({ canEdit: false });
    await user.click(screen.getByRole("tab", { name: /環境音/ }));
    expect(screen.getByText(/只能試聽環境音/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /這一鏡聽得到什麼/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^生成環境音/ })).not.toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: /採用這一版/ })).not.toBeInTheDocument();
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

/**
 * 動作走位唯一接得上生成的路徑。
 *
 * 「重畫這格」選影片模型時，走位由 sceneVisualPrompt 自動接在畫面描述後面。但「讓這張動起來」
 * 走的是修正這條路，提示詞是使用者當場打的指示——伺服器不該擅自接上去（那會跟他打的字打架）。
 * 於是這一鏡明明寫好了走位，要讓它動起來時還得再打一次；這一顆按鈕就是把那一次省掉。
 */
describe("影片修正：把這一鏡的動作走位填成修正指示", () => {
  /** 「讓這張動起來（產出影片）」那一組的第一支——刻意不做退路，選錯組會讓整組測試變成假綠 */
  const videoModel = () => {
    const select = screen.getByRole("combobox", { name: /用哪個模型修/ });
    const group = within(select).getByRole("group", { name: /讓這張動起來/ }) as HTMLOptGroupElement;
    const option = group.querySelector("option");
    if (!option) throw new Error("模型目錄裡沒有任何圖生影片模型——測試前提失效");
    return option.value;
  };

  it("選了影片模型且這一鏡有走位 → 出現一鍵填入", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({ action: "安倢從門口走到窗邊，停下" }),
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mountStudio();
    await user.selectOptions(screen.getByRole("combobox", { name: /用哪個模型修/ }), videoModel());

    const fill = screen.getByRole("button", { name: /用它當修正指示/ });
    await user.click(fill);
    expect(screen.getByRole("textbox", { name: /要改哪裡/ })).toHaveValue("安倢從門口走到窗邊，停下");
    // 填完就收起來——它是空白時的捷徑，不是常駐控制項
    expect(screen.queryByRole("button", { name: /用它當修正指示/ })).not.toBeInTheDocument();
  });

  it("使用者已經打了指示就不出現——永遠不蓋掉他打的字", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({ action: "安倢從門口走到窗邊" }),
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mountStudio();
    await user.selectOptions(screen.getByRole("combobox", { name: /用哪個模型修/ }), videoModel());
    await user.type(screen.getByRole("textbox", { name: /要改哪裡/ }), "讓她慢慢轉頭");
    expect(screen.queryByRole("button", { name: /用它當修正指示/ })).not.toBeInTheDocument();
  });

  it("圖片模型不出現：走位是時間性的，單張圖畫不出來（與 sceneActionAppliesTo 同一條規則）", () => {
    versionsQuery.mockReturnValue({
      data: serverData({ action: "安倢從門口走到窗邊" }),
      isLoading: false, isError: false, refetch: vi.fn(),
    });
    mountStudio(); // 預設模型是推薦的圖片模型
    expect(screen.queryByRole("button", { name: /用它當修正指示/ })).not.toBeInTheDocument();
  });

  it("這一鏡沒寫走位就不出現（不推銷一個空值）", async () => {
    const user = userEvent.setup();
    mountStudio();
    await user.selectOptions(screen.getByRole("combobox", { name: /用哪個模型修/ }), videoModel());
    expect(screen.queryByRole("button", { name: /用它當修正指示/ })).not.toBeInTheDocument();
  });
});

describe("影片時間碼留言（tMs；驗收 J）", () => {
  /** 影片版本＋一則帶時間碼的標注（釘在舞台上的那一版） */
  function mountWithVideoAnnotation() {
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z", assetKind: "video", assetUrl: "https://example.test/g1.mp4" })],
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    annotationsQuery.mockReturnValue({
      data: [{
        id: "m-1", userId: "u-wei", userName: "韋澔", kind: "annotation",
        body: "這裡人物切太快", anchorAssetId: "asset-g1", ax: 0.5, ay: 0.5,
        tMs: 18_000, resolvedAt: null, resolvedBy: null, mentions: null,
        createdAt: new Date("2026-08-07T00:00:00.000Z"),
      }],
      isLoading: false,
    });
    return mountStudio();
  }

  it("留言顯示「00:18」時間碼；點了就把舞台影片 seek 到那一刻並暫停", async () => {
    const user = userEvent.setup();
    const { container } = mountWithVideoAnnotation();
    await user.click(screen.getByRole("tab", { name: /標注/ }));
    const seek = screen.getByTestId("tms-seek");
    expect(seek).toHaveTextContent("00:18");
    const video = container.querySelector("video")!;
    expect(video).toBeTruthy();
    const pause = vi.fn();
    Object.defineProperty(video, "pause", { value: pause, configurable: true });
    await user.click(seek);
    // 「這裡人物切太快」的「這裡」終於指得回去：秒級 seek＋暫停停在那格畫面
    expect(video.currentTime).toBe(18);
    expect(pause).toHaveBeenCalled();
  });

  it("標注在別的版本上時 seek 鎖住——先「看那一版」，否則會跳錯影片", async () => {
    const user = userEvent.setup();
    versionsQuery.mockReturnValue({
      data: serverData({
        rows: [
          genRow({ generationId: "g1", createdAt: "2026-07-01T00:00:00.000Z", assetKind: "video", assetUrl: "https://example.test/g1.mp4" }),
          genRow({ generationId: "g2", createdAt: "2026-07-02T00:00:00.000Z", assetKind: "video", assetUrl: "https://example.test/g2.mp4" }),
        ],
        currentAssetId: "asset-g2",
      }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    annotationsQuery.mockReturnValue({
      data: [{
        id: "m-1", userId: "u-wei", userName: "韋澔", kind: "annotation",
        body: "舊版的問題", anchorAssetId: "asset-g1", ax: 0.5, ay: 0.5,
        tMs: 18_000, resolvedAt: null, resolvedBy: null, mentions: null,
        createdAt: new Date("2026-08-07T00:00:00.000Z"),
      }],
      isLoading: false,
    });
    mountStudio();
    const user2 = user;
    await user2.click(screen.getByRole("tab", { name: /標注/ }));
    expect(screen.getByTestId("tms-seek")).toBeDisabled();
    expect(screen.getByText("在別的版本上")).toBeInTheDocument();
  });

  it("每一版都有「討論這一版」——thread 綁 assetId，不是綁整格", async () => {
    const user = userEvent.setup();
    mountWithVideoAnnotation();
    await user.click(screen.getByRole("tab", { name: /版本/ }));
    const discuss = screen.getAllByTestId("discuss-version");
    expect(discuss.length).toBeGreaterThan(0);
  });
});

/**
 * #725 P0-1 的可執行回歸測試（跨鏡狀態外洩）。
 *
 * 原始 finding：`StoryboardStage` 在固定位置渲染 `<SceneStudio>` 且沒有 `key`，
 * 而 `ShotNavigator` 是**就地換 sceneId**。同型別、同位置、無 key ⇒ React 保留全部
 * component state，造成三件事：寫錯鏡、對錯鏡花錢、假成功（顯示生成中但什麼都沒送）。
 *
 * 這一組刻意用**真的重新渲染**來證明隔離，而不是 grep 原始碼有沒有 `key=`：
 * 以 `key={sceneId}` 掛載（＝正式呼叫端的做法）之後換鏡，逐一斷言 red team 點名的
 * 五個外洩向量都不成立。
 */
describe("#725 P0-1 跨鏡狀態隔離（換鏡後不得沿用上一鏡的任何狀態）", () => {
  /** 每一鏡有自己的伺服器資料，才分得出「顯示的是 B 的值」還是「殘留 A 的草稿」 */
  function dataFor(sceneId: string) {
    return {
      ...serverData({ rows: [genRow({ generationId: `${sceneId}-g1`, createdAt: "2026-07-01T00:00:00.000Z" })] }),
      sceneId,
      prompt: sceneId === "s-A" ? "A 鏡的提示詞" : "B 鏡的提示詞",
    };
  }

  /** 正式呼叫端（StoryboardStage / SceneList）都是 key={shot.id}；這裡照同樣方式掛 */
  function renderKeyed(sceneId: string) {
    return (
      <SceneStudio
        key={sceneId}
        sceneId={sceneId}
        projectId="p-1"
        sceneNumber={sceneId === "s-A" ? 1 : 2}
        canEdit
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />
    );
  }

  it("A 鏡的未存草稿不會出現在 B 鏡（寫錯鏡）", async () => {
    const user = userEvent.setup();
    versionsQuery.mockImplementation((input: { sceneId: string }) => ({
      data: dataFor(input.sceneId), isLoading: false, isError: false, refetch: vi.fn(),
    }));

    const view = render(renderKeyed("s-A"));
    const box = screen.getByRole("textbox", { name: /這一格的提示詞/ });
    await user.clear(box);
    await user.type(box, "只屬於 A 鏡的草稿");
    expect(screen.getByRole("textbox", { name: /這一格的提示詞/ })).toHaveValue("只屬於 A 鏡的草稿");

    // ShotNavigator 換鏡
    view.rerender(renderKeyed("s-B"));

    // B 鏡顯示的必須是 B 自己的伺服器值，不是 A 的草稿
    expect(screen.getByRole("textbox", { name: /這一格的提示詞/ })).toHaveValue("B 鏡的提示詞");
    expect(screen.queryByDisplayValue("只屬於 A 鏡的草稿")).not.toBeInTheDocument();
  });

  it("在 B 鏡送出的生成帶的是 B 的 sceneId 與 B 的提示詞（對錯鏡花錢）", async () => {
    const user = userEvent.setup();
    versionsQuery.mockImplementation((input: { sceneId: string }) => ({
      data: dataFor(input.sceneId), isLoading: false, isError: false, refetch: vi.fn(),
    }));

    const view = render(renderKeyed("s-A"));
    const box = screen.getByRole("textbox", { name: /這一格的提示詞/ });
    await user.clear(box);
    await user.type(box, "只屬於 A 鏡的草稿");

    view.rerender(renderKeyed("s-B"));

    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    await user.click(screen.getByRole("button", { name: /重畫這格（/ }));
    await user.click(screen.getByRole("button", { name: "確認重畫" }));

    const arg = regenMutate.mock.calls[0]![0] as { sceneId: string; prompt: string };
    expect(arg.sceneId).toBe("s-B");
    expect(arg.prompt).toBe("B 鏡的提示詞");
    expect(arg.prompt).not.toContain("A 鏡");
  });

  it("B 鏡的變體用的是全新的冪等鍵與 batchId（假成功：重送 A 的 UUID）", async () => {
    const user = userEvent.setup();
    versionsQuery.mockImplementation((input: { sceneId: string }) => ({
      data: dataFor(input.sceneId), isLoading: false, isError: false, refetch: vi.fn(),
    }));

    const view = render(renderKeyed("s-A"));
    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    await user.click(screen.getByRole("button", { name: /產生 3 個方向/ }));
    await user.click(screen.getByRole("button", { name: "確認產生 3 個方向" }));
    const aCall = variantsMutate.mock.calls[0]![0] as {
      sceneId: string; batchId: string; variants: Array<{ clientRequestId: string }>;
    };

    view.rerender(renderKeyed("s-B"));

    await user.click(screen.getByRole("tab", { name: /重畫這格/ }));
    await user.click(screen.getByRole("button", { name: /產生 3 個方向/ }));
    await user.click(screen.getByRole("button", { name: "確認產生 3 個方向" }));
    const bCall = variantsMutate.mock.calls[1]![0] as {
      sceneId: string; batchId: string; variants: Array<{ clientRequestId: string }>;
    };

    expect(bCall.sceneId).toBe("s-B");
    // batchId 不得沿用——否則 B 的版本會被歸進 A 的批次
    expect(bCall.batchId).not.toBe(aCall.batchId);
    // 冪等鍵不得沿用——否則伺服器冪等短路會回 A 的既有列並回報 ok，UI 顯示「生成中」但 B 什麼都沒送
    const aKeys = new Set(aCall.variants.map((v) => v.clientRequestId));
    for (const variant of bCall.variants) {
      expect(aKeys.has(variant.clientRequestId)).toBe(false);
    }
  });

  it("A 鏡的批次狀態不會出現在 B 鏡（殘留 candidate state ／ 假的生成中）", async () => {
    const user = userEvent.setup();
    // A 鏡有一批帶方向 meta 的變體（＝畫面會顯示批次狀態列）
    const withBatch = (sceneId: string) => {
      const base = dataFor(sceneId);
      if (sceneId !== "s-A") return base;
      const rows = [
        genRow({
          generationId: "A-v1", createdAt: "2026-07-02T00:00:00.000Z", status: "running",
          assetId: null, assetUrl: null, assetKind: null,
        }),
      ];
      const versions = buildSceneVersions(rows, { assetId: null, narrationAssetId: null, ambienceAssetId: null })
        .map((v) => ({ ...v, creative: { batchId: "batch-A", directionId: "closer", directionLabel: "更靠近人物", batchSize: 3 } }));
      return { ...base, versions, summary: { ...base.summary, generating: true } };
    };
    versionsQuery.mockImplementation((input: { sceneId: string }) => ({
      data: withBatch(input.sceneId), isLoading: false, isError: false, refetch: vi.fn(),
    }));

    const view = render(renderKeyed("s-A"));
    await user.click(screen.getByRole("tab", { name: /版本/ }));
    expect(screen.getByText(/方向生成中/)).toBeInTheDocument();
    expect(screen.getByText("更靠近人物")).toBeInTheDocument();

    view.rerender(renderKeyed("s-B"));
    await user.click(screen.getByRole("tab", { name: /版本/ }));

    // B 鏡沒有任何批次 ⇒ 不得顯示 A 的批次狀態或方向標籤
    expect(screen.queryByText(/方向生成中/)).not.toBeInTheDocument();
    expect(screen.queryByText("更靠近人物")).not.toBeInTheDocument();
  });
});
