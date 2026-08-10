/**
 * 作業台專案卡的封面圖（projects.cover_asset_id）。
 *
 * 卡片原本只有「專案名稱首字 ＋ 以 id 雜湊的色塊」，一整排看起來都一樣，
 * 使用者要靠讀標題才分得出哪張是哪個案子。這裡測的是換圖那條路：
 * 綁了圖就顯示圖、沒綁（或素材進了回收桶）退回色塊、「換圖」不會誤觸整張卡的連結，
 * 以及檢視者／已封存專案不該看到這個寫入入口。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { Launchpad } from "./Launchpad";

/** 泛用 trpc 樁：任何 `trpc.a.b.useQuery()` 都回 queryData 裡以路徑登記的值 */
const h = vi.hoisted(() => {
  const bag: {
    queryData: Map<string, unknown>;
    mutations: Array<{ path: string; input: unknown }>;
    root: Record<string, unknown>;
  } = { queryData: new Map(), mutations: [], root: {} };
  let root: Record<string, unknown>;
  const makeNode = (path: string): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      useQuery: () => ({
        data: bag.queryData.get(path),
        isLoading: false,
        isError: false,
        error: null,
        refetch: () => {},
      }),
      useMutation: (opts?: { onSuccess?: (d: unknown) => void }) => ({
        mutate: (input: unknown) => {
          bag.mutations.push({ path, input });
          void opts?.onSuccess?.({});
        },
        mutateAsync: async (input: unknown) => {
          bag.mutations.push({ path, input });
          return {};
        },
        isPending: false,
        error: null,
        data: undefined,
        reset: () => {},
      }),
      invalidate: () => {},
      useUtils: () => root,
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

/** 真的 Link 會導頁；這裡保留 <a href>，才驗得出「按換圖不會觸發連結」 */
vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => ["/", () => {}],
}));

