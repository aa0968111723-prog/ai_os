import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const digestQuery = vi.fn();
const failedQuery = vi.fn();
const retryMutateAsync = vi.fn();
const composed: string[] = [];
const opened: string[] = [];
const deepLinks: unknown[] = [];
const invalidate = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({ companion: { digest: { invalidate } } }),
    companion: {
      digest: { useQuery: (...args: unknown[]) => digestQuery(...args) },
      failedGenerations: { useQuery: (...args: unknown[]) => failedQuery(...args) },
    },
    generation: { retry: { useMutation: () => ({ mutateAsync: retryMutateAsync }) } },
  },
}));
vi.mock("../lib/assistantCompose", () => ({
  composeToAssistant: (text: string) => composed.push(text),
  openAssistantSurface: () => opened.push("open"),
  useAssistantComposeListener: () => {},
  useAssistantOpenListener: () => {},
}));
vi.mock("../lib/assistantContext", () => ({ registerAssistantPage: () => () => {} }));
vi.mock("./openInBrowser", () => ({
  openCompanionDeepLink: (input: unknown) => {
    deepLinks.push(input);
    return "https://aios.test/p/11111111-2222-4333-8444-555555555555";
  },
}));
vi.mock("./useCompanionRealtime", () => ({
  useCompanionRealtime: () => ({
    live: { running: 0, awaiting: 0, failed: 0, completed: 0 },
    connected: true,
  }),
}));

const voice = {
  supported: true,
  status: "idle" as string,
  transcript: "",
  amplitude: 0,
  start: vi.fn(),
  stop: vi.fn(() => ""),
  stopAsync: vi.fn(() => Promise.resolve("")),
};
vi.mock("./useVoiceInput", () => ({ useVoiceInput: () => voice }));
vi.mock("../lib/phoneAssistantBridge", () => ({ usePhoneAssistantTurn: () => null }));

import { CompanionHome } from "./CompanionHome";

const PID = "11111111-2222-4333-8444-555555555555";

const project = {
  id: PID,
  title: "淡江動畫",
  stage: "generate",
  shots: 12,
  shotsWithVisual: 8,
  awaitingGenerations: 0,
  runningGenerations: 0,
  failedGenerations: 0,
  freshResults: 0,
  updatedAt: "2026-08-19T10:00:00.000Z",
};

