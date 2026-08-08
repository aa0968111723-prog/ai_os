import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataHubOverview } from "./DataHubOverview";

/**
 * 資料中心總覽的產品契約：
 * 一份跨 domain 的清單，對使用者只講「這是什麼／屬於哪裡／AI 可不可以用」，
 * 不露出 UUID 或 table/row/embedding 這些底層詞；空狀態不顯示一排 0。
 */

const { state } = vi.hoisted(() => ({
  state: {
    listArgs: [] as unknown[],
    list: {
      resources: [] as unknown[],
      counts: { total: 0, aiUsable: 0, byKind: { knowledge: 0, table: 0, document: 0, asset: 0 } },
      truncated: false,
    },
    sources: [
      { id: "google-drive", label: "Google 雲端", configured: true, connected: true, status: "active", detail: "me@gmail.com", count: 1 },
      { id: "notion", label: "Notion", configured: true, connected: true, status: "error", detail: "團隊", count: 1 },
      { id: "api", label: "外部 API", configured: true, connected: false, status: null, detail: null, count: 0 },
    ],
  },
}));

vi.mock("../api", () => ({
  trpc: {
    dataHub: {
      list: {
        useQuery: (args: unknown) => {
          state.listArgs.push(args);
          return { data: state.list, isLoading: false, error: null, refetch: () => {} };
        },
      },
      sources: { useQuery: () => ({ data: state.sources, isLoading: false, error: null }) },
    },
  },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function resource(over: Record<string, unknown> = {}) {
  return {
    id: "knowledge:k1",
    kind: "knowledge",
    rawId: "k1",
    title: "影片腳本",
    scope: "project",
    source: "google-drive",
    projectId: "p1",
    projectTitle: "AI OS",
    groupId: "g1",
    ai: { access: "readable", reason: "專案 AI 會自動讀取這份文字資料" },
    status: "ready",
    statusLabel: "AI 可以使用",
    updatedAt: new Date().toISOString(),
    href: "/p/p1#sec-knowledge",
    sizeLabel: "1,200 字",
    syncedLabel: null,
    sourceHasUpdate: false,
    ...over,
  };
}

describe("DataHubOverview", () => {
  beforeEach(() => {
    state.listArgs = [];
    state.list = {
      resources: [],
      counts: { total: 0, aiUsable: 0, byKind: { knowledge: 0, table: 0, document: 0, asset: 0 } },
      truncated: false,
    };
  });

  it("★ 空狀態講人話，不顯示 0 資料庫 / 0 資料列 / 0 AI 可用", () => {
    render(<DataHubOverview onAddData={() => {}} />);
    // 標題與摘要都說「還沒有資料」——這是刻意的：兩處都不應退化成 0 KPI
    expect(screen.getAllByText("還沒有資料").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("status")).toHaveTextContent("還沒有資料");
    expect(screen.getByRole("button", { name: /加入第一份資料/ })).toBeInTheDocument();
    expect(screen.queryByText(/0 資料庫/)).toBeNull();
    expect(screen.queryByText(/資料列/)).toBeNull();
  });

  it("空狀態的 CTA 直接開「加入資料」", async () => {
    const onAddData = vi.fn();
    const user = userEvent.setup();
    render(<DataHubOverview onAddData={onAddData} />);
    await user.click(screen.getByRole("button", { name: /加入第一份資料/ }));
    expect(onAddData).toHaveBeenCalled();
  });

  it("每一列只講：名稱、類型、所屬專案、來源、AI 狀態——不露出 UUID", () => {
    state.list = {
      resources: [resource()],
      counts: { total: 1, aiUsable: 1, byKind: { knowledge: 1, table: 0, document: 0, asset: 0 } },
      truncated: false,
    };
    render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByText("影片腳本")).toBeInTheDocument();
    expect(screen.getByText(/文字資料・AI OS・Google 雲端・1,200 字/)).toBeInTheDocument();
    expect(screen.getByText("AI 只能讀取")).toBeInTheDocument();
    expect(screen.queryByText(/knowledge:k1/)).toBeNull();
    expect(screen.queryByText("k1")).toBeNull();
  });

  it("摘要用人話而不是 KPI 磚牆", () => {
    state.list = {
      resources: [resource(), resource({ id: "table:t1", kind: "table", rawId: "t1", ai: { access: "none", reason: "x" } })],
      counts: { total: 2, aiUsable: 1, byKind: { knowledge: 1, table: 1, document: 0, asset: 0 } },
      truncated: false,
    };
    render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("2 份資料・1 份 AI 可以使用");
  });

  it("★ 截斷要說出來，不能讓使用者以為「就這些了」", () => {
    state.list = {
      resources: [resource()],
      counts: { total: 1, aiUsable: 1, byKind: { knowledge: 1, table: 0, document: 0, asset: 0 } },
      truncated: true,
    };
    render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByText(/還有更多資料沒列出來/)).toBeInTheDocument();
  });

  it("★ 專案上下文：查詢就帶著 projectId，不是抓全站再前端過濾", () => {
    render(<DataHubOverview projectId="p1" projectTitle="AI OS" onAddData={() => {}} />);
    expect(state.listArgs[0]).toMatchObject({ projectId: "p1" });
    expect(screen.getByPlaceholderText(/搜尋「AI OS」的資料/)).toBeInTheDocument();
  });

  it("類型篩選把 kinds 傳給後端", async () => {
    const user = userEvent.setup();
    render(<DataHubOverview onAddData={() => {}} />);
    await user.click(screen.getByRole("button", { name: "資料表" }));
    await waitFor(() => {
      expect(state.listArgs.at(-1)).toMatchObject({ kinds: ["table"] });
    });
  });

  it("搜尋去抖：停手之後才送出關鍵字", async () => {
    const user = userEvent.setup();
    render(<DataHubOverview onAddData={() => {}} />);
    await user.type(screen.getByRole("searchbox"), "腳本");
    expect(state.listArgs.every((a) => (a as { q?: string }).q === undefined)).toBe(true);
    await waitFor(
      () => expect(state.listArgs.at(-1)).toMatchObject({ q: "腳本" }),
      { timeout: 2000 },
    );
  });

  it("★ 來源區只講「能不能去挑」，且明說中斷不會刪掉已加入的資料", () => {
    render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByText(/已連接・me@gmail.com/)).toBeInTheDocument();
    expect(screen.getByText(/需要重新連接・團隊/)).toBeInTheDocument();
    expect(screen.getByText(/尚未連接/)).toBeInTheDocument();
    expect(screen.getByText(/AI 只讀得到你選中並加入站內的內容/)).toBeInTheDocument();
    expect(screen.getByText(/中斷連接不會刪掉已經加入的資料/)).toBeInTheDocument();
  });

  it("來源管理是進階區：預設收合，不跟「加入資料」搶首屏", () => {
    const { container } = render(<DataHubOverview onAddData={() => {}} />);
    const details = container.querySelector("details.hub-sources");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");
  });

  /* ── 來源譜系（P6）：只講記錄得到的事，其餘留白 ── */

  it("有讀取時刻就顯示「幾分鐘前讀取」——措辭不是「同步」", () => {
    state.list = {
      resources: [resource({ syncedLabel: "5 分鐘前讀取" })],
      counts: { total: 1, aiUsable: 1, byKind: { knowledge: 1, table: 0, document: 0, asset: 0 } },
      truncated: false,
    };
    render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByText(/5 分鐘前讀取/)).toBeInTheDocument();
  });

  it("★ 沒有來源記錄時完全不提同步／讀取——留白而不是編一個時間", () => {
    state.list = {
      resources: [resource({ source: "manual", syncedLabel: null })],
      counts: { total: 1, aiUsable: 1, byKind: { knowledge: 1, table: 0, document: 0, asset: 0 } },
      truncated: false,
    };
    const { container } = render(<DataHubOverview onAddData={() => {}} />);
    // 只看那一行中繼資料（AI 權限徽章本來就叫「AI 只能讀取」，不能拿它當反例）
    const meta = container.querySelector(".hub-item__copy small")!;
    expect(meta.textContent).not.toMatch(/讀取/);
    expect(meta.textContent).not.toMatch(/同步/);
  });

  it("★ 來源有更新才標記；判斷不出來時不得出現這個標記", () => {
    state.list = {
      resources: [resource({ sourceHasUpdate: true })],
      counts: { total: 1, aiUsable: 1, byKind: { knowledge: 1, table: 0, document: 0, asset: 0 } },
      truncated: false,
    };
    const { rerender } = render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByText("來源有更新")).toBeInTheDocument();

    state.list = {
      resources: [resource({ sourceHasUpdate: false })],
      counts: { total: 1, aiUsable: 1, byKind: { knowledge: 1, table: 0, document: 0, asset: 0 } },
      truncated: false,
    };
    rerender(<DataHubOverview onAddData={() => {}} />);
    expect(screen.queryByText("來源有更新")).toBeNull();
  });
});
