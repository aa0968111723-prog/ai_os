/**
 * 使用者旅程：從專案進「管理全部資料表」後，應看到回專案與關聯勾選。
 * （Z1 深鏈閉環）
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabasesPage } from "./DatabasesPage";

const listQuery = vi.fn();
const meQuery = vi.fn();
const projectGet = vi.fn();
const createMutate = vi.fn();
const addRowMutate = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      databases: { list: { invalidate: vi.fn() } },
      dataHub: { list: { invalidate: vi.fn() }, summary: { invalidate: vi.fn() } },
    }),
    databases: {
      list: { useQuery: () => listQuery() },
      create: {
        useMutation: (opts?: { onSuccess?: (r: { id: string }) => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            createMutate(input);
            void opts?.onSuccess?.({ id: "new-table-1" });
          },
          mutateAsync: async (input: unknown) => {
            createMutate(input);
            const row = { id: "new-table-1" };
            await opts?.onSuccess?.(row);
            return row;
          },
        }),
      },
      addRow: {
        useMutation: () => ({
          isPending: false,
          mutateAsync: async (input: unknown) => {
            addRowMutate(input);
            return { id: "row-1" };
          },
        }),
      },
      importData: { useMutation: () => ({ isPending: false, mutateAsync: vi.fn() }) },
    },
    auth: {
      me: {
        useQuery: () => meQuery(),
      },
    },
    projects: {
      get: {
        useQuery: (...args: unknown[]) => projectGet(...args),
      },
    },
  },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../components/Icon", () => ({
  Icon: () => null,
}));

vi.mock("../components/interactions", () => ({
  ConfirmButton: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    <button type="button" {...props}>{children}</button>
  ),
}));

vi.mock("../components/DatabaseDetailTabs", () => ({
  DatabaseDetailTabs: () => null,
}));

// 資料中心總覽與「＋加入資料」各有自己的測試；這支測的是深鏈與建表表單
vi.mock("../components/DataHubOverview", () => ({
  DataHubOverview: () => null,
}));
vi.mock("../components/AddDataSheet", () => ({
  AddDataSheet: () => null,
  pendingAddDataMethod: () => null,
}));

// 全組 presence／游標走真的 WebSocket＋react-query client，這支測的是深鏈與建庫表單，
// 不架 QueryClientProvider；比照 ../api 直接把 realtime 也換成靜態替身。
vi.mock("../realtime", () => ({
  useCollab: () => ({
    connected: false,
    peers: [],
    self: null,
    cursors: [],
    containerRef: { current: null },
    onPointerMove: () => {},
  }),
  CursorOverlay: () => null,
}));

describe("DatabasesPage project deep link (user journey)", () => {
  beforeEach(() => {
    listQuery.mockReset();
    meQuery.mockReset();
    projectGet.mockReset();
    createMutate.mockReset();
    addRowMutate.mockReset();
    listQuery.mockReturnValue({ data: [], isLoading: false, error: null });
    meQuery.mockReturnValue({
      data: {
        user: { id: "u1", isSuperAdmin: false },
        groups: [{ groupId: "g1", groupName: "剪輯組", teamId: "t1", teamName: "北區", role: "member" }],
      },
    });
    projectGet.mockReturnValue({
      data: { id: "11111111-1111-4111-8111-111111111111", title: "社群週更專案" },
      isLoading: false,
    });
    window.history.pushState(
      {},
      "",
      "/databases?projectId=11111111-1111-4111-8111-111111111111&from=project",
    );
  });

  it("shows back-to-project breadcrumb with project title", async () => {
    render(<DatabasesPage groupId="g1" />);
    await waitFor(() => {
      expect(screen.getByTestId("db-project-context")).toBeInTheDocument();
    });
    expect(screen.getByText(/回專案「社群週更專案」/i)).toBeInTheDocument();
    const backs = screen.getAllByRole("link", { name: /回專案/i });
    expect(backs.length).toBeGreaterThanOrEqual(1);
    expect(backs[0].getAttribute("href")).toContain("/p/11111111-1111-4111-8111-111111111111");
    expect(backs[0].getAttribute("href")).toContain("#sec-databases");
  });

  it("create form defaults to group scope and offers link-to-project checkbox", async () => {
    render(<DatabasesPage groupId="g1" />);
    const createBtn = screen.getByRole("button", { name: /建立資料表/i });
    createBtn.click();
    await waitFor(() => {
      expect(screen.getByTestId("db-link-project")).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/關聯此專案/i)).toBeChecked();
    const scope = screen.getByLabelText("範圍") as HTMLSelectElement;
    expect(scope.value).toBe("group");
  });
});
