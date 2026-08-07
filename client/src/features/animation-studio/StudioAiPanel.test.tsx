import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudioAiPanel } from "./StudioAiPanel";
import type { StudioShot } from "./ShotStrip";
import { resolveStudioLayout } from "./studioLayout";

const updateMutate = vi.fn();

/** 站內既有做法（見 AICreativeCopilot.test.tsx）：整支 api 換成假的，只留這支面板用到的路徑 */
vi.mock("../../api", () => {
  const mutation = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, reset: vi.fn(), error: null, data: undefined });
  return {
    trpc: {
      useUtils: () => ({
        scenes: { listByProject: { invalidate: vi.fn() } },
        projects: { assets: { invalidate: vi.fn() } },
      }),
      scenes: {
        update: { useMutation: () => ({ ...mutation(), mutate: updateMutate }) },
        addDraft: { useMutation: mutation },
        setVisualFromAsset: { useMutation: mutation },
      },
      director: {
        suggest: { useMutation: mutation },
        splitScript: { useMutation: mutation },
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
    />,
  );
}

beforeEach(() => {
  updateMutate.mockClear();
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
