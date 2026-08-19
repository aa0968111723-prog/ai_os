import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectQuery = vi.fn();
const assetsQuery = vi.fn();
const composed: string[] = [];
/** 「只開面板、不代說話」被按到時會 push 一筆 */
const opened: string[] = [];
/** 桌面工作台被真的載進來時會 push 一筆——第一屏絕不該有 */
const heavyLoads: string[] = [];

vi.mock("../api", () => ({
  trpc: {
    phone: { project: { useQuery: (...args: unknown[]) => projectQuery(...args) } },
    projects: { assets: { useQuery: (...args: unknown[]) => assetsQuery(...args) } },
  },
}));
vi.mock("./usePhoneAnimationRepair", () => ({
  usePhoneAnimationRepair: () => ({
    card: null,
    tryHandle: () => false,
    runCommand: async () => {},
    active: false,
  }),
}));
vi.mock("../lib/assistantCompose", () => ({
  composeToAssistant: (text: string) => composed.push(text),
  useAssistantComposeListener: () => {},
  openAssistantSurface: () => opened.push("assistant"),
  useAssistantOpenListener: () => {},
}));
vi.mock("../pages/ProjectPage", () => ({
  ProjectPage: () => {
    heavyLoads.push("desktop-workbench");
    return <div data-testid="desktop-workbench" />;
  },
}));

const navigate = vi.fn();
vi.mock("wouter", () => ({ useLocation: () => ["/p/p1", navigate] }));

import { MobileProjectPage } from "./MobileProjectPage";
import { publishPhoneAssistantTurn, resetPhoneAssistantBridgeForTest } from "../lib/phoneAssistantBridge";

const SUMMARY = {
  project: {
    id: "p1",
    groupId: "g1",
    title: "禪心一炷香",
    kind: "short",
    format: "9:16",
    status: "active",
    updatedAt: new Date("2026-08-01"),
  },
  progress: {
    shots: 8,
    shotsWithVisual: 3,
    shotsWithNarration: 1,
    storyChars: 1200,
    assets: 24,
    awaitingGenerations: 0,
    runningGenerations: 0,
    generationsDone: 5,
  },
  stage: "generate",
  recentAssets: [
    { id: "a1", title: "開場", url: "/assets/a1.png", kind: "image", createdAt: new Date() },
    { id: "a2", title: "香爐", url: "/assets/a2.png", kind: "image", createdAt: new Date() },
  ],
};

afterEach(() => window.history.replaceState(null, "", "/"));

beforeEach(() => {
  composed.length = 0;
  opened.length = 0;
  heavyLoads.length = 0;
  resetPhoneAssistantBridgeForTest();
  navigate.mockClear();
  // mockReturnValue 不會清掉呼叫紀錄——不清的話「只有一個 query key」那條
  // 讀到的是跨案例累積的 calls，等於在驗別的測試留下的殘影。
  projectQuery.mockClear();
  assetsQuery.mockClear();
  projectQuery.mockReturnValue({ data: SUMMARY, isLoading: false, isError: false, error: null });
  assetsQuery.mockReturnValue({ data: [], isLoading: false, isFetching: false });
});

