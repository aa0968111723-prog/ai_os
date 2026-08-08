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
const bindableQuery = vi.fn();
const bindMutate = vi.fn();
const unbindMutate = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    useUtils: () => ({
      databases: {
        linkedToProject: { invalidate: (...args: unknown[]) => invalidateLinked(...args) },
        list: { invalidate: (...args: unknown[]) => invalidateList(...args) },
      },
      knowledge: { list: { invalidate: vi.fn() } },
      projects: { assets: { invalidate: vi.fn() } },
      dataHub: { bindableResources: { invalidate: vi.fn() } },
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
    // P4「加入既有資料」：另有專屬測試，這裡只要不讓元件炸掉
    dataHub: {
      bindableResources: { useQuery: () => bindableQuery() },
      bindResource: { useMutation: () => ({ isPending: false, error: null, mutate: bindMutate }) },
      unbindResource: { useMutation: () => ({ isPending: false, error: null, mutate: unbindMutate }) },
    },
    projects: {
      assets: {
        useQuery: (...args: unknown[]) => assetsList(...args),
      },
      get: {
        useQuery: () => ({ data: { id: "p1", title: "測試專案" }, isLoading: false }),
      },
    },
  },
}));

// 「＋加入資料」自己有一整組查詢與 picker（另有專屬測試）；這支測的是專案資料卡本身
vi.mock("./AddDataSheet", () => ({
  AddDataSheet: ({ open }: { open: boolean }) => (open ? <div data-testid="add-data-sheet" /> : null),
  pendingAddDataMethod: () => null,
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
    bindableQuery.mockReset();
    bindMutate.mockReset();
    unbindMutate.mockReset();
    bindableQuery.mockReturnValue({ data: [], isLoading: false, error: null });
    linkedToProject.mockReturnValue({ data: [], isLoading: false, error: null });
    knowledgeList.mockReturnValue({ data: [], isLoading: false, error: null });
    assetsList.mockReturnValue({ data: [], isLoading: false, error: null });
  });

  it("shows project data entry and empty AI status", () => {
    render(<ProjectDatabasesCard projectId="project-1" />);

    expect(screen.getByText("專案依據")).toBeInTheDocument();
    expect(screen.getByTestId("project-data-ai-status")).toHaveAttribute("data-tone", "empty");
    // 收合狀態就要有得按：沒有依據時 summary 內常駐「加入資料」，
    // 否則使用者得先展開一張卡才會發現裡面能加東西（實測痛點）。
    // 資料中心 P2 之後這顆與展開後的主要動作是同一件事——開「＋加入資料」，
    // 不再要求使用者自己判斷這份資料算貼文字、上傳還是外部來源。
    expect(screen.getAllByRole("button", { name: /加入資料/i }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/本專案還沒有可給 AI 的依據/i)).toBeInTheDocument();
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
    // 主要動作（＋加入資料）留在主畫面，不藏進進階
    expect(adv).not.toContainElement(screen.getAllByRole("button", { name: /加入資料/i })[0]);
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
    expect(screen.getByText("AI 可以協作")).toBeInTheDocument();
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
    expect(screen.getByText(/資料表 AI 可讀 2 列/i)).toBeInTheDocument();
    expect(screen.getByText(/另有 1 列不提供 AI/i)).toBeInTheDocument();
    expect(screen.getByText(/關聯表列 3/i)).toBeInTheDocument();
    expect(screen.getByText("不提供 AI")).toBeInTheDocument();
    expect(screen.getByText("AI 可以協作")).toBeInTheDocument();
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

  /**
   * Golden Path 3（P4）：資料已經在站內了，要給另一個專案用不該叫使用者
   * 「再從 Google 匯入一次」。這一區就是那條路。
   */
  describe("加入既有資料", () => {
    it("列出可提供的資料表，按下即綁定給本專案", async () => {
      bindableQuery.mockReturnValue({
        data: [{
          resourceKind: "table", resourceId: "t1", title: "拍攝器材借用表",
          description: null, scope: "group", rowCount: 12, agentAccess: "write", alreadyBound: false,
        }],
        isLoading: false,
        error: null,
      });
      render(<ProjectDatabasesCard projectId="project-1" />);
      fireEvent.click(screen.getByRole("button", { name: /加入既有資料/ }));
      await waitFor(() => expect(screen.getByTestId("attach-existing")).toBeInTheDocument());
      expect(screen.getByText("拍攝器材借用表")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /提供給本專案/ }));
      expect(bindMutate).toHaveBeenCalledWith({
        projectId: "project-1", resourceKind: "table", resourceId: "t1",
      });
    });

    it("★ 已提供的可以取消——且文案說清楚資料本身不會被動到", async () => {
      bindableQuery.mockReturnValue({
        data: [{
          resourceKind: "table", resourceId: "t1", title: "拍攝器材借用表",
          description: null, scope: "group", rowCount: 12, agentAccess: "read", alreadyBound: true,
        }],
        isLoading: false,
        error: null,
      });
      render(<ProjectDatabasesCard projectId="project-1" />);
      fireEvent.click(screen.getByRole("button", { name: /加入既有資料/ }));
      const cancel = await screen.findByRole("button", { name: /已提供・取消/ });
      expect(cancel.getAttribute("title")).toContain("資料本身完全不動");
      fireEvent.click(cancel);
      expect(unbindMutate).toHaveBeenCalledWith({
        projectId: "project-1", resourceKind: "table", resourceId: "t1",
      });
    });

    it("★ 說明講明個人資料表不會出現在這裡（它只有你看得到）", async () => {
      render(<ProjectDatabasesCard projectId="project-1" />);
      fireEvent.click(screen.getByRole("button", { name: /加入既有資料/ }));
      await waitFor(() => expect(screen.getByTestId("attach-existing")).toBeInTheDocument());
      expect(screen.getByText(/個人資料表不會出現在這裡/)).toBeInTheDocument();
    });

    it("沒有可提供的表時講清楚條件，不是給一片空白", async () => {
      render(<ProjectDatabasesCard projectId="project-1" />);
      fireEvent.click(screen.getByRole("button", { name: /加入既有資料/ }));
      expect(await screen.findByText(/組共用、團隊或全站範圍的表才能提供給專案/)).toBeInTheDocument();
    });

    it("唯讀成員看不到「加入既有資料」", () => {
      render(<ProjectDatabasesCard projectId="project-1" canEdit={false} />);
      expect(screen.queryByRole("button", { name: /加入既有資料/ })).toBeNull();
    });
  });

  /** R5／R8：整張綁定的表沒有 project 欄位時，狀態與可用動作都不能說謊 */
  describe("整張提供的資料表", () => {
    const boundGroup = {
      tableId: "t-bound",
      tableName: "品牌指南",
      fields: [{ key: "name", label: "名稱", type: "text" }],
      rows: [{ id: "r1", data: { name: "主色" } }],
      agentAccess: "read" as const,
      boundWhole: true,
    };

    it("★ 沒有任何關聯列，狀態仍要說 AI 有依據（不能說「還沒有依據」）", () => {
      linkedToProject.mockReturnValue({ data: [boundGroup], isLoading: false, error: null });
      render(<ProjectDatabasesCard projectId="project-1" />);
      expect(screen.getByTestId("project-data-ai-status")).toHaveAttribute("data-tone", "ok");
      expect(screen.getByText(/整張提供的資料表 1 張/)).toBeInTheDocument();
    });

    it("標示「整張提供」，列數講明是預覽", () => {
      linkedToProject.mockReturnValue({ data: [boundGroup], isLoading: false, error: null });
      render(<ProjectDatabasesCard projectId="project-1" />);
      expect(screen.getByText("整張提供")).toBeInTheDocument();
      expect(screen.getByText(/整張表・預覽 1 列/)).toBeInTheDocument();
    });

    it("★ 沒有「關聯專案」欄時不顯示就地加列——那顆按鈕按了必定失敗", () => {
      linkedToProject.mockReturnValue({ data: [boundGroup], isLoading: false, error: null });
      render(<ProjectDatabasesCard projectId="project-1" />);
      expect(screen.queryByTestId("quick-add-t-bound")).toBeNull();
      expect(screen.getByText(/要新增或修改內容，請/)).toBeInTheDocument();
    });
  });
});
