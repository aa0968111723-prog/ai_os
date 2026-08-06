/**
 * 迴歸測試：專案頁必須撐過「載入中 → 載入完成」的轉換。
 *
 * 這正是把專案頁打掛的那條路徑。原本 ProjectPage 在
 * `if (project.isLoading) return …` 之後還留了一個 useEffect：
 * 載入那次 render 少跑一個 hook，資料回來後多跑一個，React 丟
 * #310 (Rendered more hooks than during the previous render)，整頁進 ErrorBoundary。
 *
 * 上一輪的 smoke test 沒抓到，是因為它一開始就 mock 成 isLoading: false，
 * 元件從來沒經歷過那個轉換。所以這支測試的重點不是「能不能 render」，
 * 而是「有沒有真的走過 loading → loaded」。
 */
import { useState } from "react";
import { render, screen, act } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const project = {
  id: "p-1",
  title: "測試專案",
  groupId: "g-1",
  ownerId: "u-1",
  myProjectRole: "editor",
  kind: "video",
  format: "short",
  platform: "youtube",
  target: "",
  status: "active",
  archivedAt: null,
  worldview: { logline: "一位訪客在晨光禪堂點香", message: "", audience: "", themes: [], tones: ["溫暖"], acts: { hook: "", turn: "", cta: "" }, people: [], styles: ["日系水彩"], references: [], taboos: [] },
};
const me = { user: { id: "u-1", name: "我", email: "a@b.c" }, groups: [{ groupId: "g-1", role: "leader", name: "組" }] };

/** 由測試控制的載入狀態：先 loading，之後翻成 loaded，逼元件走過那次轉換 */
let loading = true;

const q = (data: unknown) => ({ data, isLoading: false, error: null, refetch: vi.fn(), fetchNextPage: vi.fn(), hasNextPage: false, isFetchingNextPage: false });
const m = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isSuccess: false, error: null, reset: vi.fn() });

vi.mock("../api", () => {
  const target: Record<string, unknown> = {
    auth: { me: { useQuery: () => q(me) } },
    projects: {
      // 專案本身是唯一會經歷 loading 的查詢
      get: { useQuery: () => (loading ? { data: undefined, isLoading: true, error: null } : q(project)) },
      assets: { useQuery: () => q([]) },
      setArchived: { useMutation: m },
      updateWorldview: { useMutation: m },
    },
    options: { byGroup: { useQuery: () => q([]) }, upsert: { useMutation: m } },
    messages: { unread: { useQuery: () => q(0) } },
    useUtils: () => new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn() }) }),
  };
  const stub = (): unknown =>
    new Proxy(
      { useQuery: () => q([]), useInfiniteQuery: () => q({ pages: [] }), useMutation: m },
      { get: (t: Record<string, unknown>, k: string) => (k in t ? t[k] : stub()) },
    );
  const wrap = (obj: Record<string, unknown>): unknown =>
    new Proxy(obj, {
      get(t, k: string) {
        if (!(k in t)) return stub();
        const v = t[k as keyof typeof t];
        return v && typeof v === "object" ? wrap(v as Record<string, unknown>) : v;
      },
    });
  return { trpc: wrap(target) };
});

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return { ...actual, Link: ({ children }: { children?: unknown }) => children, useLocation: () => ["/p/p-1", vi.fn()] };
});

let caught: Error | null = null;
beforeEach(() => {
  loading = true;
  caught = null;
  vi.spyOn(console, "error").mockImplementation((...args) => {
    const first = args[0];
    if (first instanceof Error) caught = first;
  });
});
afterEach(() => vi.restoreAllMocks());

/** 每次 render 都重新讀 `loading`，模擬 react-query 從 loading 翻成 loaded */
function Harness({ Page }: { Page: React.ComponentType<{ id: string }> }) {
  const [, force] = useState(0);
  (Harness as unknown as { force?: () => void }).force = () => force((n) => n + 1);
  return <Page id="p-1" />;
}

describe("ProjectPage hook order (React #310 迴歸)", () => {
  it("survives the loading → loaded transition", async () => {
    const { ProjectPage } = await import("./ProjectPage");
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const client = new QueryClient();

    render(
      <QueryClientProvider client={client}>
        <Harness Page={ProjectPage} />
      </QueryClientProvider>,
    );
    // 第一次 render：載入中
    expect(screen.getByText("載入中…")).toBeTruthy();

    // 資料回來 → 重新 render。hook 數量若改變，React 會在這裡丟 #310。
    loading = false;
    act(() => { (Harness as unknown as { force: () => void }).force(); });

    expect(caught, `render 期間丟出例外：${caught?.message}`).toBeNull();
    expect(screen.queryByText("載入中…")).toBeNull();
    expect(screen.getByText("測試專案")).toBeTruthy();
  }, 15000);
});
