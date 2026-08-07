/**
 * 作業台「需要注意的 AI 工作」。
 *
 * 這張卡的價值全在「篩選與誠實」：agentOverview 回的 runs 含完成、已停止、三個月前
 * 失敗過的舊帳，全列出來等於沒篩；而該顯示的（失敗原因、發起人、被截掉幾筆）少一項，
 * 使用者就得回頭一個個開專案問人——那正是這張卡要消滅的行為。
 * 因此這裡測的是契約：誰該出現、誰不該、順序、以及被藏起來的筆數有沒有講清楚。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type React from "react";
import { AgentRunsCard, selectAttentionRuns, type AgentRunRow } from "./AgentRunsCard";

/** 真的 Link 會要求 Router context；保留 <a href> 才驗得出「點得進對應專案」 */
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function run(over: Partial<AgentRunRow> = {}): AgentRunRow {
  return {
    id: "r1",
    projectId: "p1",
    projectTitle: "挑戰營回顧影片",
    goal: "把三支素材剪成一支三分鐘見證",
    status: "running",
    doneSteps: 2,
    totalSteps: 5,
    updatedAt: new Date(Date.now() - 5 * MIN).toISOString(),
    userName: "阿光",
    error: null,
    currentStepNote: null,
    ...over,
  };
}

describe("selectAttentionRuns：只留下需要人注意的", () => {
  it("完成／已停止不列——它們不需要任何人做事", () => {
    const picked = selectAttentionRuns([
      run({ id: "done", status: "done" }),
      run({ id: "stopped", status: "stopped" }),
      run({ id: "live", status: "running" }),
    ]);
    expect(picked.map((r) => r.id)).toEqual(["live"]);
  });

  it("失敗只認最近七天；更早的舊帳不該永遠掛在首頁", () => {
    const picked = selectAttentionRuns([
      run({ id: "old", status: "failed", updatedAt: new Date(Date.now() - 8 * DAY).toISOString() }),
      run({ id: "fresh", status: "failed", updatedAt: new Date(Date.now() - 6 * DAY).toISOString() }),
    ]);
    expect(picked.map((r) => r.id)).toEqual(["fresh"]);
  });

  it("依「人要不要動手」排序：失敗→待核准→等待人員→執行中", () => {
    const picked = selectAttentionRuns([
      run({ id: "running", status: "running" }),
      run({ id: "waiting", status: "waiting" }),
      run({ id: "approval", status: "awaiting_approval" }),
      run({ id: "failed", status: "failed" }),
    ]);
    expect(picked.map((r) => r.id)).toEqual(["failed", "approval", "waiting", "running"]);
  });

  it("同狀態內最近更新的排前面", () => {
    const picked = selectAttentionRuns([
      run({ id: "older", status: "running", updatedAt: new Date(Date.now() - 3 * 60 * MIN).toISOString() }),
      run({ id: "newer", status: "running", updatedAt: new Date(Date.now() - 2 * MIN).toISOString() }),
    ]);
    expect(picked.map((r) => r.id)).toEqual(["newer", "older"]);
  });
});

describe("AgentRunsCard", () => {
  it("每一筆都點得進對應專案，並顯示發起人、目前步驟與進度", () => {
    render(<AgentRunsCard runs={[run({ projectId: "p9", currentStepNote: "等待配音檔上傳" })]} />);
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("link")).toHaveAttribute("href", "/p/p9");
    expect(within(row).getByText("挑戰營回顧影片")).toBeInTheDocument();
    expect(within(row).getByText("執行中")).toBeInTheDocument();
    expect(within(row).getByText("目前：等待配音檔上傳")).toBeInTheDocument();
    expect(row).toHaveTextContent("阿光 發起");
    expect(row).toHaveTextContent("進度 2/5 步");
  });

  it("沒有目前步驟時退回顯示目標（不留白）", () => {
    render(<AgentRunsCard runs={[run({ currentStepNote: null })]} />);
    expect(screen.getByText("目標：把三支素材剪成一支三分鐘見證")).toBeInTheDocument();
  });

  it("失敗要看得到錯誤摘要——這是使用者最需要的一行", () => {
    render(<AgentRunsCard runs={[run({ status: "failed", error: "配音模型額度用盡" })]} />);
    expect(screen.getByText(/失敗原因：配音模型額度用盡/)).toBeInTheDocument();
  });

  it("失敗但後端沒留訊息時，給下一步而不是只丟一個「失敗」", () => {
    render(<AgentRunsCard runs={[run({ status: "failed", error: null })]} />);
    expect(screen.getByText(/失敗原因：AI 沒有留下訊息——點進專案看執行紀錄。/)).toBeInTheDocument();
  });

  it("全部正常時不佔版面：只留一句話，不列任何項目", () => {
    render(<AgentRunsCard runs={[run({ status: "done" }), run({ id: "r2", status: "stopped" })]} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(screen.getByText(/沒有卡住或待你處理的計畫/)).toBeInTheDocument();
  });

  it("這個組根本還沒用過 AI 代理就什麼都不渲染", () => {
    const { container } = render(<AgentRunsCard runs={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("超過上限只顯示前四筆，並誠實說還有幾筆；按下就展開全部", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 7 }, (_, i) =>
      run({ id: `r${i}`, projectId: `p${i}`, projectTitle: `專案 ${i}`, status: "waiting" }),
    );
    render(<AgentRunsCard runs={many} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "顯示全部（還有 3 筆）" }));
    expect(screen.getAllByRole("listitem")).toHaveLength(7);
    expect(screen.queryByRole("button", { name: /顯示全部/ })).toBeNull();
  });

  it("回傳筆數頂到後端上限時要講明更早的沒回來", () => {
    const capped = Array.from({ length: 3 }, (_, i) => run({ id: `r${i}`, status: "running" }));
    render(<AgentRunsCard runs={capped} listLimit={3} />);
    expect(screen.getByText(/最多列最近 3 筆計畫/)).toBeInTheDocument();
  });

  it("沒頂到上限就不要嚇人（不顯示截斷說明）", () => {
    render(<AgentRunsCard runs={[run()]} listLimit={30} />);
    expect(screen.queryByText(/最多列最近/)).toBeNull();
  });

  it("首次載入鋪骨架；已有資料的背景輪詢不整塊閃回骨架", () => {
    const { rerender } = render(<AgentRunsCard runs={undefined} isLoading />);
    expect(screen.getByLabelText("AI 代理狀況載入中")).toHaveAttribute("aria-busy", "true");
    rerender(<AgentRunsCard runs={[run()]} isLoading />);
    expect(screen.queryByLabelText("AI 代理狀況載入中")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("載入失敗用既有錯誤樣式，並給得回去的重試", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<AgentRunsCard runs={undefined} errorMessage="連線逾時" onRetry={onRetry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("error");
    await user.click(within(alert).getByRole("button", { name: "再試一次" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
