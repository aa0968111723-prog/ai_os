/**
 * 使用者旅程：3,000 列的表要能翻到第 201 列以後，並用單欄篩選縮小範圍。
 *
 * 為什麼用「假伺服器」而不是固定回傳：分頁的痛點正是 offset／total／範圍文字三者要一致，
 * 只回死資料的替身會讓「換條件沒回第一頁」「範圍算錯」這類 bug 全部漏掉。
 * 這裡的替身照著 databases.listRows 的契約（q + filter + limit/offset → rows/total）算，
 * 斷言才真的在驗前端送出的查詢與畫面上的數字對得起來。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabasesPage } from "./DatabasesPage";

/**
 * 每個案例都真的把一整頁（200 列）渲染出來——這是刻意的：分頁的價值就在
 * 「第 201 列之後不再被永久截掉」，用小資料集測等於沒測到那件事。
 * 代價是單案例 5–9 秒，在完整套件並行時會超過 vitest 預設的 5 秒而誤報失敗
 *（實測：單獨跑 10/10 過、全套跑 7/10 超時）。這裡放寬到 20 秒，
 * 不是因為測試不穩，是因為它的工作量本來就大。
 */
vi.setConfig({ testTimeout: 20000 });

const TABLE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAGE_SIZE = 200;

type ListRowsInput = {
  tableId: string;
  q?: string;
  limit?: number;
  offset?: number;
  filter?: { key: string; value: string; mode: "contains" | "equals" };
};

/** 3,000 列：縣市刻意做出「台東 300 列」的小集合，才測得到「最後一頁」的邊界 */
const ALL_ROWS = Array.from({ length: 3000 }, (_, i) => ({
  id: `row-${i}`,
  data: { name: `成員 ${i + 1}`, city: i % 10 === 0 ? "台東" : i % 3 === 0 ? "花蓮" : "台北" },
  createdBy: "u1",
  creatorName: "小美",
  updatedAt: new Date("2026-01-01T00:00:00Z"),
}));

const listRowsCalls: ListRowsInput[] = [];
const lastListRows = () => listRowsCalls[listRowsCalls.length - 1];

/** 照 server/routers/databases.ts listRows 的語意過濾＋切頁 */
function fakeListRows(input: ListRowsInput) {
  listRowsCalls.push(input);
  let rows = ALL_ROWS;
  const q = input.q?.trim();
  if (q) rows = rows.filter((r) => JSON.stringify(r.data).includes(q));
  if (input.filter) {
    const { key, value, mode } = input.filter;
    rows = rows.filter((r) => {
      const cell = String((r.data as Record<string, string>)[key] ?? "");
      return mode === "equals" ? cell === value : cell.includes(value);
    });
  }
  const offset = input.offset ?? 0;
  const limit = input.limit ?? PAGE_SIZE;
  return { data: { rows: rows.slice(offset, offset + limit), total: rows.length }, isFetching: false, error: null };
}

// vi.mock 的工廠會被提升到檔首執行，箭頭函式常數在那時還在 TDZ——這兩個必須是函式宣告
function noopMutation() { return { isPending: false, error: null, mutate: vi.fn(), mutateAsync: vi.fn() }; }
function idleQuery() { return { data: undefined, isLoading: false, error: null }; }

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      databases: {
        list: { invalidate: vi.fn() },
        listRows: { invalidate: vi.fn() },
        listFiles: { invalidate: vi.fn() },
        stats: { invalidate: vi.fn() },
        getFileText: { invalidate: vi.fn() },
      },
      quota: { my: { invalidate: vi.fn() } },
    }),
    databases: {
      list: {
        useQuery: () => ({
          data: [{
            id: TABLE_ID,
            scope: "group",
            groupId: "g1",
            teamId: null,
            name: "志工名冊",
            description: null,
            fields: [
              { key: "name", label: "姓名", type: "text", required: true },
              { key: "city", label: "縣市", type: "text" },
            ],
            memberWritable: true,
            agentAccess: "write",
            rowCount: 3000,
            access: { canRead: true, canWriteRows: true, canManage: false },
          }],
          isLoading: false,
          error: null,
        }),
      },
      listRows: { useQuery: (input: ListRowsInput) => fakeListRows(input) },
      listFiles: { useQuery: () => ({ data: { files: [], quota: { usedBytes: 0, quotaBytes: null } }, isLoading: false, error: null }) },
      stats: { useQuery: idleQuery },
      getFileText: { useQuery: idleQuery },
      addRow: { useMutation: noopMutation },
      updateRow: { useMutation: noopMutation },
      removeRow: { useMutation: noopMutation },
      remove: { useMutation: noopMutation },
      update: { useMutation: noopMutation },
      create: { useMutation: noopMutation },
      importData: { useMutation: noopMutation },
      importUrl: { useMutation: noopMutation },
      refreshFile: { useMutation: noopMutation },
      removeFile: { useMutation: noopMutation },
      classifyFile: { useMutation: noopMutation },
      setFileMeta: { useMutation: noopMutation },
      sendFileToProject: { useMutation: noopMutation },
    },
    auth: { me: { useQuery: () => ({ data: { user: { id: "u1", isSuperAdmin: false }, groups: [] } }) } },
    projects: { get: { useQuery: idleQuery }, list: { useQuery: idleQuery } },
    integrations: { list: { useQuery: idleQuery }, fetchApi: { useMutation: noopMutation } },
    schedule: { list: { useQuery: idleQuery } },
  },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../components/Icon", () => ({ Icon: () => null }));