vi.mock("../components/Icon", () => ({ Icon: () => null }));
vi.mock("../components/interactions", () => ({
  ConfirmButton: ({ children, onConfirm, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { onConfirm?: () => void; children?: React.ReactNode }) => (
    <button type="button" onClick={() => void onConfirm?.()} {...props}>{children}</button>
  ),
}));
vi.mock("../components/FirstRunGuide", () => ({ FirstRunGuide: () => null }));
vi.mock("../components/InstallAppBanner", () => ({ InstallAppBanner: () => null }));
vi.mock("../realtime", () => ({
  useCollab: () => ({ connected: false, peers: [], self: null, cursors: [], containerRef: { current: null }, onPointerMove: () => {} }),
  CursorOverlay: () => null,
}));

const GROUP = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";

type ProjectRow = Record<string, unknown>;
const project = (over: ProjectRow = {}): ProjectRow => ({
  id: "p1",
  title: "挑戰營回顧影片",
  kind: "short",
  format: "16:9",
  ownerId: "u1",
  status: "active",
  updatedAt: new Date().toISOString(),
  coverAssetId: null,
  coverUrl: null,
  myProjectRole: "editor",
  ...over,
});

function seed(projects: ProjectRow[]) {
  h.queryData.clear();
  h.mutations.length = 0;
  h.queryData.set("auth.me", { user: { id: "u1", name: "阿光" }, groups: [{ groupId: GROUP, role: "leader" }] });
  h.queryData.set("projects.list", projects);
  h.queryData.set("options.byGroup", []);
  h.queryData.set("generation.pendingSummary", { projects: [], totalAwaitingGenerations: 0 });
  h.queryData.set("teamAssistant.agentOverview", {
    runs: [], totalRuns: 0, listLimit: 30,
    summary: {
      running: 0, waiting: 0, awaitingApproval: 0, failedRecent: 0, doneRecent: 0,
      stoppedRecent: 0, active: 0, activeProjects: 0, hasRuns: false, health: "idle",
    },
  });
}

describe("作業台專案卡：封面圖", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
  });

  it("綁了封面圖就顯示圖，不再顯示名稱首字色塊", () => {
    seed([project({ coverAssetId: ASSET, coverUrl: "https://cdn.test/cover.png" })]);
    render(<Launchpad groupId={GROUP} />);
    const img = screen.getByAltText("挑戰營回顧影片 的封面圖");
    expect(img).toHaveAttribute("src", "https://cdn.test/cover.png");
    expect(document.querySelector(".launch-mono")).toBeNull();
  });

  it("沒綁封面圖（或素材進了回收桶→coverUrl 為 null）退回名稱首字色塊", () => {
    // coverAssetId 還在但 coverUrl 為 null＝素材被丟進回收桶；卡片要能自己撐住，不是破圖
    seed([project({ coverAssetId: ASSET, coverUrl: null })]);
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByAltText("挑戰營回顧影片 的封面圖")).toBeNull();
    expect(document.querySelector(".launch-mono")?.textContent).toBe("挑");
  });

  it("按「換圖」開對話框；換圖按鈕與卡片連結解耦（不再嵌進 <a>，WCAG 4.1.2）", async () => {
    const user = userEvent.setup();
    seed([project()]);
    render(<Launchpad groupId={GROUP} />);
    // 沒有封面時文案是「加圖」（要人先放一張），有封面才叫「換圖」
    const swap = screen.getByTitle("換一張封面圖");
    expect(swap).toHaveTextContent("加圖");

    // 修復：換圖是卡內獨立按鈕，不再包在卡片 <a> 裡（巢狀互動元素是無障礙缺陷）。
    // 卡片本體仍是通往專案的覆蓋連結——那支 <a> 還在、只是不再包住按鈕，click 不導頁由結構保證。
    expect(swap.closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "開啟專案 挑戰營回顧影片" })).toHaveAttribute("href", "/p/p1");

    await user.click(swap);
    const dialog = screen.getByRole("dialog", { name: "更換「挑戰營回顧影片」的封面圖" });
    expect(within(dialog).getByText(/自動配色封面/)).toBeInTheDocument();
  });

  it("在對話框裡從素材庫選一張＝送出 projects.setCover", async () => {
    const user = userEvent.setup();
    seed([project()]);
    h.queryData.set("projects.assets", [
      { id: ASSET, kind: "image", url: "https://cdn.test/a.png", title: "禪堂晨光" },
    ]);
    render(<Launchpad groupId={GROUP} />);
    await user.click(screen.getByTitle("換一張封面圖"));
    const dialog = screen.getByRole("dialog", { name: "更換「挑戰營回顧影片」的封面圖" });
    await user.click(within(dialog).getByRole("button", { name: "從素材庫選" }));
    await user.click(within(dialog).getByRole("option", { name: "禪堂晨光" }));
    expect(h.mutations).toEqual([{ path: "projects.setCover", input: { id: "p1", assetId: ASSET } }]);
  });

  it("已綁圖時對話框的「移除」把封面清成 null（退回色塊）", async () => {
    const user = userEvent.setup();
    seed([project({ coverAssetId: ASSET, coverUrl: "https://cdn.test/cover.png" })]);
    render(<Launchpad groupId={GROUP} />);
    await user.click(screen.getByTitle("換一張封面圖"));
    const dialog = screen.getByRole("dialog", { name: "更換「挑戰營回顧影片」的封面圖" });
    await user.click(within(dialog).getByRole("button", { name: "移除" }));
    expect(h.mutations).toEqual([{ path: "projects.setCover", input: { id: "p1", assetId: null } }]);
  });

  it("檢視者看不到「換圖」——後端也會擋，這裡是不讓人按了才失敗", () => {
    seed([project({ myProjectRole: "viewer" })]);
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByTitle("換一張封面圖")).toBeNull();
  });

  it("已封存的專案不給換封面（要先還原）", () => {
    seed([project({ status: "archived" })]);
    render(<Launchpad groupId={GROUP} />);
    expect(screen.queryByTitle("換一張封面圖")).toBeNull();
  });
});
