/**
 * 模型指南頂欄改成「我的使用量」之後的三件事：
 * 1. 顯示的是自己跑過的模型（中文名＋次數＋點數），不是 404／逾時／NIM 這種站務稽核數字；
 * 2. 沒有紀錄時給的是下一步（去哪裡開工），不是一張空卡；
 * 3. 端點掛掉時卡片自己說「載入失敗」，不把整頁拖下水。
 */
import { render, screen } from "@testing-library/react";
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
});
