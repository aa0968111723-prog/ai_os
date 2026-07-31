/**
 * 「我的回報」要看得到自己附上的截圖（FB-MINE-SHOT）。
 *
 * 回報者送出時特地標了框、附了圖,點進「查看我的回報」卻只剩文字——會直接以為
 * 截圖沒送成功而重送一次。後端 /api/feedback/:id/shot 一直都允許作者本人讀取,
 * 缺的只是「這筆有沒有圖」的訊號與前端的渲染,這裡把兩端都釘住。
 */
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** 泛用 trpc 樁（比照 MembersPage.commandLevel.test）：只餵查詢結果，不打網路 */
const h = vi.hoisted(() => {
  const bag: { root: Record<string, unknown>; queryData: Map<string, unknown> } = {
    root: {},
    queryData: new Map(),
  };
  let root: Record<string, unknown>;
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => ({ data: bag.queryData.get(path), isLoading: false, isError: false, error: null }),
      useUtils: () => root,
      invalidate: () => {},
    };
    const cache = new Map<string, Record<string, unknown>>();
    return new Proxy(base, {
      get(target, prop) {
        if (typeof prop !== "string") return Reflect.get(target, prop);
        if (Object.prototype.hasOwnProperty.call(target, prop)) return target[prop];
        if (prop === "then" || prop === "toJSON" || prop in Object.prototype) return undefined;
        if (!cache.has(prop)) cache.set(prop, makeNode(path ? `${path}.${prop}` : prop));
        return cache.get(prop);
      },
    }) as Record<string, unknown>;
  };
  root = makeNode("");
  bag.root = root;
  return bag;
});

vi.mock("../api", () => ({ trpc: h.root }));
vi.mock("wouter", () => ({
  Link: ({ children }: { children?: React.ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("../components/Icon", () => ({ Icon: () => null }));

import { MyReportsPage } from "./MyReportsPage";

const ID = "33333333-3333-4333-8333-333333333333";

/** 一筆「我的回報」；hasScreenshot 由各案例覆寫 */
function seedOne(over: Record<string, unknown> = {}) {
  h.queryData.set("feedbackReports.mine", [
    {
      id: ID,
      category: "bug",
      pages: ["專案頁"],
      targetLabel: "生成按鈕",
      note: "按了沒反應",
      status: "open",
      agentReviewedAt: null,
      agentSeverity: null,
      agentReply: null,
      emailStatus: null,
      createdAt: "2026-07-30T02:00:00.000Z",
      ...over,
    },
  ]);
}

beforeEach(() => {
  h.queryData.clear();
});

describe("附了截圖的回報", () => {
  it("畫出截圖,而且是走 /api/feedback/:id/shot（不靠也拿不到儲存路徑）", () => {
    seedOne({ hasScreenshot: true });
    render(<MyReportsPage />);
    const img = screen.getByRole("img", { name: /截圖/ });
    expect(img).toHaveAttribute("src", `/api/feedback/${ID}/shot`);
  });

  it("縮圖可以點開看原圖——標記框的細節在縮圖上根本看不清楚", () => {
    seedOne({ hasScreenshot: true });
    render(<MyReportsPage />);
    const link = screen.getByRole("img", { name: /截圖/ }).closest("a");
    expect(link).toHaveAttribute("href", `/api/feedback/${ID}/shot`);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("圖讀不到時給一句說明,不留破圖——破圖會讓人以為當初沒附成功而重送一次", () => {
    seedOne({ hasScreenshot: true });
    render(<MyReportsPage />);
    fireEvent.error(screen.getByRole("img", { name: /截圖/ }));
    expect(screen.queryByRole("img", { name: /截圖/ })).toBeNull();
    expect(screen.getByText(/截圖已經讀不到/)).toBeTruthy();
    // 回報內容本身不能跟著消失
    expect(screen.getByText("按了沒反應")).toBeTruthy();
  });
});

describe("沒附截圖的回報", () => {
  it("不畫圖,也不去打 shot 端點（那只會拿到 404）", () => {
    seedOne({ hasScreenshot: false });
    render(<MyReportsPage />);
    expect(screen.queryByRole("img", { name: /截圖/ })).toBeNull();
    expect(document.querySelector(`a[href="/api/feedback/${ID}/shot"]`)).toBeNull();
  });

  it("後端還沒帶 hasScreenshot 時（舊快取）當作沒有,不畫出必定破的圖", () => {
    seedOne();
    render(<MyReportsPage />);
    expect(screen.queryByRole("img", { name: /截圖/ })).toBeNull();
  });
});
