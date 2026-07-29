import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreationWorkbench } from "../CreationWorkbench";
import { clearDraft, loadDraft, saveDraft, emptyDraft, updateDraft } from "../creationDraft";
import { revealWorkbenchAnchor } from "../workbenchNav";

const listByProject = vi.fn();
const flashAnchor = vi.fn();

vi.mock("../../../api", () => ({
  trpc: {
    useUtils: () => ({
      prompts: { list: { invalidate: vi.fn() } },
      generation: {
        listByProject: { invalidate: vi.fn() },
        listByProjectPaged: { invalidate: vi.fn() },
      },
      quota: { my: { invalidate: vi.fn() } },
    }),
    agents: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
      },
    },
    projects: {
      assets: {
        useQuery: () => ({ data: [] }),
      },
    },
    quota: {
      my: {
        useQuery: () => ({ data: undefined }),
      },
    },
    prompts: {
      save: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    generation: {
      submit: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }),
      },
    },
  },
}));

vi.mock("../../../discuss", () => ({
  flashAnchor: (...args: unknown[]) => flashAnchor(...args),
}));

vi.mock("../../../components/ProjectAssistant", () => ({
  ProjectAssistant: () => <div data-testid="assistant">assistant</div>,
}));

vi.mock("../../../components/AgentCard", () => ({
  AgentCard: () => <div data-testid="agent-card">agent-card</div>,
}));

vi.mock("../../../components/ModelPicker", () => ({
  ModelPicker: ({
    onChange,
  }: {
    onChange: (m: {
      id: string;
      label: string;
      points: number;
      needs: string | null;
      sourceHint: string | null;
      kind: string;
      tierLabel: string;
      strengths: string;
      verified: boolean;
      recommended: boolean;
    } | null) => void;
  }) => {
    // fire once after mount without useEffect to keep mock simple
    queueMicrotask(() =>
      onChange({
        id: "fal-ai/flux/schnell",
        label: "FLUX Schnell",
        points: 1,
        needs: null,
        sourceHint: null,
        kind: "image",
        tierLabel: "經濟",
        strengths: "快",
        verified: true,
        recommended: true,
      }),
    );
    return <div data-testid="model-picker">model-picker</div>;
  },
}));

vi.mock("../../../components/GenerationList", () => ({
  GenerationList: () => <div data-testid="generation-list">generation-list</div>,
}));

