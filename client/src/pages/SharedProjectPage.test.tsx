import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const viewQuery = vi.fn();

vi.mock("../api", () => ({
  trpc: { share: { view: { useQuery: (...a: unknown[]) => viewQuery(...a) } } },
}));

import { SharedProjectPage } from "./SharedProjectPage";

const view = (over: Record<string, unknown> = {}) => ({
  project: {
    title: "淡江禪學社期初招生影片",
    kind: "活動宣傳",
    platform: "ig",
    format: "16:9",
    status: "active",
    coverUrl: null,
    createdAt: new Date("2026-08-01"),
    updatedAt: new Date("2026-08-05"),
  },
  worldview: { logline: "一把紅傘，一段安靜的路", tones: ["溫暖", "安靜"], empty: "" },
  characters: [{ id: "c1", name: "安倢", appearance: "米白外套、紅傘", notes: null, imageUrl: null }],
  scenePresets: [],
  props: [],
  knowledge: [{ id: "k1", kind: "transcript", title: "師父開示", content: "內文", pinned: true, createdAt: new Date() }],
  assets: [],
  scenes: [{
    id: "s1", orderIndex: 0, title: "雨中的傘", durationSec: 5, status: "done",
    prompt: null, voiceover: "旁白", imageUrl: null, mime: null,
  }],
  ...over,
});

describe("SharedProjectPage（分享連結的唯讀檢視）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
  });

  it("渲染專案內容，並標明這是唯讀畫面", () => {
    viewQuery.mockReturnValue({ data: view(), isLoading: false, error: null });
    render(<SharedProjectPage token="t" />);

    expect(screen.getByRole("heading", { name: "淡江禪學社期初招生影片" })).toBeInTheDocument();
    expect(screen.getByText(/唯讀檢視/)).toBeInTheDocument();
    expect(screen.getByText("安倢")).toBeInTheDocument();
    expect(screen.getByText("師父開示")).toBeInTheDocument();
    expect(screen.getByText("雨中的傘")).toBeInTheDocument();
  });

  it("整頁沒有任何可寫入的控制項——這是「唯讀」在畫面上的真正定義", () => {
    viewQuery.mockReturnValue({ data: view(), isLoading: false, error: null });
    const { container } = render(<SharedProjectPage token="t" />);

    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("掛上 noindex——分享對象是拿到連結的人，不是搜尋引擎", () => {
    viewQuery.mockReturnValue({ data: view(), isLoading: false, error: null });
    const { unmount } = render(<SharedProjectPage token="t" />);

    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute("content"))
      .toContain("noindex");
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("世界觀只列有值的欄位，空字串不佔版面", () => {
    viewQuery.mockReturnValue({ data: view(), isLoading: false, error: null });
    render(<SharedProjectPage token="t" />);

    expect(screen.getByText("一把紅傘，一段安靜的路")).toBeInTheDocument();
    expect(screen.getByText("溫暖、安靜")).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
  });

  it("連結失效時說明原因並指路，不是一片空白", () => {
    viewQuery.mockReturnValue({ data: undefined, isLoading: false, error: { message: "這個分享連結已被建立者收回" } });
    render(<SharedProjectPage token="t" />);

    expect(screen.getByRole("alert")).toHaveTextContent("這個分享連結已被建立者收回");
    expect(screen.getByText(/請向分享給你的人索取新連結/)).toBeInTheDocument();
  });

  it("定期重抓：素材簽名網址會過期，撤銷也要在一輪內生效", () => {
    viewQuery.mockReturnValue({ data: view(), isLoading: false, error: null });
    render(<SharedProjectPage token="t" />);

    const [input, options] = viewQuery.mock.calls[0] as [{ token: string }, { refetchInterval: number }];
    expect(input).toEqual({ token: "t" });
    expect(options.refetchInterval).toBeGreaterThan(0);
    expect(options.refetchInterval).toBeLessThan(3600_000); // 必須短於後端 1 小時的簽名效期
  });
});