function mockDigest(projects: unknown[], over: Record<string, unknown> = {}) {
  digestQuery.mockReturnValue({
    data: { projects, totals: { awaiting: 0, running: 0, failed: 0, fresh: 0 } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  });
}

function mockFailedList(items: Array<Record<string, unknown>>, totalPointsEst = 0) {
  failedQuery.mockReturnValue({
    data: { projectTitle: "淡江動畫", items, totalPointsEst },
    isLoading: false,
    isError: false,
  });
}

beforeEach(() => {
  composed.length = 0;
  opened.length = 0;
  deepLinks.length = 0;
  voice.status = "idle";
  voice.transcript = "";
  voice.stop.mockReturnValue("");
  voice.stopAsync.mockResolvedValue("");
  retryMutateAsync.mockReset();
  retryMutateAsync.mockResolvedValue({});
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  mockDigest([project]);
  mockFailedList([]);
});

describe("首屏", () => {
  it("只有問候語、提示、球、輸入框與卡——沒有 dashboard、沒有側邊欄", () => {
    render(<CompanionHome groupId="g1" userName="小明" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/小明/);
    expect(screen.getByRole("button", { name: /AIOS 助手/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("說說看，你今天想做什麼")).toBeInTheDocument();
    // 專案總表不該出現在首屏
    expect(screen.queryByText("全部專案")).toBeNull();
  });

  it("主動提示講的是真實現況", () => {
    mockDigest([{ ...project, awaitingGenerations: 2 }]);
    render(<CompanionHome groupId="g1" />);
    expect(screen.getByText(/2 筆生成在等你決定/)).toBeInTheDocument();
  });

  it("最多三張卡", () => {
    mockDigest([{ ...project, awaitingGenerations: 2, failedGenerations: 3, runningGenerations: 1, freshResults: 5 }]);
    render(<CompanionHome groupId="g1" />);
    expect(screen.getByLabelText("現在需要你的事").querySelectorAll(".companion-card")).toHaveLength(3);
  });

  it("沒有組別時說得清楚，不是空白畫面", () => {
    render(<CompanionHome groupId="" />);
    expect(screen.getByText("還沒有組別")).toBeInTheDocument();
  });

  it("查詢失敗講「載不到」，不是「還沒有專案」", () => {
    mockDigest([], { data: undefined, isError: true, error: { message: "連線逾時" } });
    render(<CompanionHome groupId="g1" />);
    expect(screen.getByText("載不到你的專案")).toBeInTheDocument();
    expect(screen.getByText("連線逾時")).toBeInTheDocument();
  });
});

describe("對話", () => {
  it("送出走既有助手接縫，不自己打 API", () => {
    render(<CompanionHome groupId="g1" />);
    fireEvent.change(screen.getByPlaceholderText("說說看，你今天想做什麼"), {
      target: { value: "動畫做到哪了" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送出給 Aios" }));
    expect(composed).toEqual(["動畫做到哪了"]);
  });

  it("空字串不送", () => {
    render(<CompanionHome groupId="g1" />);
    fireEvent.change(screen.getByPlaceholderText("說說看，你今天想做什麼"), { target: { value: "   " } });
    fireEvent.submit(screen.getByPlaceholderText("說說看，你今天想做什麼").closest("form")!);
    expect(composed).toEqual([]);
  });

  it("點球打開既有助手面板", () => {
    render(<CompanionHome groupId="g1" />);
    const orb = screen.getByRole("button", { name: /AIOS 助手/ });
    fireEvent.pointerDown(orb, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(orb, { clientX: 10, clientY: 10, pointerId: 1, button: 0 });
    expect(opened).toEqual(["open"]);
  });

  it("卡片的 compose 按鈕會把專案名一起帶上——「這張」才有所指", () => {
    mockDigest([{ ...project, failedGenerations: 3 }]);
    render(<CompanionHome groupId="g1" />);
    fireEvent.click(screen.getByRole("button", { name: "先看原因" }));
    expect(composed[0]).toContain("淡江動畫");
    expect(composed[0]).toContain("為什麼失敗");
  });
});

describe("失敗的重跑（確定性確認卡）", () => {
  const failedItems = [
    { id: "aaaa1111-2222-4333-8444-555555555555", kind: "image", modelId: "flux", pointsEst: 4, error: "boom" },
    { id: "bbbb1111-2222-4333-8444-555555555555", kind: "video", modelId: "kling", pointsEst: 8, error: null },
  ];

  it("「全部重跑」不丟給助手——出確認卡，講清楚幾筆、預估幾點", () => {
    mockDigest([{ ...project, failedGenerations: 2 }]);
    mockFailedList(failedItems, 12);
    render(<CompanionHome groupId="g1" />);
    fireEvent.click(screen.getByRole("button", { name: "全部重跑" }));
    // 沒有送話給助手
    expect(composed).toEqual([]);
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("2 筆失敗生成");
    expect(dialog.textContent).toContain("預估使用 12 點");
  });

  it("拍板後逐筆走既有 generation.retry，並誠實回報成功筆數", async () => {
    mockDigest([{ ...project, failedGenerations: 2 }]);
    mockFailedList(failedItems, 12);
    render(<CompanionHome groupId="g1" />);
    fireEvent.click(screen.getByRole("button", { name: "全部重跑" }));
    fireEvent.click(screen.getByRole("button", { name: "就這樣做" }));
    await waitFor(() => expect(screen.getByText(/已重新啟動 2 筆/)).toBeInTheDocument());
    expect(retryMutateAsync.mock.calls.map(([input]) => (input as { id: string }).id))
      .toEqual(failedItems.map((item) => item.id));
    // 權威數字重抓
    expect(invalidate).toHaveBeenCalled();
  });

  it("部分失敗就照實說 N 成功 M 失敗，不整批報成功", async () => {
    mockDigest([{ ...project, failedGenerations: 2 }]);
    mockFailedList(failedItems, 12);
    retryMutateAsync
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("點數不足"));
    render(<CompanionHome groupId="g1" />);
    fireEvent.click(screen.getByRole("button", { name: "全部重跑" }));
    fireEvent.click(screen.getByRole("button", { name: "就這樣做" }));
    await waitFor(() => expect(screen.getByText(/1 筆已重啟、1 筆沒送出去（點數不足）/)).toBeInTheDocument());
  });

  it("「先不要」收起卡片，什麼都不執行", () => {
    mockDigest([{ ...project, failedGenerations: 2 }]);
    mockFailedList(failedItems, 12);
    render(<CompanionHome groupId="g1" />);
    fireEvent.click(screen.getByRole("button", { name: "全部重跑" }));
    fireEvent.click(screen.getByRole("button", { name: "先不要" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(retryMutateAsync).not.toHaveBeenCalled();
  });
});

describe("語音", () => {
  it("聆聽時顯示逐字稿，讓人知道機器聽到什麼", () => {
    voice.status = "listening";
    voice.transcript = "幫我看看動畫";
    render(<CompanionHome groupId="g1" />);
    expect(screen.getByText("幫我看看動畫")).toBeInTheDocument();
  });

  it("沒權限時給文字退路，不是一顆按不動的麥克風", () => {
    voice.status = "denied";
    render(<CompanionHome groupId="g1" />);
    expect(screen.getByText(/麥克風沒有權限/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText("說說看，你今天想做什麼")).toBeEnabled();
  });
});

describe("深連結", () => {
  it("「查看」開瀏覽器到 Web 專案，並說明理由", async () => {
    render(<CompanionHome groupId="g1" />);
    fireEvent.click(screen.getByRole("button", { name: /查看/ }));
    expect(deepLinks[0]).toMatchObject({ target: "project", projectId: PID });
    await waitFor(() => expect(screen.getByText(/瀏覽器/)).toBeInTheDocument());
  });
});

describe("離線", () => {
  it("離線時說「我先記住」，不假裝已執行", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    render(<CompanionHome groupId="g1" />);
    fireEvent.change(screen.getByPlaceholderText("說說看，你今天想做什麼"), {
      target: { value: "把失敗的重跑" },
    });
    fireEvent.click(screen.getByRole("button", { name: "送出給 Aios" }));
    // 沒有送給助手
    expect(composed).toEqual([]);
    await waitFor(() => expect(screen.getByText(/我先記住這句/)).toBeInTheDocument());
  });
});
