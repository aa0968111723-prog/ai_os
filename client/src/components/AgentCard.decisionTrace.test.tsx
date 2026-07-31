import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentCard } from "./AgentCard";

/**
 * #133 PR-2：過程面板顯示決策軌跡（rationale／contextUsed）與步驟產出深連結（outputRefs）。
 * 只驗證「使用者看得到、點得動」——不驗規劃內容本身（那是 server 端 planTypes 測試的事）。
 */

const flashAnchor = vi.fn();
vi.mock("../discuss", () => ({
  flashAnchor: (...args: unknown[]) => flashAnchor(...args),
}));

// vi.mock 會被 hoist 到檔案最頂——工廠引用的值必須用 vi.hoisted 先建立
const { queryOf, mutationOf } = vi.hoisted(() => ({
  queryOf: (data: unknown) => ({ data, error: null, isLoading: false }),
  mutationOf: () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false, error: null }),
}));

const RUN = {
  id: "run-1",
  userId: "user-1",
  goal: "為開場排一版可審的短片",
  status: "awaiting_approval",
  estPoints: 3,
  summary: "為開場排一版可審的短片｜2 個步驟｜預估 3 點",
  error: null,
  createdAt: new Date("2026-07-30T10:00:00Z").toISOString(),
  plannerTelemetry: null,
  planSummary: {
    goal: "為開場排一版可審的短片",
    rationale: "腳本與定裝已齊，短流程即可交付，不需排程。",
    contextUsed: ["專案世界觀", "專案知識庫節錄"],
    successCriteria: ["產出一鏡可審畫面"],
    assumptions: [],
    missingInformation: [],
    expectedOutputs: ["主視覺一張"],
    risks: [],
    milestones: [],
    estimatedPoints: 3,
  },
  steps: [
    {
      id: "note",
      kind: "create_note",
      note: "整理拍攝重點",
      rationale: "集中資訊供後續步驟引用。",
      status: "done",
      actorType: "ai",
      outputRefs: [{ type: "note", id: "note-9", label: "拍攝重點" }],
    },
    {
      id: "gen",
      kind: "generate",
      note: "生成主視覺",
      status: "done",
      actorType: "ai",
      outputRefs: [{ type: "generation", id: "gen-7", label: "主視覺" }],
    },
  ],
};

vi.mock("../api", () => {
  const api = {
    useUtils: () => ({
      agents: {
        listByProject: { invalidate: vi.fn() },
        eventsByProject: { invalidate: vi.fn() },
        insights: { invalidate: vi.fn() },
      },
      quota: { my: { invalidate: vi.fn() } },
      tasks: { listByProject: { invalidate: vi.fn() } },
      generation: { listByProject: { invalidate: vi.fn() }, listByProjectPaged: { invalidate: vi.fn() } },
      scenes: { listByProject: { invalidate: vi.fn() } },
      notes: { list: { invalidate: vi.fn() } },
      schedule: { list: { invalidate: vi.fn() } },
      knowledge: { list: { invalidate: vi.fn() } },
    }),
    auth: { me: { useQuery: () => queryOf({ user: { id: "user-1" } }) } },
    agents: {
      listByProject: { useQuery: () => queryOf([RUN]) },
      eventsByProject: { useQuery: () => queryOf({ items: [] }) },
      insights: { useQuery: () => queryOf(null) },
      plan: { useMutation: mutationOf },
      approve: { useMutation: mutationOf },
      discard: { useMutation: mutationOf },
      stop: { useMutation: mutationOf },
    },
    tasks: {
      listByProject: { useQuery: () => queryOf([]) },
      complete: { useMutation: mutationOf },
      decideApproval: { useMutation: mutationOf },
    },
    knowledge: { importDriveFile: { useMutation: mutationOf } },
  };
  return { trpc: api };
});

describe("AgentCard 決策軌跡與產出深連結", () => {
  beforeEach(() => {
    flashAnchor.mockReset();
    flashAnchor.mockReturnValue(true);
  });

  it("顯示計畫 rationale、contextUsed 與步驟 rationale", () => {
    render(<AgentCard projectId="project-1" canEdit embedded />);
    expect(screen.getByText("為何這樣排")).toBeInTheDocument();
    expect(screen.getByText("腳本與定裝已齊，短流程即可交付，不需排程。")).toBeInTheDocument();
    expect(screen.getByText("依據的上下文")).toBeInTheDocument();
    expect(screen.getByText("專案世界觀")).toBeInTheDocument();
    expect(screen.getByText("專案知識庫節錄")).toBeInTheDocument();
    expect(screen.getByText(/理由：集中資訊供後續步驟引用/)).toBeInTheDocument();
  });

  it("outputRefs 變成可點 chips：筆記走 Planner 深連結、生成成果 flashAnchor 同頁錨點", async () => {
    const user = userEvent.setup();
    render(<AgentCard projectId="project-1" canEdit embedded />);
    const noteChip = screen.getByRole("link", { name: "成果：拍攝重點" });
    expect(noteChip).toHaveAttribute("href", "/planner?focus=note-note-9");
    await user.click(screen.getByRole("button", { name: "成果：主視覺" }));
    expect(flashAnchor).toHaveBeenCalledWith("generation-gen-7");
  });
});
