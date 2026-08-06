/**
 * 模型指南頂欄「我的使用量」要守住的事：
 * 1. 顯示的是自己跑過的模型（中文名＋次數＋點數），不是 404／逾時／NIM 這種站務稽核數字；
 * 2. 沒有紀錄時給的是下一步（去哪裡開工），不是一張空卡；
 * 3. 端點掛掉時卡片自己說「載入失敗」，不把整頁拖下水；
 * 4. 改成圖之後的三條紅線——摘要數字是**全量**不是榜上的和、沒進榜的要明說併去哪裡、
 *    類型識別要有中文文字（不能只有顏色），以及榜單長了要收得起來。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModelUsageCard } from "./ModelUsageCard";

const state: { data?: unknown; isLoading: boolean; error: { message: string } | null } = {
  data: undefined,
  isLoading: false,
  error: null,
};

vi.mock("../api", () => ({
  trpc: {
    models: {
      myUsage: { useQuery: () => state },
    },
  },
}));

function setUsage(next: Partial<typeof state>) {
  state.data = next.data;
  state.isLoading = next.isLoading ?? false;
  state.error = next.error ?? null;
}

describe("ModelUsageCard 我的使用量", () => {
  it("列出跑過的模型，用目錄裡的中文名而不是原始 id", () => {
    setUsage({
      data: {
        days: 30,
        models: [{ modelId: "fal-ai/flux/dev", submits: 12, done: 10, points: 24 }],
        totalSubmits: 12,
        totalDone: 10,
        totalPoints: 24,
      },
    });
    render(<ModelUsageCard />);
    expect(screen.getByText("我的使用量")).toBeInTheDocument();
    expect(screen.getByText("近 30 天")).toBeInTheDocument();
    expect(screen.getByText("FLUX.1 [dev]")).toBeInTheDocument();
    expect(screen.getByText("12 次 · 24 點")).toBeInTheDocument();
    // 站務稽核字樣不該再出現在創作者的頁面頂欄
    expect(screen.queryByText(/站內契約健康/)).not.toBeInTheDocument();
  });

  it("目錄查不到的 id 就直接顯示 id，不會變成空白格", () => {
    setUsage({
      data: {
        days: 7,
        models: [{ modelId: "fal-ai/not-in-catalog", submits: 1, done: 1, points: 3 }],
        totalSubmits: 1,
        totalDone: 1,
        totalPoints: 3,
      },
    });
    render(<ModelUsageCard />);
    expect(screen.getByText("fal-ai/not-in-catalog")).toBeInTheDocument();
  });

  it("沒有紀錄時給下一步，不是空卡", () => {
    setUsage({ data: { days: 30, models: [], totalSubmits: 0, totalDone: 0, totalPoints: 0 } });
    render(<ModelUsageCard />);
    expect(screen.getByText(/還沒有生成紀錄/)).toBeInTheDocument();
  });

  it("載入失敗只影響這張卡", () => {
    setUsage({ error: { message: "資料庫連線逾時" } });
    render(<ModelUsageCard />);
    expect(screen.getByText(/載入失敗——資料庫連線逾時/)).toBeInTheDocument();
  });

  /* ── 改成資料視覺化之後多出來的三件事：數字要誠實、分類要有文字、榜單要收得起來 ── */

  it("摘要與分佈用的是全量總計，超出榜單的模型另外交代，不會假裝 100% 就是全部", () => {
    setUsage({
      data: {
        days: 30,
        // 榜單只有兩顆，但這 30 天實際用過 5 顆、送出 20 次
        models: [
          { modelId: "fal-ai/flux/dev", submits: 9, done: 8, points: 9 },
          { modelId: "fal-ai/kokoro/mandarin-chinese", submits: 6, done: 6, points: 6 },
        ],
        modelCount: 5,
        totalSubmits: 20,
        totalDone: 16,
        totalPoints: 21,
      },
    });
    render(<ModelUsageCard />);
    // 摘要格報的是全量，不是榜上兩顆的和（15 次／14 完成）
    const summary = within(screen.getByRole("group", { name: "近期使用摘要" }));
    expect(summary.getByText("20")).toBeInTheDocument();
    expect(summary.getByText("16")).toBeInTheDocument();
    expect(summary.getByText("21")).toBeInTheDocument();
    expect(summary.getByText("5")).toBeInTheDocument();
    expect(summary.getByText("次完成 · 80%")).toBeInTheDocument();
    // 沒進榜的 3 顆（5 次）必須明說併到哪裡去，否則分佈條的 100% 是假的
    expect(screen.getByText(/其餘 3 顆（5 次）併入分佈條的「其他」/)).toBeInTheDocument();
  });

  it("產出類型有中文圖例與次數，識別不只靠顏色", () => {
    setUsage({
      data: {
        days: 30,
        models: [
          { modelId: "fal-ai/flux/dev", submits: 4, done: 4, points: 4 },
          { modelId: "fal-ai/kokoro/mandarin-chinese", submits: 3, done: 3, points: 3 },
          { modelId: "fal-ai/not-in-catalog", submits: 1, done: 1, points: 0 },
        ],
        modelCount: 3,
        totalSubmits: 8,
        totalDone: 8,
        totalPoints: 7,
      },
    });
    render(<ModelUsageCard />);
    expect(screen.getByText("圖片")).toBeInTheDocument();
    expect(screen.getByText("語音")).toBeInTheDocument();
    // 目錄查不到的 id 歸「其他」，不能被靜靜丟掉——丟掉的話各段加起來就對不上總數
    expect(screen.getByText("其他")).toBeInTheDocument();
  });

  it("榜單超過 6 顆時預設收起，展開鈕說得出還有幾顆", () => {
    setUsage({
      data: {
        days: 30,
        models: Array.from({ length: 9 }, (_, i) => ({
          modelId: `fal-ai/model-${i}`,
          submits: 9 - i,
          done: 9 - i,
          points: 1,
        })),
        modelCount: 9,
        totalSubmits: 45,
        totalDone: 45,
        totalPoints: 9,
      },
    });
    render(<ModelUsageCard />);
    expect(screen.getByText("fal-ai/model-5")).toBeInTheDocument();
    expect(screen.queryByText("fal-ai/model-6")).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: /再顯示 3 顆/ });
    fireEvent.click(more);
    expect(screen.getByText("fal-ai/model-8")).toBeInTheDocument();
  });
});
