import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDatabasesCard } from "./ProjectDatabasesCard";

const linkedToProject = vi.fn();
const knowledgeList = vi.fn();
const assetsList = vi.fn();
const createBoundToProject = vi.fn();
const addRow = vi.fn();
const invalidateLinked = vi.fn();
const invalidateList = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      databases: {
        linkedToProject: { invalidate: (...args: unknown[]) => invalidateLinked(...args) },
        list: { invalidate: (...args: unknown[]) => invalidateList(...args) },
      },
    }),
    databases: {
      linkedToProject: {
        useQuery: (...args: unknown[]) => linkedToProject(...args),
      },
      createBoundToProject: {
        useMutation: (opts?: { onSuccess?: (r: unknown) => void; onError?: (e: { message: string }) => void }) => ({
          isPending: false,
          mutate: (input: unknown) => {
            createBoundToProject(input);
            opts?.onSuccess?.({
              tableId: "table-new",
              tableName: "人員與分工",
              template: "roster",
            });
          },
        }),
      },
      addRow: {
        useMutation: (opts?: { onSuccess?: (r: unknown, v: { tableId: string }) => void; onError?: (e: { message: string }, v: { tableId: string }) => void }) => ({
          isPending: false,
          mutate: (input: { tableId: string; data: Record<string, unknown> }) => {
            addRow(input);
            opts?.onSuccess?.({ id: "r-new" }, input);
          },
        }),
      },
    },
    knowledge: {
      list: {
        useQuery: (...args: unknown[]) => knowledgeList(...args),
      },
    },
    projects: {
      assets: {
        useQuery: (...args: unknown[]) => assetsList(...args),
      },
    },
  },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("ProjectDatabasesCard", () => {
  beforeEach(() => {
    linkedToProject.mockReset();
    knowledgeList.mockReset();
    assetsList.mockReset();
    createBoundToProject.mockReset();
    addRow.mockReset();
    invalidateLinked.mockReset();
    invalidateList.mockReset();
    linkedToProject.mockReturnValue({ data: [], isLoading: false, error: null });
    knowledgeList.mockReturnValue({ data: [], isLoading: false, error: null });
    assetsList.mockReturnValue({ data: [], isLoading: false, error: null });
  });

  it("shows project data entry and empty AI status", () => {
    render(<ProjectDatabasesCard projectId="project-1" />);

    // 這張卡是「本專案有哪些東西 AI 讀得到」的總覽，與 KnowledgeBase（專案依據＝
    // 專案內的全文素材）是不同東西，名稱刻意不同——同名會讓兩個功能看起來是一個。
    expect(screen.getByText("AI 讀得到什麼")).toBeInTheDocument();
    expect(screen.getByTestId("project-data-ai-status")).toHaveAttribute("data-tone", "empty");
    // 收合狀態就要有得按：沒有依據時 summary 內常駐「加資料」，
    // 否則使用者得先展開一張卡才會發現裡面能貼文字／上傳（實測痛點）
    expect(screen.getByRole("button", { name: /加資料/i })).toBeInTheDocument();
    expect(screen.getByText(/本專案還沒有可給 AI 的依據/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /貼上文字/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /問 AI 助手/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Google／Notion／API/i })).toHaveAttribute("href", "/integrations");
    expect(screen.getByTestId("project-data-templates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /人員／分工/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /素材清單/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /發布計畫/i })).toBeInTheDocument();
  });

  it("collapses tables and external links into an advanced section closed by default", () => {
    render(<ProjectDatabasesCard projectId="project-1" />);
    const adv = screen.getByTestId("project-data-advanced");
    expect(adv).not.toHaveAttribute("open");
    // 資料表範本與外部連結都收進進階區
    expect(adv).toContainElement(screen.getByTestId("project-data-templates"));
    expect(adv).toContainElement(screen.getByRole("link", { name: /Google／Notion／API/i }));
    expect(adv).toContainElement(screen.getByRole("link", { name: /管理全部資料表/i }));
    // 簡單路徑（貼文字）留在主畫面，不藏進進階
    expect(adv).not.toContainElement(screen.getByRole("button", { name: /貼上文字/i }));
  });

  it("shows ok status when knowledge exists", () => {
    knowledgeList.mockReturnValue({
      data: [{ id: "k1" }, { id: "k2" }],
      isLoading: false,
      error: null,
    });
    render(<ProjectDatabasesCard projectId="project-1" />);
    expect(screen.getByTestId("project-data-ai-status")).toHaveAttribute("data-tone", "ok");
    expect(screen.getByText(/AI 已可引用本專案部分資料/i)).toBeInTheDocument();
  });

  it("shows partial status when only assets exist", () => {
    assetsList.mockReturnValue({
      data: [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
      isLoading: false,
      error: null,
    });
    render(<ProjectDatabasesCard projectId="project-1" />);
    expect(screen.getByTestId("project-data-ai-status")).toHaveAttribute("data-tone", "partial");
  });

  it("creates a bound table from template and shows success", async () => {
    render(<ProjectDatabasesCard projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /人員／分工/i }));
    expect(createBoundToProject).toHaveBeenCalledWith({ projectId: "project-1", template: "roster" });
    await waitFor(() => {
      expect(screen.getByText(/已建立「人員與分工」/i)).toBeInTheDocument();
    });
    expect(invalidateLinked).toHaveBeenCalled();
  });

  it("hides one-click templates when canEdit is false", () => {
    render(<ProjectDatabasesCard projectId="project-1" canEdit={false} />);
    expect(screen.queryByTestId("project-data-templates")).not.toBeInTheDocument();
    expect(screen.getByText(/請有編輯權限的成員/i)).toBeInTheDocument();
  });

  it("lists linked tables with AI access badge", () => {
    linkedToProject.mockReturnValue({
      data: [
        {
          tableId: "t1",
          tableName: "摘錄與重點",
          fields: [
            { key: "c1", label: "內容", type: "text", required: true },
            { key: "proj", label: "關聯專案", type: "project" },
          ],
          rows: [{ id: "r1", data: { c1: "一段重點", proj: "project-1" } }],
          agentAccess: "write",
        },
      ],
      isLoading: false,
      error: null,
    });
    render(<ProjectDatabasesCard projectId="project-1" />);
    expect(screen.getByText("摘錄與重點")).toBeInTheDocument();
    expect(screen.getByText("AI 可讀寫")).toBeInTheDocument();
    expect(screen.getByText("一段重點")).toBeInTheDocument();
  });

  it("treats agentAccess none linked rows as not AI-readable", () => {
    linkedToProject.mockReturnValue({
      data: [
        {
          tableId: "t-hidden",
          tableName: "敏感表",
          fields: [
            { key: "c1", label: "內容", type: "text", required: true },
            { key: "proj", label: "關聯專案", type: "project" },
          ],
          rows: [{ id: "r1", data: { c1: "密", proj: "project-1" } }],
          agentAccess: "none",
        },
      ],
      isLoading: false,
      error: null,
    });
    render(<ProjectDatabasesCard projectId="project-1" />);
    expect(screen.getByTestId("project-data-ai-status")).toHaveAttribute("data-tone", "partial");
    expect(screen.getByText(/AI 目前看不到/i)).toBeInTheDocument();
  });

  it("quick-adds a row with project prefilled", () => {
    linkedToProject.mockReturnValue({
      data: [
        {
          tableId: "t1",
          tableName: "摘錄與重點",
          fields: [
            { key: "c1", label: "內容", type: "text", required: true },
            { key: "proj", label: "關聯專案", type: "project" },
          ],
          rows: [{ id: "r1", data: { c1: "一段重點", proj: "project-1" } }],
          agentAccess: "write",
        },
      ],
      isLoading: false,
      error: null,
    });
    render(<ProjectDatabasesCard projectId="project-1" />);
    fireEvent.change(screen.getByLabelText(/新增 內容/i), { target: { value: "新摘錄" } });
    fireEvent.click(screen.getByRole("button", { name: /加一列/i }));
    expect(addRow).toHaveBeenCalledWith({
      tableId: "t1",
      data: { c1: "新摘錄", proj: "project-1" },
    });
  });

  // ── 使用者旅程：剪輯／社群／動畫混合角色 ──

  it("user journey: empty project shows all multi-role templates", () => {
    render(<ProjectDatabasesCard projectId="project-1" />);
    for (const label of ["人員／分工", "文案／重點", "素材清單", "發布計畫", "待辦清單", "空白資料表"]) {
      expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /管理全部資料表/i })).toHaveAttribute(
      "href",
      "/databases?projectId=project-1&from=project",
    );
  });

  it("user journey: social editor creates publish template", async () => {
    render(<ProjectDatabasesCard projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /發布計畫/i }));
    expect(createBoundToProject).toHaveBeenCalledWith({ projectId: "project-1", template: "publish" });
  });

  it("user journey: editor creates media list template", () => {
    render(<ProjectDatabasesCard projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /素材清單/i }));
    expect(createBoundToProject).toHaveBeenCalledWith({ projectId: "project-1", template: "media" });
  });

  it("user journey: mixed tables show AI-readable count and ok tone", () => {
    linkedToProject.mockReturnValue({
      data: [
        {
          tableId: "t-ok",
          tableName: "發布計畫",
          fields: [
            { key: "title", label: "標題", type: "text", required: true },
            { key: "proj", label: "關聯專案", type: "project" },
          ],
          rows: [
            { id: "r1", data: { title: "週一貼文", proj: "project-1" } },
            { id: "r2", data: { title: "週三貼文", proj: "project-1" } },
          ],
          agentAccess: "write",
        },
        {
          tableId: "t-secret",
          tableName: "內部敏感",
          fields: [
            { key: "n", label: "名稱", type: "text", required: true },
            { key: "proj", label: "關聯專案", type: "project" },
          ],
          rows: [{ id: "r3", data: { n: "密", proj: "project-1" } }],
          agentAccess: "none",
        },
      ],
      isLoading: false,
      error: null,
    });
    knowledgeList.mockReturnValue({ data: [{ id: "k1" }], isLoading: false, error: null });
    render(<ProjectDatabasesCard projectId="project-1" />);
    expect(screen.getByTestId("project-data-ai-status")).toHaveAttribute("data-tone", "ok");
    expect(screen.getByText(/AI 可讀 2/i)).toBeInTheDocument();
    expect(screen.getByText(/另有 1 列 AI 不可見/i)).toBeInTheDocument();
    expect(screen.getByText(/關聯表列 3/i)).toBeInTheDocument();
    expect(screen.getByText("AI 不可見")).toBeInTheDocument();
    expect(screen.getByText("AI 可讀寫")).toBeInTheDocument();
  });

  it("user journey: read-only member cannot quick-add", () => {
    linkedToProject.mockReturnValue({
      data: [
        {
          tableId: "t1",
          tableName: "待辦清單",
          fields: [
            { key: "item", label: "項目", type: "text", required: true },
            { key: "proj", label: "關聯專案", type: "project" },
          ],
          rows: [{ id: "r1", data: { item: "確認字幕", proj: "project-1" } }],
          agentAccess: "read",
        },
      ],
      isLoading: false,
      error: null,
    });
    render(<ProjectDatabasesCard projectId="project-1" canEdit={false} />);
    expect(screen.queryByRole("button", { name: /加一列/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-data-templates")).not.toBeInTheDocument();
  });

  it("user journey: Enter key submits quick-add", () => {
    linkedToProject.mockReturnValue({
      data: [
        {
          tableId: "t1",
          tableName: "文案與重點",
          fields: [
            { key: "c1", label: "內容", type: "text", required: true },
            { key: "proj", label: "關聯專案", type: "project" },
          ],
          rows: [],
          agentAccess: "write",
        },
      ],
      isLoading: false,
      error: null,
    });
    render(<ProjectDatabasesCard projectId="project-1" />);
    const input = screen.getByLabelText(/新增 內容/i);
    fireEvent.change(input, { target: { value: "本週金句改成重點句" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(addRow).toHaveBeenCalledWith({
      tableId: "t1",
      data: { c1: "本週金句改成重點句", proj: "project-1" },
    });
  });

  it("user journey: empty quick-add shows validation instead of calling API", () => {
    linkedToProject.mockReturnValue({
      data: [
        {
          tableId: "t1",
          tableName: "人員與分工",
          fields: [
            { key: "name", label: "姓名", type: "text", required: true },
            { key: "proj", label: "關聯專案", type: "project" },
          ],
          rows: [{ id: "r1", data: { name: "小編", proj: "project-1" } }],
          agentAccess: "write",
        },
      ],
      isLoading: false,
      error: null,
    });
    render(<ProjectDatabasesCard projectId="project-1" />);
    fireEvent.click(screen.getByRole("button", { name: /加一列/i }));
    expect(addRow).not.toHaveBeenCalled();
    expect(screen.getByText(/請填「姓名」/i)).toBeInTheDocument();
  });
});
