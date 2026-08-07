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
/** 寫回成功時伺服器回什麼（warnings＝看得懂但沒照做的行） */
let applyResult: { warnings: string[] } = { warnings: [] };
/** 拆分鏡成功時伺服器回什麼（truncation 非 null＝尾段沒拆進來） */
let splitResult: { truncation: { sentChars: number; totalChars: number } | null } = { truncation: null };

// useMutation 用真的 useState 存 data：截斷提示是在成功「之後」才渲染的，
// 沒有真實的重新渲染就測不到「提示到底看不看得見」。
vi.mock("../api", async () => {
  const { useState } = await vi.importActual<typeof import("react")>("react");
  return {
    trpc: {
      director: {
        splitScript: {
          useMutation: (opts?: { onSuccess?: (data: typeof splitResult) => void }) => {
            const [data, setData] = useState<typeof splitResult | undefined>(undefined);
            return {
              mutate: (vars: unknown) => {
                splitMutate(vars);
                setData(splitResult);
                opts?.onSuccess?.(splitResult);
              },
              isPending: false,
              error: null,
              data,
              reset: () => setData(undefined),
            };
          },
        },
      },
      scenes: {
        applyScript: {
          // 同樣用真的 useState 存 data：伺服器才知道的 warnings（卡片名字對不上時整行不套用）
          // 是在寫回成功「之後」才渲染的，沒有真實重新渲染就測不到它看不看得見
          useMutation: (opts?: { onSuccess?: () => void }) => {
            const [data, setData] = useState<typeof applyResult | undefined>(undefined);
            return {
              mutate: (vars: unknown) => {
                applyMutate(vars);
                setData(applyResult);
                opts?.onSuccess?.();
              },
              isPending: applyState.isPending,
              error: applyState.error,
              data,
              reset: () => setData(undefined),
            };
          },
        },
      },
    },
  };
});

const ROWS = [
  { title: "開場・晨光", durationSec: 5, prompt: "清晨禪堂", voiceover: "那一年", propNames: ["安倢的紅傘"] },
  { title: "收尾", durationSec: 3, prompt: "關門", voiceover: null },
];

describe("StoryboardScript", () => {
  beforeEach(() => {
    applyMutate.mockReset();
    splitMutate.mockReset();
    applyState = { isPending: false, error: null };
    splitResult = { truncation: null };
    applyResult = { warnings: [] };
  });

  it("展開後可讀到整份腳本（含可寫回的卡片行）", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    const pre = screen.getByText(/## 1\. 開場・晨光 \(5s\)/);
    expect(pre).toBeVisible();
    expect(pre.textContent).toContain("素材卡：安倢的紅傘");
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

  /**
   * 卡片名字對不上時伺服器整行不套用，而寫回一成功編輯框就收掉了。
   * 不把這一則講出來，使用者看到的只有「寫回成功」，他寫的角色卻一個都沒進去。
   */
  it("寫回成功後仍顯示伺服器回報的「沒照做」的行", async () => {
    applyResult = { warnings: ["第 1 鏡的「角色卡」裡找不到「小明」，整行不套用（其餘名字也沒動）"] };
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    await user.click(screen.getByRole("button", { name: /編輯全文/ }));
    await user.click(screen.getByRole("button", { name: "寫回分鏡" }));

    // 編輯框已經收掉（onSuccess 清 draft），提示仍在
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/找不到「小明」/));
    expect(screen.queryByRole("textbox", { name: "分鏡腳本全文" })).toBeNull();
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

  it("腳本被截斷時面板留著，尾段沒拆進來這件事看得到（收掉等於沒講）", async () => {
    splitResult = { truncation: { sentChars: 12000, totalChars: 20000 } };
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    await user.click(screen.getByRole("button", { name: /貼腳本拆分鏡/ }));
    const box = screen.getByRole("textbox", { name: /貼上原始腳本/ });
    await user.type(box, "很長的腳本");
    await user.click(screen.getByRole("button", { name: "AI 拆分鏡" }));

    expect(await screen.findByText(/只送了前 12,000 字/)).toBeVisible();
    expect(box).toHaveValue("很長的腳本"); // 原文留著，好刪掉已拆的前段再拆一次
  });

  it("沒被截斷就收掉面板（不留一個沒事做的輸入框）", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit onApplied={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    await user.click(screen.getByRole("button", { name: /貼腳本拆分鏡/ }));
    await user.type(screen.getByRole("textbox", { name: /貼上原始腳本/ }), "短腳本");
    await user.click(screen.getByRole("button", { name: "AI 拆分鏡" }));

    await waitFor(() => expect(screen.queryByRole("textbox", { name: /貼上原始腳本/ })).toBeNull());
  });

  it("檢視者看不到貼腳本入口", async () => {
    const user = userEvent.setup();
    render(<StoryboardScript projectId="p1" rows={ROWS} canEdit={false} onApplied={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /文字腳本/ }));
    expect(screen.queryByRole("button", { name: /貼腳本拆分鏡/ })).toBeNull();
  });
});
