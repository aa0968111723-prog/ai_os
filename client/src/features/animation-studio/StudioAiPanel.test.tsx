import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudioAiPanel } from "./StudioAiPanel";
import type { StudioShot } from "./ShotStrip";
import { resolveStudioLayout } from "./studioLayout";

const updateMutate = vi.fn();
const sketchMutate = vi.fn();
const generateImageMutate = vi.fn();

/** 站內既有做法（見 AICreativeCopilot.test.tsx）：整支 api 換成假的，只留這支面板用到的路徑 */
vi.mock("../../api", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, reset: vi.fn(), error: null, data: undefined });
  const query = () => ({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() });
  return {
    trpc: {
      useUtils: () => ({
        scenes: { listByProject: { invalidate: vi.fn() } },
        projects: { assets: { invalidate: vi.fn() } },
        characters: { list: { invalidate: vi.fn() } },
        scenePresets: { list: { invalidate: vi.fn() } },
      }),
      scenes: {
        update: { useMutation: () => ({ ...mutation(), mutate: updateMutate }) },
        addDraft: { useMutation: mutation },
        setVisualFromAsset: { useMutation: mutation },
        setVisualFromGeneration: { useMutation: mutation },
      },
      characters: { add: { useMutation: mutation } },
      scenePresets: { add: { useMutation: mutation } },
      director: {
        suggest: { useMutation: mutation },
        splitScript: { useMutation: mutation },
        sketchBoard: { useMutation: () => ({ ...mutation(), mutate: sketchMutate }) },
        whiteboardImagePlan: { useQuery: query },
        generateWhiteboardImage: { useMutation: () => ({ ...mutation(), mutateAsync: generateImageMutate }) },
      },
      generation: {
        status: { useQuery: query },
        assetFor: { useQuery: query },
      },
    },
  };
});

const DESKTOP = resolveStudioLayout({ viewportWidth: 1440 });

const SHOT: StudioShot = {
  id: "shot-1",
  title: "開場",
  orderIndex: 0,
  durationSec: 5,
  prompt: "晨光禪堂，長鏡",
  voiceover: "把心交給佛。",
  ambience: "遠處鐘聲",
  rev: 2,
};

const SKETCH = {
  pushStroke: vi.fn(),
  preview: vi.fn(),
  summarize: vi.fn(() => ({ strokeCount: 3, cells: [100, 0, 0, 0, 0, 0, 0, 0, 0], hasFrame: false })),
  boardW: 1600,
  boardH: 900,
  maxStrokes: 1200,
  strokeCount: 0,
};

function setup(shot: StudioShot | null = SHOT) {
  render(
    <StudioAiPanel
      layout={DESKTOP}
      projectId="proj-1"
      shot={shot}
      canEdit
      boardEmpty
      exportBoard={vi.fn()}
      onBoardSaved={vi.fn()}
        sketch={SKETCH}
    />,
  );
}

beforeEach(() => {
  updateMutate.mockClear();
  sketchMutate.mockClear();
  generateImageMutate.mockReset();
});

describe("StudioAiPanel・這一鏡", () => {
  it("把這一鏡的四個文字欄位都帶進表單（含 base 新增的環境音）", () => {
    setup();
    expect(screen.getByLabelText("標題")).toHaveValue("開場");
    expect(screen.getByLabelText(/畫面/)).toHaveValue("晨光禪堂，長鏡");
    expect(screen.getByLabelText("旁白")).toHaveValue("把心交給佛。");
    expect(screen.getByLabelText(/環境音/)).toHaveValue("遠處鐘聲");
  });

  it("沒有任何改動時儲存鈕停用並顯示「已儲存」", () => {
    setup();
    const save = screen.getByRole("button", { name: "已儲存 ✓" });
    expect(save).toBeDisabled();
  });

  it("只改環境音也算改動——不然改了字卻按不下儲存，畫面還騙人說已存", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/環境音/), "，細微鳥鳴");
    const save = screen.getByRole("button", { name: "儲存這一鏡" });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ sceneId: "shot-1", ambience: "遠處鐘聲，細微鳥鳴" }),
    );
  });

  it("送出的 payload 一定帶著環境音——漏掉這一欄，這裡存檔會顯得像把它清空了", async () => {
    setup();
    await userEvent.type(screen.getByLabelText("旁白"), "阿彌陀佛。");
    await userEvent.click(screen.getByRole("button", { name: "儲存這一鏡" }));
    expect(updateMutate).toHaveBeenCalledWith({
      sceneId: "shot-1",
      title: "開場",
      durationSec: 5,
      prompt: "晨光禪堂，長鏡",
      voiceover: "把心交給佛。阿彌陀佛。",
      ambience: "遠處鐘聲",
      expectedRev: 2,
      baseline: {
        title: "開場",
        durationSec: 5,
        prompt: "晨光禪堂，長鏡",
        voiceover: "把心交給佛。",
        ambience: "遠處鐘聲",
      },
    });
  });

  it("環境音欄位吃 shared 的字數上限，不是元件自己編的數字", () => {
    setup();
    expect(screen.getByLabelText(/環境音/)).toHaveAttribute("maxlength", "500");
    expect(screen.getByLabelText("標題")).toHaveAttribute("maxlength", "60");
  });

  it("唯讀（專案檢視者）時所有欄位停用", () => {
    render(
      <StudioAiPanel
        layout={DESKTOP}
        projectId="proj-1"
        shot={SHOT}
        canEdit={false}
        boardEmpty
        exportBoard={vi.fn()}
        onBoardSaved={vi.fn()}
        sketch={SKETCH}
      />,
    );
    expect(screen.getByLabelText(/環境音/)).toBeDisabled();
    expect(screen.getByLabelText("旁白")).toBeDisabled();
  });

  it("沒選分鏡時不顯示欄位，改講下一步", () => {
    setup(null);
    expect(screen.queryByLabelText(/環境音/)).not.toBeInTheDocument();
    expect(screen.getByText(/還沒選分鏡/)).toBeInTheDocument();
  });
});