vi.mock("../../../realtime", () => ({
  CollabZone: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe("CreationWorkbench", () => {
  const projectId = "project-1";
  const originalSearch = window.location.search;

  const renderWorkbench = (props = {}) =>
    render(<CreationWorkbench projectId={projectId} canEdit groupId="g1" {...props} />);

  beforeEach(() => {
    listByProject.mockReset();
    listByProject.mockReturnValue({ data: [] });
    flashAnchor.mockReset();
    flashAnchor.mockReturnValue(true);
    clearDraft(projectId);
    clearDraft("project-2");
    clearDraft("project-3");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    window.history.replaceState({}, "", "/project/project-1");
  });

  afterEach(() => {
    window.history.replaceState({}, "", `/${originalSearch || ""}`);
    clearDraft(projectId);
  });

  it("renders workbench shell with goal input, mode tabs, and context bar", () => {
    renderWorkbench();

    expect(screen.getByRole("heading", { name: "AI 創作工作台" })).toBeVisible();
    expect(screen.getByLabelText("想完成什麼？")).toBeVisible();
    expect(screen.getByRole("tablist", { name: "AI 創作模式" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /問 AI/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /直接生成/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /製作範本/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: /執行計畫/ })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("group", { name: "AI 創作工作台可連動的專案系統" })).toBeVisible();
    expect(document.getElementById("sec-ai-hub")).toBeTruthy();
    expect(document.getElementById("sec-assistant")).toBeTruthy();
    expect(document.getElementById("sec-agent")).toBeTruthy();
  });

  it("shows only the active mode panel", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const askPanel = screen.getByRole("tabpanel", { name: /問 AI/ });
    expect(askPanel).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("assistant")).toBeVisible();

    const generateTab = screen.getByRole("tab", { name: /直接生成/ });
    await user.click(generateTab);
    expect(generateTab).toHaveAttribute("aria-selected", "true");
    const genPanel = screen.getByRole("tabpanel", { name: /直接生成/ });
    expect(genPanel).not.toHaveAttribute("hidden");
    // Full generate form (WB-02) lives in panel with #sec-studio
    expect(document.getElementById("sec-studio")).toBeTruthy();
    expect(within(genPanel).getByTestId("model-picker")).toBeVisible();
    expect(document.getElementById("gen-prompt")).toBeTruthy();

    const askTab = screen.getByRole("tab", { name: /問 AI/ });
    const panels = document.querySelectorAll('[role="tabpanel"]');
    const visible = [...panels].filter((p) => !p.hasAttribute("hidden"));
    expect(visible).toHaveLength(1);
    expect(screen.getByTestId("assistant")).toBeInTheDocument();
    expect(askTab).toHaveAttribute("aria-selected", "false");
  });

  it("persists goal across mode switch and collapse", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const goal = screen.getByLabelText("想完成什麼？");
    await user.type(goal, "拆分鏡並出圖");
    expect(goal).toHaveValue("拆分鏡並出圖");

    await user.click(screen.getByRole("tab", { name: /直接生成/ }));
    expect(screen.getByLabelText("想完成什麼？")).toHaveValue("拆分鏡並出圖");
    const generatePanel = screen.getByRole("tabpanel", { name: /直接生成/ });
    expect(within(generatePanel).getByText(/目前目標/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(document.querySelector("#sec-ai-hub-body")).toHaveAttribute("hidden");
    expect(screen.getByText(/草稿與模式選擇已保留/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "展開" }));
    expect(screen.getByLabelText("想完成什麼？")).toHaveValue("拆分鏡並出圖");
    expect(screen.getByRole("tab", { name: /直接生成/ })).toHaveAttribute("aria-selected", "true");

    await waitFor(() => {
      const stored = loadDraft(projectId);
      expect(stored.goal).toBe("拆分鏡並出圖");
      expect(stored.mode).toBe("generate");
    });
  });

  it("generate form prompt survives mode switch (draft persistence)", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole("tab", { name: /直接生成/ }));

    const prompt = document.getElementById("gen-prompt") as HTMLTextAreaElement;
    expect(prompt).toBeTruthy();
    await user.type(prompt, "禪堂清晨");
    expect(prompt).toHaveValue("禪堂清晨");

    await user.click(screen.getByRole("tab", { name: /問 AI/ }));
    await user.click(screen.getByRole("tab", { name: /直接生成/ }));
    expect((document.getElementById("gen-prompt") as HTMLTextAreaElement).value).toBe("禪堂清晨");

    await waitFor(() => {
      expect(loadDraft(projectId).prompt).toBe("禪堂清晨");
    });
  });

  it("restores draft from storage on remount", async () => {
    saveDraft(projectId, {
      ...emptyDraft("template"),
      goal: "用範本跑片頭",
    });
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByLabelText("想完成什麼？")).toHaveValue("用範本跑片頭");
    });
    expect(screen.getByRole("tab", { name: /製作範本/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /前往製作範本/ })).toBeVisible();
  });

  it("supports arrow keys on mode tabs", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const ask = screen.getByRole("tab", { name: /問 AI/ });
    ask.focus();
    expect(ask).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /直接生成/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /直接生成/ })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: /製作範本/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(screen.getByRole("tab", { name: /執行計畫/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(screen.getByRole("tab", { name: /問 AI/ })).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tab", { name: /執行計畫/ })).toHaveAttribute("aria-selected", "true");
  });

  it("direct generate mode hosts #sec-studio form (no jump button)", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole("tab", { name: /直接生成/ }));

    expect(document.getElementById("sec-studio")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /前往創作生成台/ })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(/預估消耗/);
  });

  it("template adapter scrolls to #sec-workflow", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole("tab", { name: /製作範本/ }));

    const workflow = document.createElement("div");
    workflow.id = "sec-workflow";
    document.body.appendChild(workflow);

    await user.click(screen.getByRole("button", { name: /前往製作範本/ }));
    await waitFor(() => expect(workflow.scrollIntoView).toHaveBeenCalled());
    workflow.remove();
  });

  it("plan mode embeds agent card and opens on activity", async () => {
    listByProject.mockReturnValue({
      data: [
        { id: "run-1", status: "running" },
        { id: "run-2", status: "awaiting_approval" },
      ],
    });
    const user = userEvent.setup();
    renderWorkbench();

    expect(screen.getAllByText("執行中 1").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("待核准 1").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("tab", { name: /執行計畫/ }));
    expect(screen.getByTestId("agent-card")).toBeInTheDocument();
    expect(document.querySelector("#sec-agent")).toHaveAttribute("open");
  });

  it("does not reopen execution after user collapses it while activity continues", async () => {
    const user = userEvent.setup();
    let data = [{ id: "run-1", status: "running" }];
    listByProject.mockImplementation(() => ({ data }));
    const { rerender } = renderWorkbench();

    await user.click(screen.getByRole("tab", { name: /執行計畫/ }));
    const details = document.querySelector("#sec-agent");
    const summary = details?.querySelector("summary");
    expect(details).toHaveAttribute("open");
    expect(summary).not.toBeNull();
    await user.click(summary!);
    expect(details).not.toHaveAttribute("open");

    data = [
      { id: "run-1", status: "running" },
      { id: "run-2", status: "awaiting_approval" },
    ];
    rerender(<CreationWorkbench projectId={projectId} canEdit groupId="g1" />);
    expect(details).not.toHaveAttribute("open");
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });

  it("focus=agent-run-* deep link switches to plan and flashes anchor", async () => {
    window.history.replaceState({}, "", "/project/project-1?focus=agent-run-abc123");
    renderWorkbench();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /執行計畫/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(document.querySelector("#sec-ai-hub-body")).not.toHaveAttribute("hidden");
    expect(document.querySelector("#sec-agent")).toHaveAttribute("open");
    await waitFor(() => {
      expect(flashAnchor).toHaveBeenCalledWith("agent-run-abc123");
    });
  });

  it("ignores non agent-run focus query params", () => {
    window.history.replaceState({}, "", "/project/project-1?focus=generation-xyz");
    renderWorkbench();

    expect(screen.getByRole("tab", { name: /問 AI/ })).toHaveAttribute("aria-selected", "true");
    expect(flashAnchor).not.toHaveBeenCalled();
  });

  it.each([
    { label: "知識", anchorId: "sec-knowledge" },
    { label: "素材", anchorId: "sec-assets" },
    { label: "分鏡與交付", anchorId: "stage-deliver" },
  ] as const)("context chip $label scrolls to #$anchorId", async ({ label, anchorId }) => {
    const user = userEvent.setup();
    renderWorkbench();
    const target = document.createElement("div");
    target.id = anchorId;
    document.body.appendChild(target);

    await user.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(target.scrollIntoView).toHaveBeenCalled());
    target.remove();
  });

  it("collapse preserves mounted assistant content", async () => {
    const user = userEvent.setup();
    renderWorkbench();

    const body = document.querySelector("#sec-ai-hub-body");
    expect(body).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("assistant")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(body).toHaveAttribute("hidden");
    expect(screen.getByTestId("assistant")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展開" }));
    expect(body).not.toHaveAttribute("hidden");
  });

  it("revealWorkbenchAnchor(#sec-agent) from other mode shows plan panel (GenerationList path)", async () => {
    renderWorkbench();
    expect(screen.getByRole("tab", { name: /問 AI/ })).toHaveAttribute("aria-selected", "true");
    const hiddenPlan = document.getElementById("sec-agent")?.closest('[role="tabpanel"]');
    expect(hiddenPlan).toHaveAttribute("hidden");

    act(() => {
      revealWorkbenchAnchor("#sec-agent", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /執行計畫/ })).toHaveAttribute("aria-selected", "true");
    });
    const planPanel = screen.getByRole("tabpanel", { name: /執行計畫/ });
    expect(planPanel).not.toHaveAttribute("hidden");
    expect(document.getElementById("sec-agent")?.closest("[hidden]")).toBeNull();
    expect(document.querySelector("#sec-agent")).toHaveAttribute("open");
    await waitFor(() => {
      expect(document.getElementById("sec-agent")?.scrollIntoView).toHaveBeenCalled();
    });
  });

  it("revealWorkbenchAnchor(#sec-studio) switches to generate mode", async () => {
    renderWorkbench();
    expect(screen.getByRole("tab", { name: /問 AI/ })).toHaveAttribute("aria-selected", "true");

    act(() => {
      revealWorkbenchAnchor("#sec-studio", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /直接生成/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("tabpanel", { name: /直接生成/ })).not.toHaveAttribute("hidden");
    expect(document.getElementById("sec-studio")?.closest("[hidden]")).toBeNull();
  });

  it("revealWorkbenchAnchor(#gen-prompt) unhides generate form (onboard / deep-link path)", async () => {
    renderWorkbench();
    expect(screen.getByRole("tab", { name: /問 AI/ })).toHaveAttribute("aria-selected", "true");
    // Prompt exists but is under a hidden tabpanel while ask is active
    expect(document.getElementById("gen-prompt")?.closest("[hidden]")).not.toBeNull();

    act(() => {
      revealWorkbenchAnchor("#gen-prompt", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /直接生成/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("tabpanel", { name: /直接生成/ })).not.toHaveAttribute("hidden");
    expect(document.getElementById("gen-prompt")?.closest("[hidden]")).toBeNull();
    expect(document.getElementById("sec-studio")?.closest("[hidden]")).toBeNull();
  });

  it("revealWorkbenchAnchor(#sec-assistant) switches to ask mode", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole("tab", { name: /直接生成/ }));

    act(() => {
      revealWorkbenchAnchor("#sec-assistant", { projectId });
    });

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /問 AI/ })).toHaveAttribute("aria-selected", "true");
    });
    expect(screen.getByRole("tabpanel", { name: /問 AI/ })).not.toHaveAttribute("hidden");
    expect(document.getElementById("sec-assistant")?.closest("[hidden]")).toBeNull();
  });

  it("restored plan-mode draft does not force-open empty execution details", () => {
    saveDraft(projectId, { ...emptyDraft("plan"), goal: "restore-plan" });
    renderWorkbench();

    expect(screen.getByRole("tab", { name: /執行計畫/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("想完成什麼？")).toHaveValue("restore-plan");
    expect(document.querySelector("#sec-agent")).not.toHaveAttribute("open");
  });

  it("tab aria-controls matches tabpanel id", () => {
    renderWorkbench();
    const tab = screen.getByRole("tab", { name: /問 AI/ });
    const controls = tab.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    const panel = document.getElementById(controls!);
    expect(panel).toHaveAttribute("role", "tabpanel");
    expect(panel).not.toHaveAttribute("hidden");
  });

  it("switches draft when projectId prop changes without cross-bleed", async () => {
    saveDraft("project-1", { ...emptyDraft("ask"), goal: "goal-one" });
    saveDraft("project-2", { ...emptyDraft("generate"), goal: "goal-two" });

    const { rerender } = render(<CreationWorkbench projectId="project-1" canEdit groupId="g1" />);
    expect(screen.getByLabelText("想完成什麼？")).toHaveValue("goal-one");
    expect(screen.getByRole("tab", { name: /問 AI/ })).toHaveAttribute("aria-selected", "true");

    rerender(<CreationWorkbench projectId="project-2" canEdit groupId="g1" />);
    await waitFor(() => {
      expect(screen.getByLabelText("想完成什麼？")).toHaveValue("goal-two");
    });
    expect(screen.getByRole("tab", { name: /直接生成/ })).toHaveAttribute("aria-selected", "true");

    expect(loadDraft("project-1").goal).toBe("goal-one");
  });
});

describe("creationDraft helpers", () => {
  afterEach(() => {
    clearDraft("p-a");
    clearDraft("p-b");
  });

  it("load/save/update round-trip", () => {
    expect(loadDraft("p-a").goal).toBe("");
    saveDraft("p-a", { ...emptyDraft("ask"), goal: "hello", modelId: "m1" });
    expect(loadDraft("p-a").goal).toBe("hello");
    expect(loadDraft("p-a").modelId).toBe("m1");

    const next = updateDraft("p-a", { mode: "plan", prompt: "x" });
    expect(next.mode).toBe("plan");
    expect(next.goal).toBe("hello");
    expect(next.prompt).toBe("x");
  });

  it("isolates drafts by projectId", () => {
    saveDraft("p-a", { ...emptyDraft("ask"), goal: "alpha" });
    saveDraft("p-b", { ...emptyDraft("template"), goal: "beta" });
    expect(loadDraft("p-a").goal).toBe("alpha");
    expect(loadDraft("p-a").mode).toBe("ask");
    expect(loadDraft("p-b").goal).toBe("beta");
    expect(loadDraft("p-b").mode).toBe("template");
    updateDraft("p-a", { goal: "alpha-2" });
    expect(loadDraft("p-b").goal).toBe("beta");
  });
});
