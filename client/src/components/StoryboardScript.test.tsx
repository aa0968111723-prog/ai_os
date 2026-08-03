/**
 * 文字分鏡腳本面板：讀整份、改整份。
 * 重點在「套用前先講清楚會動到什麼」，以及「文字裡沒寫到的鏡不會消失」。
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StoryboardScript } from "./StoryboardScript";

const applyMutate = vi.fn();
const splitMutate = vi.fn();
let applyState: { isPending: boolean; error: { message: string } | null } = { isPending: false, error: null };

vi.mock("../api", () => ({
  trpc: {
    director: {
      splitScript: {
        useMutation: () => ({ mutate: splitMutate, isPending: false, error: null, data: undefined, reset: vi.fn() }),
      },
    },
    scenes: {
      applyScript: {
        useMutation: () => ({
          mutate: applyMutate,
          isPending: applyState.isPending,
          error: applyState.error,
          reset: vi.fn(),
        }),
      },
    },
  },
}));

const ROWS = [
  { title: "開場・晨光", durationSec: 5, prompt: "清晨禪堂", voiceover: "那一年", cardNames: ["安倢的紅傘"] },
  { title: "收尾", durationSec: 3, prompt: "關門", voiceover: null },
];

describe("StoryboardScript", () => {
  beforeEach(() => {
    applyMutate.mockReset();
    splitMutate.mockReset();
    applyState = { isPending: false, error: null };
  });

  it("展開後可讀到整份腳本（含唯讀的設定卡標注）", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    const pre = screen.getByText(/## 1\. 開場・晨光 \(5s\)/);
    expect(pre).toBeVisible();
    expect(pre.textContent).toContain("設定卡：安倢的紅傘（唯讀）");
  });

  it("編輯時先預告會動到什麼——少寫的鏡標明保留不動", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    await user.click(screen.getByRole("button", { name: /編輯全文/ }));

    const box = screen.getByRole("textbox", { name: "分鏡腳本全文" });
    await user.clear(box);
    await user.type(box, "## 1. 改過的標題 (5s)");

    expect(screen.getByText(/將更新 1 鏡、保留 1 鏡不動（文字裡沒寫到）/)).toBeVisible();
  });

  it("寫回時把原文整份送出（伺服器自己再解析一次，不信任前端結構）", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    await user.click(screen.getByRole("button", { name: /編輯全文/ }));
    await user.click(screen.getByRole("button", { name: "寫回分鏡" }));

    await waitFor(() => expect(applyMutate).toHaveBeenCalled());
    const arg = applyMutate.mock.calls[0][0];
    expect(arg.projectId).toBe("p1");
    expect(arg.text).toContain("## 1. 開場・晨光 (5s)");
  });

  it("格式錯（整段沒有 ##）會擋下寫回並說明原因", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    await user.click(screen.getByRole("button", { name: /編輯全文/ }));
    const box = screen.getByRole("textbox", { name: "分鏡腳本全文" });
    await user.clear(box);
    await user.type(box, "開場：晨光");

    expect(screen.getByRole("alert")).toHaveTextContent(/以「## 」開頭/);
    expect(screen.getByRole("button", { name: "寫回分鏡" })).toBeDisabled();
  });

  it("檢視者讀得到全文，但沒有編輯入口", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit={false} onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    expect(screen.getByText(/## 1\. 開場・晨光/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /編輯全文/ })).toBeNull();
  });

  it("還沒有分鏡時給明確的下一步，不是空白面板", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={[]} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    expect(screen.getByText(/還沒有分鏡/)).toBeVisible();
  });

  it("貼腳本拆分鏡：原文整份送給 AI 導演（標準模式先前只能繞知識庫）", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    await user.click(screen.getByRole("button", { name: /貼腳本拆分鏡/ }));
    await user.type(screen.getByRole("textbox", { name: /貼上原始腳本/ }), "那一年我走進禪堂。");
    await user.click(screen.getByRole("button", { name: "AI 拆分鏡" }));

    await waitFor(() => expect(splitMutate).toHaveBeenCalled());
    expect(splitMutate.mock.calls[0][0]).toEqual({ projectId: "p1", scriptText: "那一年我走進禪堂。" });
  });

  it("留空＝改用知識庫的腳本（送 undefined，不是空字串）", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    await user.click(screen.getByRole("button", { name: /貼腳本拆分鏡/ }));
    await user.click(screen.getByRole("button", { name: "AI 拆分鏡" }));

    await waitFor(() => expect(splitMutate).toHaveBeenCalled());
    expect(splitMutate.mock.calls[0][0]).toEqual({ projectId: "p1", scriptText: undefined });
  });

  it("檢視者看不到貼腳本入口", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit={false} onApplied={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    expect(screen.queryByRole("button", { name: /貼腳本拆分鏡/ })).toBeNull();
  });
});
