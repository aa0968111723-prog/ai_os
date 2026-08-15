import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const homeQuery = vi.fn();
const composed: string[] = [];

vi.mock("../api", () => ({
  trpc: { phone: { home: { useQuery: (...args: unknown[]) => homeQuery(...args) } } },
}));
vi.mock("../lib/assistantCompose", () => ({
  composeToAssistant: (text: string) => composed.push(text),
  useAssistantComposeListener: () => {},
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/dashboard", navigate] }));

import { MobileHome } from "./MobileHome";
import { continueAnchor } from "./stages";

const project = (over: Record<string, unknown> = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title: "禪心一炷香",
  kind: "short",
  format: "9:16",
  status: "active",
  updatedAt: new Date("2026-08-01"),
  coverUrl: null,
  shots: 8,
  shotsWithVisual: 3,
  awaitingGenerations: 0,
  stage: "generate",
  ...over,
});

beforeEach(() => {
  composed.length = 0;
  navigate.mockClear();
  homeQuery.mockReturnValue({
    data: { projects: [project()], totalAwaiting: 0 },
    isLoading: false,
    isFetching: false,
  });
});

describe("手機首頁", () => {
  it("首屏就回答「哪個專案、做到哪、按哪裡繼續」", () => {
    render(<MobileHome groupId="g1" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("禪心一炷香");
    expect(screen.getByText("畫面 3／8 鏡")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /繼續生成/ })).toBeInTheDocument();
  });

  it("「繼續製作」直接帶到專案的對應段落，不是丟到專案頁頂端", () => {
    render(<MobileHome groupId="g1" />);
    fireEvent.click(screen.getByRole("button", { name: /繼續生成/ }));
    // 錨點取自 continueAnchor（它自己對照 storyInlineNav 的單一出處），不在這裡寫死字串——
    // 寫死的話錨點改名時這條會綠著騙人，而使用者按下去不會捲到任何地方。
    expect(navigate).toHaveBeenCalledWith(
      `/p/11111111-1111-4111-8111-111111111111#${continueAnchor("generate")}`,
    );
    expect(continueAnchor("generate")).toBe("stage-create");
  });

  it("AI 輸入列送出的話走既有的 compose 接縫（不另起一套助手）", () => {
    render(<MobileHome groupId="g1" />);
    const input = screen.getByLabelText("跟 Aios 說一句話");
    fireEvent.change(input, { target: { value: "幫我生成下一個分鏡" } });
    fireEvent.submit(input.closest("form")!);

    expect(composed).toEqual(["幫我生成下一個分鏡"]);
    // 送出後清空，避免使用者以為沒送出去而再按一次
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("快捷維持在 2–4 顆——不做成滿版功能選單", () => {
    render(<MobileHome groupId="g1" />);
    const chips = screen.getAllByRole("button").filter((b) => b.className.includes("m-ai__chip"));
    expect(chips.length).toBeGreaterThanOrEqual(2);
    expect(chips.length).toBeLessThanOrEqual(4);
  });

  it("有待裁決的生成時，那件事蓋過階段敘述", () => {
    homeQuery.mockReturnValue({
      data: { projects: [project({ awaitingGenerations: 2 })], totalAwaiting: 2 },
      isLoading: false,
      isFetching: false,
    });
    render(<MobileHome groupId="g1" />);
    expect(screen.getByText("2 筆生成等你裁決")).toBeInTheDocument();
  });

  it("首屏只抓一小撮專案；按「看全部專案」才用大的 limit 重抓", () => {
    const { rerender } = render(<MobileHome groupId="g1" />);
    expect(homeQuery).toHaveBeenLastCalledWith(
      { groupId: "g1" },
      expect.objectContaining({ enabled: true }),
    );

    fireEvent.click(screen.getByRole("button", { name: /看全部專案/ }));
    rerender(<MobileHome groupId="g1" />);
    expect(homeQuery).toHaveBeenLastCalledWith(
      { groupId: "g1", limit: 100 },
      expect.anything(),
    );
  });

  it("查詢失敗講「載不到」，不是「還沒有專案」", () => {
    // 沿用空狀態會讓使用者以為自己的專案不見了——那是最不該給的錯誤訊息
    homeQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      error: { message: "連線逾時" },
      refetch: vi.fn(),
    });
    render(<MobileHome groupId="g1" />);
    expect(screen.getByText("載不到你的專案")).toBeInTheDocument();
    expect(screen.queryByText("還沒有專案")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重試" })).toBeInTheDocument();
  });

  it("看全部專案時保留前一份資料，畫面不閃回骨架", () => {
    render(<MobileHome groupId="g1" />);
    const opts = homeQuery.mock.calls.at(-1)?.[1] as { placeholderData?: unknown };
    // 換 limit＝換 query key＝data 瞬間變 undefined；沒有 placeholderData 的話
    // 整個首頁（含 AI 輸入列裡打到一半的字）會被卸載重來
    expect(typeof opts?.placeholderData).toBe("function");
    const keepPrevious = opts.placeholderData as (p: unknown) => unknown;
    expect(keepPrevious({ projects: [1] })).toEqual({ projects: [1] });
  });

  it("沒有組別時給的是指路，不是空白畫面", () => {
    render(<MobileHome groupId="" />);
    expect(screen.getByText("還沒有組別")).toBeInTheDocument();
  });
});