vi.mock("../components/GoogleDrivePicker", () => ({ GoogleDrivePicker: () => null }));
vi.mock("../components/NotionPagePicker", () => ({ NotionPagePicker: () => null }));
vi.mock("../components/DatabaseDetailTabs", () => ({ DatabaseDetailTabs: () => null }));
vi.mock("../components/interactions", () => ({
  ConfirmButton: ({ children, triggerAriaLabel }: { children?: React.ReactNode; triggerAriaLabel?: string }) => (
    <button type="button" aria-label={triggerAriaLabel}>{children}</button>
  ),
}));
vi.mock("../realtime", () => ({
  useCollab: () => ({ connected: false, peers: [], self: null, cursors: [], containerRef: { current: null }, onPointerMove: () => {} }),
  CursorOverlay: () => null,
}));

const range = () => screen.getByTestId("db-row-range").textContent ?? "";
const nextBtn = () => screen.getByRole("button", { name: /下一頁/ });
const prevBtn = () => screen.getByRole("button", { name: /上一頁/ });

async function openTable() {
  render(<DatabasesPage groupId="g1" />);
  await waitFor(() => expect(screen.getByTestId("db-row-range")).toBeInTheDocument());
}

describe("資料表分頁", () => {
  beforeEach(() => {
    listRowsCalls.length = 0;
    window.history.pushState({}, "", `/databases?open=${TABLE_ID}`);
  });

  it("第一頁只取 200 列，且誠實顯示「1–200 列，共 3,000」", async () => {
    await openTable();
    expect(lastListRows()).toMatchObject({ tableId: TABLE_ID, limit: PAGE_SIZE, offset: 0 });
    expect(range()).toContain("1–200 列");
    expect(range()).toContain("3,000");
    // 舊行為的痛點：總數說 3,000 卻永遠只查得到最新 200 列
    expect(nextBtn()).toBeEnabled();
    expect(prevBtn()).toBeDisabled();
  });

  it("下一頁把 offset 往後推一頁，範圍文字跟著走", async () => {
    await openTable();
    fireEvent.click(nextBtn());
    await waitFor(() => expect(range()).toContain("201–400 列"));
    expect(lastListRows()).toMatchObject({ limit: PAGE_SIZE, offset: 200 });
    expect(screen.getByTestId("db-page-indicator").textContent).toContain("第 2 / 15 頁");

    fireEvent.click(nextBtn());
    await waitFor(() => expect(range()).toContain("401–600 列"));
    expect(lastListRows()).toMatchObject({ offset: 400 });

    fireEvent.click(prevBtn());
    await waitFor(() => expect(range()).toContain("201–400 列"));
    expect(lastListRows()).toMatchObject({ offset: 200 });
  });

  it("第 401 列在第三頁真的看得到（不再被伺服器預設上限截掉）", async () => {
    await openTable();
    expect(screen.queryByText("成員 401")).not.toBeInTheDocument();
    fireEvent.click(nextBtn());
    fireEvent.click(nextBtn());
    await waitFor(() => expect(screen.getByText("成員 401")).toBeInTheDocument());
  });

  it("分頁鈕維持 44px 觸控高度（手機是主要裝置）", async () => {
    await openTable();
    expect(nextBtn().style.minHeight).toBe("44px");
    expect(prevBtn().style.minHeight).toBe("44px");
  });
});

