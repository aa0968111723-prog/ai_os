import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectQuery = vi.fn();
const assetsQuery = vi.fn();
const composed: string[] = [];
/** 桌面工作台被真的載進來時會 push 一筆——第一屏絕不該有 */
const heavyLoads: string[] = [];

vi.mock("../api", () => ({
  trpc: {
    phone: { project: { useQuery: (...args: unknown[]) => projectQuery(...args) } },
    projects: { assets: { useQuery: (...args: unknown[]) => assetsQuery(...args) } },
  },
}));
vi.mock("../lib/assistantCompose", () => ({
  composeToAssistant: (text: string) => composed.push(text),
  useAssistantComposeListener: () => {},
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

beforeEach(() => {
  composed.length = 0;
  heavyLoads.length = 0;
  navigate.mockClear();
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
