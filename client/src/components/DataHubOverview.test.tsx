import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DataHubOverview } from "./DataHubOverview";

const { state } = vi.hoisted(() => ({
  state: {
    listArgs: [] as unknown[],
    searchArgs: [] as unknown[],
    list: {
      resources: [] as any[],
      counts: { total: 0, aiUsable: 0, byKind: { knowledge: 0, table: 0, document: 0, asset: 0 } },
      truncated: false,
    },
    search: { results: [] as any[], retrievalDebug: { permissionFilteredCandidates: 0 } },
    intelligenceSummary: { aiReview: 2, unnamedPeople: 1, possibleDuplicates: 3, unassignedProject: 4, total: 0, analysisPending: 0, activeJobs: 0, failedJobs: 0 },
    sources: [
      { id: "google-drive", label: "Google 雲端", configured: true, connected: true, status: "active", detail: "me@gmail.com", count: 1 },
      { id: "notion", label: "Notion", configured: true, connected: true, status: "error", detail: "團隊", count: 1 },
      { id: "api", label: "外部 API", configured: true, connected: false, status: null, detail: null, count: 0 },
    ],
  },
}));

vi.mock("../api", () => ({
  trpc: {
    dataHub: {
      list: { useQuery: (args: unknown) => { state.listArgs.push(args); return { data: state.list, isLoading: false, error: null }; } },
      sources: { useQuery: () => ({ data: state.sources, isLoading: false, error: null }) },
    },
    intelligence: {
      search: { useQuery: (args: unknown) => { state.searchArgs.push(args); return { data: state.search, isLoading: false, error: null }; } },
      summary: { useQuery: () => ({ data: state.intelligenceSummary, isLoading: false, error: null }) },
      processing: { useQuery: () => ({ data: { active: 0, failed: 0, progress: 100, stages: [] } }) },
      people: { useQuery: () => ({ data: { people: [], clusters: [] } }) },
      reviewQueue: { useQuery: () => ({ data: { items: [], total: 0 }, isLoading: false, refetch: vi.fn() }) },
      resolveReview: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({ intelligence: { summary: { invalidate: vi.fn() } }, dataHub: { list: { invalidate: vi.fn() } } }),
  },
}));

vi.mock("wouter", () => ({
  Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

function resource(over: Record<string, unknown> = {}) {
  return {
    id: "asset:a1", kind: "asset", rawId: "a1", title: "安倢雨天.jpg", scope: "project", source: "upload",
    projectId: "p1", projectTitle: "克難坡的雨", groupId: "g1", ai: { access: "readable", reason: "可讀" },
    status: "ready", statusLabel: "AI 可以使用", updatedAt: new Date().toISOString(), href: "/p/p1#sec-assets",
    sizeLabel: "1.2 MB", syncedLabel: null, sourceHasUpdate: false,
    intelligence: { id: "i1", canonicalType: "IMAGE", category: "Character Photo", summary: "安倢在淡水雨中撐傘。", tags: ["weather:rain", "location:tamsui"], confidence: 0.94, analysisStatus: "needs_review" },
    ...over,
  };
}

describe("Aios Intelligence Library overview", () => {
  beforeEach(() => {
    state.listArgs = [];
    state.searchArgs = [];
    state.list = { resources: [], counts: { total: 0, aiUsable: 0, byKind: { knowledge: 0, table: 0, document: 0, asset: 0 } }, truncated: false };
    state.search = { results: [], retrievalDebug: { permissionFilteredCandidates: 0 } };
  });

  it("positions the page as an AI-understood library and keeps an actionable empty state", () => {
    render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByText("AI 已理解你的專案資料")).toBeInTheDocument();
    expect(screen.getAllByText("還沒有資料").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: /加入第一份資料/ })).toBeInTheDocument();
    expect(screen.queryByText(/0 資料庫/)).toBeNull();
  });

  it("opens the single add-data flow from the empty state", async () => {
    const onAddData = vi.fn();
    render(<DataHubOverview onAddData={onAddData} />);
    await userEvent.click(screen.getByRole("button", { name: /加入第一份資料/ }));
    expect(onAddData).toHaveBeenCalledOnce();
  });

  it("shows AI category, summary, dynamic tags and confidence without exposing ids", () => {
    state.list = { resources: [resource()], counts: { total: 1, aiUsable: 1, byKind: { knowledge: 0, table: 0, document: 0, asset: 1 } }, truncated: false };
    render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByText("安倢雨天.jpg")).toBeInTheDocument();
    expect(screen.getByText("安倢在淡水雨中撐傘。")).toBeInTheDocument();
    expect(screen.getByText("rain")).toBeInTheDocument();
    expect(screen.getByText("AI 94%")).toBeInTheDocument();
    expect(screen.queryByText("i1")).toBeNull();
  });

  it("renders compact attention rows from real Intelligence summary counts", () => {
    render(<DataHubOverview onAddData={() => {}} />);
    expect(screen.getByRole("button", { name: /AI 待確認.*2/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /未命名人物.*1/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /可能重複.*3/ })).toBeInTheDocument();
  });

  it("passes project context to ACL-first list and semantic retrieval", async () => {
    render(<DataHubOverview projectId="p1" projectTitle="克難坡的雨" onAddData={() => {}} />);
    expect(state.listArgs[0]).toMatchObject({ projectId: "p1" });
    await userEvent.type(screen.getByRole("searchbox"), "安倢");
    await waitFor(() => expect(state.searchArgs.at(-1)).toMatchObject({ q: "安倢", projectId: "p1" }), { timeout: 2_000 });
  });

  it("uses Intelligence hybrid search after debounce and displays retrieval relevance", async () => {
    state.search = { results: [{ resource: resource(), intelligence: (resource() as any).intelligence, score: 0.91 }], retrievalDebug: { permissionFilteredCandidates: 1 } };
    render(<DataHubOverview onAddData={() => {}} />);
    await userEvent.type(screen.getByRole("searchbox"), "安倢雨天照片");
    await waitFor(() => expect(state.searchArgs.at(-1)).toMatchObject({ q: "安倢雨天照片" }), { timeout: 2_000 });
    expect(await screen.findByText("相關度 91%")).toBeInTheDocument();
    expect(screen.getByText(/metadata、全文與語意索引/)).toBeInTheDocument();
  });

  it("smart category chips filter by canonical type", async () => {
    state.list = {
      resources: [resource(), resource({ id: "document:d1", rawId: "d1", kind: "document", title: "Script.docx", intelligence: { id: "i2", canonicalType: "DOCUMENT", category: "Script", summary: null, tags: ["type:document"], confidence: 0.97, analysisStatus: "ready" } })],
      counts: { total: 2, aiUsable: 2, byKind: { knowledge: 0, table: 0, document: 1, asset: 1 } }, truncated: false,
    };
    render(<DataHubOverview onAddData={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByText("Script.docx")).toBeInTheDocument();
    expect(screen.queryByText("安倢雨天.jpg")).toBeNull();
  });

  it("keeps source management collapsed and explains connector boundaries", () => {
    const { container } = render(<DataHubOverview onAddData={() => {}} />);
    expect(container.querySelector("details.hub-sources")).not.toHaveAttribute("open");
    expect(screen.getByText(/AI 只讀得到你選中並加入站內的內容/)).toBeInTheDocument();
    expect(screen.getByText(/中斷連接不會刪掉已加入的資料/)).toBeInTheDocument();
  });
});
