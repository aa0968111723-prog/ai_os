/**
 * 建立新專案表單：畫面尺寸挑選 ＋ 選項就地新增。
 *
 * 兩件事在這裡被釘住：
 * 1. 尺寸給的是「模型支援的全部比例」且畫成比例圖，挑了就真的帶進 projects.create
 *    （原本尺寸只能靠平台間接決定，且只有三種）。
 * 2. 缺選項時可以在表單裡直接加，不必繞去選單的「選項」頁——那一頁已從選單移除。
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type React from "react";
import { PROJECT_FORMATS } from "@shared/models";
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

function seed(opts: { role?: "leader" | "member"; options?: unknown[] } = {}) {
  h.queryData.clear();
  h.mutations.length = 0;
  h.queryData.set("auth.me", {
    user: { id: "u1", name: "阿光" },
    groups: [{ groupId: GROUP, role: opts.role ?? "leader", teamName: "弘法團", groupName: "影音組" }],
  });
  h.queryData.set("projects.list", [{ id: "p1", title: "既有專案", kind: "short", format: "16:9", ownerId: "u1", status: "active", updatedAt: new Date().toISOString(), coverAssetId: null, coverUrl: null, myProjectRole: "editor" }]);
  h.queryData.set("options.byGroup", opts.options ?? [
    { id: "o1", type: "kind", value: "witness", label: "見證故事", format: null, sortOrder: 0, active: true },
    { id: "o2", type: "platform", value: "youtube", label: "YouTube(橫式)", format: "16:9", sortOrder: 0, active: true },
  ]);
  h.queryData.set("approvals.pendingSummary", { projects: [], totalPendingApprovals: 0, totalAwaitingGenerations: 0 });
  h.queryData.set("teamAssistant.agentOverview", {
    runs: [], totalRuns: 0, listLimit: 30,
    summary: { running: 0, waiting: 0, awaitingApproval: 0, failedRecent: 0, doneRecent: 0, stoppedRecent: 0, active: 0, activeProjects: 0, hasRuns: false, health: "idle" },
  });
}

async function openCreateForm() {
  const view = render(<Launchpad groupId={GROUP} />);
  // 頁面上有多顆「建立新專案」（招呼列與空狀態）；固定用招呼列那顆開表單
  const trigger = view.container.querySelector(".daily-new-project") as HTMLButtonElement;
  await userEvent.click(trigger);
}

describe("建立新專案：畫面尺寸", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    sessionStorage.clear();
  });

  it("尺寸選單列出模型支援的全部比例，預設跟著平台走", async () => {
    seed();
    await openCreateForm();
    expect(screen.getAllByRole("radio").length).toBe(PROJECT_FORMATS.length);
    expect(screen.getByRole("radio", { name: /16:9/ }).getAttribute("aria-checked")).toBe("true");
  });

  it("挑了尺寸就帶進 projects.create（不再只能由平台間接決定）", async () => {
    seed();
    await openCreateForm();
    await userEvent.type(screen.getByLabelText("新專案名稱"), "走出低谷");
    await userEvent.click(screen.getByRole("radio", { name: /^2:3/ }));
    await userEvent.click(screen.getByRole("button", { name: "立即建立專案" }));

    const call = h.mutations.find((m) => m.path === "projects.create");
    expect(call?.input).toMatchObject({ groupId: GROUP, title: "走出低谷", platform: "youtube", format: "2:3" });
  });
});

describe("建立新專案：選項就地新增", () => {
  beforeEach(() => {
    h.queryData.clear();
    h.mutations.length = 0;
    sessionStorage.clear();
  });

  it("組長可以在表單裡直接加內容類型與發布平台", async () => {
    seed({ role: "leader" });
    await openCreateForm();
    await userEvent.click(screen.getByRole("button", { name: /自己加一個類型/ }));
    await userEvent.type(screen.getByLabelText("新增內容類型名稱"), "法會紀實");
    await userEvent.click(screen.getByRole("button", { name: "加入" }));

    expect(h.mutations.find((m) => m.path === "options.upsert")?.input).toMatchObject({
      groupId: GROUP,
      type: "kind",
      label: "法會紀實",
    });
  });

  it("新增平台時要挑畫面尺寸，且一併送出", async () => {
    seed({ role: "leader" });
    await openCreateForm();
    await userEvent.click(screen.getByRole("button", { name: /自己加一個平台/ }));
    await userEvent.type(screen.getByLabelText("新增發布平台名稱"), "IG 直式");
    // 表單本身也有一組尺寸圖；這裡要點的是新增面板自己那一組
    const panel = screen.getByText("這個平台的畫面尺寸").parentElement as HTMLElement;
    await userEvent.click(within(panel).getByRole("radio", { name: /^9:16/ }));
    await userEvent.click(screen.getByRole("button", { name: "加入" }));

    expect(h.mutations.find((m) => m.path === "options.upsert")?.input).toMatchObject({
      type: "platform",
      label: "IG 直式",
      format: "9:16",
    });
  });

  it("一般組員看不到就地新增（後端也限組長以上）", async () => {
    seed({ role: "member" });
    await openCreateForm();
    expect(screen.queryByRole("button", { name: /自己加一個/ })).toBeNull();
  });

  it("這個組還沒有選項時，指到表單裡的新增鈕，而不是別的頁面", async () => {
    seed({ role: "leader", options: [] });
    await openCreateForm();
    expect(screen.getByRole("button", { name: /自己加一個類型/ })).toBeTruthy();
    expect(screen.getByText(/這個組還沒有內容類型選項/).textContent).toContain("自己加一個類型");
    expect(screen.queryByText(/選項」頁/)).toBeNull();
  });
});