describe("資料表單欄篩選", () => {
  beforeEach(() => {
    listRowsCalls.length = 0;
    window.history.pushState({}, "", `/databases?open=${TABLE_ID}`);
  });

  it("只挑欄位還沒輸入值時不送 filter（不該讓畫面先變空）", async () => {
    await openTable();
    fireEvent.change(screen.getByLabelText("篩選欄位"), { target: { value: "city" } });
    await waitFor(() => expect(screen.getByLabelText("篩選值")).toBeInTheDocument());
    expect(lastListRows().filter).toBeUndefined();
    expect(range()).toContain("3,000");
  });

  it("預設是包含比對，可切成完全等於，total 與範圍都跟著篩選結果走", async () => {
    await openTable();
    fireEvent.change(screen.getByLabelText("篩選欄位"), { target: { value: "city" } });
    fireEvent.change(screen.getByLabelText("篩選值"), { target: { value: "台" } });
    await waitFor(() => expect(lastListRows().filter).toEqual({ key: "city", value: "台", mode: "contains" }));
    // 台北 1800 + 台東 300：包含比對確實比等值寬
    expect(range()).toContain("2,100");

    fireEvent.change(screen.getByLabelText("比對方式"), { target: { value: "equals" } });
    fireEvent.change(screen.getByLabelText("篩選值"), { target: { value: "台東" } });
    await waitFor(() => expect(lastListRows().filter).toEqual({ key: "city", value: "台東", mode: "equals" }));
    expect(range()).toContain("1–200 列，共 300");
  });

  it("換篩選條件會回到第一頁（否則舊 offset 會落在空白區，看起來像查無資料）", async () => {
    await openTable();
    fireEvent.click(nextBtn());
    fireEvent.click(nextBtn());
    await waitFor(() => expect(lastListRows().offset).toBe(400));

    fireEvent.change(screen.getByLabelText("篩選欄位"), { target: { value: "city" } });
    fireEvent.change(screen.getByLabelText("篩選值"), { target: { value: "台東" } });
    await waitFor(() => expect(lastListRows()).toMatchObject({ offset: 0, filter: { key: "city", value: "台東" } }));
    expect(range()).toContain("1–200 列，共 300");
  });

  it("篩選後仍可翻頁，最後一頁的下一頁要停用", async () => {
    await openTable();
    fireEvent.change(screen.getByLabelText("篩選欄位"), { target: { value: "city" } });
    fireEvent.change(screen.getByLabelText("比對方式"), { target: { value: "equals" } });
    fireEvent.change(screen.getByLabelText("篩選值"), { target: { value: "台東" } });
    await waitFor(() => expect(range()).toContain("共 300"));

    fireEvent.click(nextBtn());
    await waitFor(() => expect(range()).toContain("201–300 列，共 300"));
    expect(lastListRows()).toMatchObject({ offset: 200, filter: { key: "city", value: "台東", mode: "equals" } });
    expect(nextBtn()).toBeDisabled();
    expect(prevBtn()).toBeEnabled();
  });

  it("篩選與全文搜尋並存，兩個條件一起送出且回第一頁", async () => {
    await openTable();
    fireEvent.change(screen.getByLabelText("篩選欄位"), { target: { value: "city" } });
    fireEvent.change(screen.getByLabelText("比對方式"), { target: { value: "equals" } });
    fireEvent.change(screen.getByLabelText("篩選值"), { target: { value: "台東" } });
    fireEvent.click(nextBtn());
    await waitFor(() => expect(lastListRows().offset).toBe(200));

    fireEvent.change(screen.getByLabelText("搜尋資料"), { target: { value: "成員 101" } });
    await waitFor(() => expect(lastListRows()).toMatchObject({
      q: "成員 101",
      offset: 0,
      filter: { key: "city", value: "台東", mode: "equals" },
    }));
    // 名稱含「成員 101」的有 11 列，其中縣市是台東的只剩 2 列——兩個條件同時成立才留下
    expect(range()).toContain("1–2 列，共 2");
  });

  it("清除篩選會把 filter 從查詢拿掉，並回到完整資料", async () => {
    await openTable();
    fireEvent.change(screen.getByLabelText("篩選欄位"), { target: { value: "city" } });
    fireEvent.change(screen.getByLabelText("篩選值"), { target: { value: "台東" } });
    await waitFor(() => expect(lastListRows().filter).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "清除篩選" }));
    await waitFor(() => expect(lastListRows().filter).toBeUndefined());
    expect(screen.queryByLabelText("篩選值")).not.toBeInTheDocument();
    expect(range()).toContain("3,000");
  });
});
