import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentActivityHud } from "./AgentActivityHud";

const stopMutate = vi.fn();
let overviewRuns: unknown[] = [];
let stopPending = false;
let stopOnSuccess: (() => void) | undefined;

vi.mock("../../api", () => ({
  trpc: {
    useUtils: () => ({ teamAssistant: { agentOverview: { invalidate: vi.fn() } } }),
    teamAssistant: {
      agentOverview: { useQuery: () => ({ data: { runs: overviewRuns }, isLoading: false, error: null }) },
    },
    agents: {
      stop: {
        useMutation: (opts?: { onSuccess?: () => void; onError?: () => void }) => {
          stopOnSuccess = opts?.onSuccess;
          return {
            mutate: (input: { runId: string }) => {
              stopMutate(input);
              stopOnSuccess?.();
            },
            isPending: stopPending,
            error: null,
          };
        },
      },
    },
  },
}));

function run(partial: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    projectId: "proj-1",
    projectTitle: "淡江禪學社招生影片",
    goal: "把腳本拆成 6 鏡並逐鏡出圖",
    status: "running",
    doneSteps: 2,
    totalSteps: 6,
    currentStepNote: "為第 3 鏡生成畫面",
    revision: 1_000,
    ...partial,
  };
}

/**
 * 代理是背景執行的（關掉頁面也續跑）。在這條 HUD 之前，看得到進度的只有專案頁的
 * AgentCard——離開那頁就完全失去線索。這支測試守的是「跨頁看得見＋隨時停得掉」。
 */
describe("AgentActivityHud", () => {
  it("沒有在跑的代理時完全不渲染——常駐 UI 只在有話要說時才值得佔畫面", () => {
    overviewRuns = [run({ status: "done" }), run({ id: "r2", status: "failed" })];
    const { container } = render(<AgentActivityHud groupId="g1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("顯示目前步驟、專案與進度，並用 aria-live 播報", () => {
    overviewRuns = [run()];
    render(<AgentActivityHud groupId="g1" />);
    const hud = screen.getByRole("status");
    expect(hud).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("為第 3 鏡生成畫面")).toBeVisible();
    expect(screen.getByText(/淡江禪學社招生影片・2\/6 步/)).toBeVisible();
    expect(screen.getByText("開拍中")).toBeVisible();
  });

  it("多個同時在跑時說出還有幾個，不讓人以為只有一個", () => {
    overviewRuns = [run(), run({ id: "r2" }), run({ id: "r3", status: "waiting" })];
    render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText(/另有 2 個/)).toBeVisible();
  });

  it("待核准／等回覆的狀態各自講人話，不是原始 status 字串", () => {
    overviewRuns = [run({ status: "awaiting_approval" })];
    const { unmount } = render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText("待你過目")).toBeVisible();
    unmount();

    overviewRuns = [run({ status: "waiting" })];
    render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText("等你回覆")).toBeVisible();
  });

  it("waiting_user_input / waiting_confirmation / waiting_permission 仍顯示在 HUD，不會消失", () => {
    for (const [status, label] of [
      ["waiting_user_input", "等你補充"],
      ["waiting_confirmation", "等你確認"],
      ["waiting_permission", "需要權限"],
    ] as const) {
      overviewRuns = [run({ status })];
      const { unmount } = render(<AgentActivityHud groupId="g1" />);
      expect(screen.getByRole("status")).toBeVisible();
      expect(screen.getByText(label)).toBeVisible();
      unmount();
    }
  });

  it("「停」直接放在列上——代理會花點數會改資料，任何頁面都要能立刻按停", async () => {
    const user = userEvent.setup();
    overviewRuns = [run()];
    render(<AgentActivityHud groupId="g1" />);
    await user.click(screen.getByRole("button", { name: /停/ }));
    expect(stopMutate).toHaveBeenCalledWith({ runId: "run-1" });
  });

  it("停止 acknowledgement：mutation 完成後仍顯示停止中，直到 overview 變 terminal", async () => {
    const user = userEvent.setup();
    overviewRuns = [run({ status: "running", revision: 100 })];
    const { rerender } = render(<AgentActivityHud groupId="g1" />);
    await user.click(screen.getByRole("button", { name: /停/ }));
    expect(screen.getByText("停止中…")).toBeVisible();
    // Mutation settled but run still running → still 停止中
    rerender(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText("停止中…")).toBeVisible();
    // Authoritative terminal
    overviewRuns = [run({ status: "stopped", revision: 200 })];
    rerender(<AgentActivityHud groupId="g1" />);
    await waitFor(() => {
      expect(screen.queryByText("停止中…")).toBeNull();
    });
  });

  it("沒有 currentStepNote 時退回目標，不留白", () => {
    overviewRuns = [run({ currentStepNote: null })];
    render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText("把腳本拆成 6 鏡並逐鏡出圖")).toBeVisible();
  });

  it("顯示 waitingReason 摘要（PR-2 DTO）", () => {
    overviewRuns = [run({
      status: "waiting_user_input",
      waitingReason: "需要你補充資訊",
    })];
    render(<AgentActivityHud groupId="g1" />);
    expect(screen.getByText(/需要你補充資訊/)).toBeVisible();
  });
});

// Theater stop is unit-tested in client/src/lib/agentTheater.test.ts