describe("手機專案頁", () => {
  it("第一屏就是專案名 → 進度 → 繼續製作 → 問 AI", () => {
    render(<MobileProjectPage id="p1" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("禪心一炷香");
    expect(screen.getByLabelText("目前進度：生成")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /繼續生成/ })).toBeInTheDocument();
    expect(screen.getByLabelText("跟 Aios 說一句話")).toBeInTheDocument();
  });

  it("第一屏一支查詢就夠，而且不掛桌面工作台", () => {
    render(<MobileProjectPage id="p1" />);

    // 算「不同的查詢鍵」而不是呼叫次數：hook 每次 render 都會被呼叫一次，
    // 但 react-query 是以 key 去重的，真正上網路的是不同的 key 有幾個。
    // 桌面 ProjectPage 掛載時是十一個（其中兩個還在輪詢）；手機要的是一個。
    const keys = new Set(projectQuery.mock.calls.map((call) => JSON.stringify(call[0])));
    expect([...keys]).toEqual([JSON.stringify({ projectId: "p1" })]);
    // 這條是整個手機重構的核心：桌面工作台是 234KB gzip 的 chunk，
    // 第一屏掛上去等於前面所有的省全部白做。
    expect(heavyLoads).toEqual([]);
    expect(screen.queryByTestId("desktop-workbench")).not.toBeInTheDocument();
  });

  it("按下「繼續製作」才載入完整工作台", async () => {
    render(<MobileProjectPage id="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /繼續生成/ }));

    expect(await screen.findByTestId("desktop-workbench")).toBeInTheDocument();
    expect(heavyLoads).toEqual(["desktop-workbench"]);
  });

  it("打開完整工作台之後仍回得去摘要", async () => {
    render(<MobileProjectPage id="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /繼續生成/ }));
    await screen.findByTestId("desktop-workbench");

    fireEvent.click(screen.getByRole("button", { name: /回專案摘要/ }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("禪心一炷香");
  });

  it("素材是次級入口——第一屏不查素材庫", () => {
    render(<MobileProjectPage id="p1" />);
    // 摘要自帶六張縮圖，不需要另外打 projects.assets
    expect(assetsQuery).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /素材/ })).toBeInTheDocument();
  });

  it("縮圖走 lazy loading，首屏不下載捲動線以下的原圖", () => {
    render(<MobileProjectPage id="p1" />);
    const images = screen.getAllByRole("img");
    expect(images.length).toBeGreaterThan(0);
    for (const img of images) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).toHaveAttribute("decoding", "async");
    }
  });

  it("AI 快捷帶著專案現況，不是一句空泛的「繼續」", () => {
    render(<MobileProjectPage id="p1" />);
    fireEvent.click(screen.getByRole("button", { name: "接下來要做什麼？" }));

    expect(composed).toHaveLength(1);
    expect(composed[0]).toContain("禪心一炷香");
    expect(composed[0]).toContain("畫面 3／8 鏡");
  });

  it("帶錨點的深連結直接進工作台，不是停在摘要", async () => {
    // /p/:id#stage-board 從通知或桌機分享過來時，使用者要的是那一段。
    // 手機版原本完全不看 location.hash，錨點被靜靜吃掉。
    window.history.replaceState(null, "", "/p/p1#stage-board");
    render(<MobileProjectPage id="p1" />);
    expect(await screen.findByTestId("desktop-workbench")).toBeInTheDocument();
  });

  it("沒有錨點的網址維持摘要優先（首屏不載 234KB 工作台）", () => {
    window.history.replaceState(null, "", "/p/p1");
    render(<MobileProjectPage id="p1" />);
    expect(screen.queryByTestId("desktop-workbench")).not.toBeInTheDocument();
    expect(heavyLoads).toEqual([]);
  });

  it("桌面預設 #stage-story 維持摘要，不把 600px 左裁進完整工作台", () => {
    // writeInlineHash(null) 會把桌面專案頁寫成 #stage-story。縮到手機寬再掛
    // MobileProjectPage 時，那不是「使用者點了分鏡／角色」的深連結。
    window.history.replaceState(null, "", "/p/p1#stage-story");
    render(<MobileProjectPage id="p1" />);
    expect(screen.queryByTestId("desktop-workbench")).not.toBeInTheDocument();
    expect(heavyLoads).toEqual([]);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("禪心一炷香");
  });

  it("不認得的 hash 不會誤開工作台", () => {
    // #storyboard 是 section id 不是錨點——不能因為「看起來像」就開
    window.history.replaceState(null, "", "/p/p1#storyboard");
    render(<MobileProjectPage id="p1" />);
    expect(screen.queryByTestId("desktop-workbench")).not.toBeInTheDocument();
  });

  it("助手結果卡渲染出來，工作台仍然不下載（計畫 §11 的預算紅線）", () => {
    window.history.replaceState(null, "", "/p/p1");
    publishPhoneAssistantTurn({
      scope: "project", scopeId: "p1", running: false, updatedAt: 1,
      results: [{
        type: "generation",
        generationIds: ["0f8fad5b-d9cb-469f-a165-70867728950e"],
        projectId: "p1",
        verification: { status: "verified", message: "已註冊 1 筆生成" },
      }],
    });
    render(<MobileProjectPage id="p1" />);
    expect(screen.getByRole("button", { name: /去裁決候選/ })).toBeInTheDocument();
    expect(heavyLoads).toEqual([]);
  });

  it("已經在這一頁時，結果卡的「去裁決候選」仍然打得開工作台", async () => {
    // wouter 的 navigate 底層是 pushState，不會發 hashchange——只驗「按了有導航」
    // 的測試會綠著騙人，而使用者按下去畫面完全不動。
    window.history.replaceState(null, "", "/p/p1");
    publishPhoneAssistantTurn({
      scope: "project", scopeId: "p1", running: false, updatedAt: 1,
      results: [{
        type: "generation",
        generationIds: ["0f8fad5b-d9cb-469f-a165-70867728950e"],
        projectId: "p1",
        verification: { status: "verified", message: "已註冊 1 筆生成" },
      }],
    });
    render(<MobileProjectPage id="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /去裁決候選/ }));
    expect(await screen.findByTestId("desktop-workbench")).toBeInTheDocument();
  });

  it("次級入口有場景，不再把「知識」指到 sec-scenes", () => {
    render(<MobileProjectPage id="p1" />);
    expect(screen.getByRole("button", { name: /場景/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /知識/ })).not.toBeInTheDocument();
  });

  it("點場景會寫 hash 並打開工作台，而不是只捲收合列", async () => {
    window.history.replaceState(null, "", "/p/p1");
    render(<MobileProjectPage id="p1" />);
    fireEvent.click(screen.getByRole("button", { name: /場景/ }));
    expect(window.location.hash).toBe("#sec-scenes");
    expect(await screen.findByTestId("desktop-workbench")).toBeInTheDocument();
  });

  it("打不開的專案給的是可行動的錯誤，不是空白", () => {
    projectQuery.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: "找不到專案" },
    });
    render(<MobileProjectPage id="p1" />);
    expect(screen.getByText("打不開這個專案")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回首頁" })).toBeInTheDocument();
  });
});
