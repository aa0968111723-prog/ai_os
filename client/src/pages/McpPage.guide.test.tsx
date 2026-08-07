/**
 * 「接上外部 AI」要讓沒接過的人看得懂怎麼開始（回饋：大家有時候不知道怎麼用）。
 *
 * 先前唯一的客戶端設定範例只在「剛建立金鑰」那一刻出現，頁面關掉就找不回教學；
 * 頁上也沒有從零開始的步驟。這裡釘住三件事：三步驟總覽、常駐的客戶端接法
 * （含錨點可跳轉）、以及接上後可照抄的範例句。
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/** 泛用 trpc 樁（比照 MyReportsPage.test）：查詢回空清單、mutation 不打網路 */
const h = vi.hoisted(() => {
  const bag: { root: Record<string, unknown>; queryData: Map<string, unknown> } = {
    root: {},
    queryData: new Map(),
  };
  let root: Record<string, unknown>;
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => ({ data: bag.queryData.get(path) ?? [], isLoading: false, isError: false, error: null }),
      useMutation: () => ({ mutate: () => {}, isPending: false, error: null }),
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

import { McpPage } from "./McpPage";

describe("三步驟上手", () => {
  it("一進頁就看得到三步驟總覽，且步驟裡的錨點真的指到頁上的區塊", () => {
    render(<McpPage />);
    expect(screen.getByText("怎麼開始？三步驟")).toBeTruthy();
    // 錨點斷了會變成「點了沒反應」，比沒有連結更讓人困惑
    for (const id of ["mcp-clients", "mcp-examples"]) {
      expect(document.querySelector(`a[href="#${id}"]`)).toBeTruthy();
      expect(document.getElementById(id)).toBeTruthy();
    }
  });
});

describe("客戶端接法", () => {
  it("還沒建立金鑰也看得到接法教學與設定範例（帶「你的金鑰」占位）", () => {
    render(<McpPage />);
    expect(screen.getAllByText(/Claude 桌面版/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Claude Code/).length).toBeGreaterThan(0);
    // 設定範例常駐：JSON 與終端機指令都以占位字提示要換成自己的金鑰
    const pre = document.querySelector("pre");
    expect(pre?.textContent).toContain('"x-api-key": "你的金鑰"');
    expect(pre?.textContent).toContain("/api/mcp");
    expect(screen.getByText(/claude mcp add --transport http/)).toBeTruthy();
  });

  it("提醒手機 App 接不了，第②步要在電腦上做——螢幕截圖回饋多來自手機", () => {
    render(<McpPage />);
    expect(screen.getAllByText(/手機的 Claude App/).length).toBeGreaterThan(0);
  });
});

describe("接上後可以這樣說", () => {
  it("列出可照抄的白話範例句，每句都有複製鈕", () => {
    render(<McpPage />);
    expect(screen.getAllByText(/幫我看看我專案現在的狀態/).length).toBeGreaterThan(0);
    const section = document.getElementById("mcp-examples");
    expect(section).toBeTruthy();
    // 範例句要能一鍵複製——手機上長句手動選取很痛苦
    const copies = screen.getAllByRole("button", { name: "複製" });
    expect(copies.length).toBeGreaterThanOrEqual(5);
  });
});
