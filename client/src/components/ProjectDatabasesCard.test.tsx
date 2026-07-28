import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectDatabasesCard } from "./ProjectDatabasesCard";

const linkedToProject = vi.fn();
const knowledgeList = vi.fn();
const assetsList = vi.fn();
const createBoundToProject = vi.fn();
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
              tableName: "人員名單",
              template: "roster",
            });
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
    invalidateLinked.mockReset();
    invalidateList.mockReset();
    linkedToProject.mockReturnValue({ data: [], isLoading: false, error: null });
    knowledgeList.mockReturnValue({ data: [], isLoading: false, error: null });
    assetsList.mockReturnValue({ data: [], isLoading: false, error: null });
  });

  it("shows project data entry and empty AI status", () => {
    render(<ProjectDatabasesCard projectId="project-1" />);

    expect(screen.getByText("專案資料")).toBeInTheDocument();
    expect(screen.getByTestId("project-data-ai-status")).toHaveAttribute("data-tone", "empty");
    expect(screen.getByText(/本專案還沒有可給 AI 的依據/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /貼上文字/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /問 AI 助手/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Google／Notion／API/i })).toHaveAttribute("href", "/integrations");
    expect(screen.getByTestId("project-data-templates")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /人員名單/i })).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /人員名單/i }));
    expect(createBoundToProject).toHaveBeenCalledWith({ projectId: "project-1", template: "roster" });
    await waitFor(() => {
      expect(screen.getByText(/已建立「人員名單」/i)).toBeInTheDocument();
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
            { key: "c1", label: "內容", type: "text" },
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
});