/**
 * 停用的按鈕在手機上按下去毫無回饋，畫面又不講原因——使用者的結論只會是「沒辦法用」。
 * 按鈕可以停用，但停用的理由一定要看得到。
 */
describe("StudioAiPanel・AI 畫草圖按不下去時要說原因", () => {
  it("還沒寫描述：按鈕停用，並告訴使用者要先寫字", () => {
    setup();
    expect(screen.getByRole("button", { name: /AI 畫草圖/ })).toBeDisabled();
    expect(screen.getByText(/先在上面寫這一鏡要看到什麼/)).toBeInTheDocument();
  });

  it("字數還不夠：換成「再多寫幾個字」，不是原封不動的空白提示", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/跟 AI 說/), "夕陽");
    expect(screen.getByRole("button", { name: /AI 畫草圖/ })).toBeDisabled();
    expect(screen.getByText(/再多寫幾個字/)).toBeInTheDocument();
  });

  it("寫夠字就亮起來，提示同時收掉", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/跟 AI 說/), "一個人走在山路上");
    expect(screen.getByRole("button", { name: /AI 畫草圖/ })).toBeEnabled();
    expect(screen.queryByText(/再多寫幾個字/)).not.toBeInTheDocument();
    expect(screen.queryByText(/先在上面寫這一鏡要看到什麼/)).not.toBeInTheDocument();
  });

  it("選了分鏡時送出 sceneId——連戲（參考前後鏡）靠這條線，斷了伺服器只能憑空畫", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/跟 AI 說/), "僧人沿石徑往右行禪");
    await userEvent.click(screen.getByRole("button", { name: /AI 畫草圖/ }));
    expect(sketchMutate).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj-1", sceneId: "shot-1" }));
  });

  it("白板有內容時送出現況摘要（畫布感知）——AI 靠它避開已有的東西", async () => {
    setup();
    await userEvent.type(screen.getByLabelText(/跟 AI 說/), "在空白處補一棵樹");
    await userEvent.click(screen.getByRole("button", { name: /AI 畫草圖/ }));
    expect(sketchMutate).toHaveBeenCalledWith(
      expect.objectContaining({ board: expect.objectContaining({ strokeCount: 3, hasFrame: false }) }),
    );
  });

  it("沒選分鏡（自由塗鴉）不帶 sceneId", async () => {
    setup(null);
    await userEvent.type(screen.getByLabelText(/跟 AI 說/), "遠山與夕陽");
    await userEvent.click(screen.getByRole("button", { name: /AI 畫草圖/ }));
    expect(sketchMutate).toHaveBeenCalledWith(expect.objectContaining({ sceneId: undefined }));
  });

  it("檢視者看到的是「你沒有編輯權」，不是叫他多打幾個字", () => {
    render(
      <StudioAiPanel
        layout={DESKTOP}
        projectId="proj-1"
        shot={SHOT}
        canEdit={false}
        boardEmpty
        exportBoard={vi.fn()}
        onBoardSaved={vi.fn()}
        sketch={SKETCH}
      />,
    );
    expect(screen.getByText(/你在這個專案是檢視者/)).toBeInTheDocument();
    expect(screen.queryByText(/先在上面寫這一鏡要看到什麼/)).not.toBeInTheDocument();
  });
});

describe("StudioAiPanel・生成正式畫面", () => {
  it("選了分鏡時送出 sceneId——伺服器靠它綁本鏡卡片／造型／鏡頭", async () => {
    const exportBoard = vi.fn(async () => ({ blob: new Blob(["png"], { type: "image/png" }), width: 1600, height: 900 }));
    generateImageMutate.mockResolvedValue({ generationId: "gen-1" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, asset: { id: "asset-1" } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <StudioAiPanel
          layout={DESKTOP}
          projectId="proj-1"
          shot={SHOT}
          canEdit
          boardEmpty={false}
          exportBoard={exportBoard}
          onBoardSaved={vi.fn()}
          sketch={SKETCH}
        />,
      );
      await userEvent.click(screen.getByRole("button", { name: "生成正式畫面" }));
      expect(generateImageMutate).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: "proj-1", sceneId: "shot-1", sourceAssetId: "asset-1" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
