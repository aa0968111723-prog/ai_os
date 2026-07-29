import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreationWorkbench } from "../CreationWorkbench";
import { clearDraft, loadDraft, saveDraft, emptyDraft, updateDraft } from "../creationDraft";

const listByProject = vi.fn();
const flashAnchor = vi.fn();

vi.mock("../../../api", () => ({
  trpc: {
    agents: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
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

describe("CreationWorkbench", () => {
  const projectId = "project-1";
  const originalSearch = window.location.search;

  const renderWorkbench = (props = {}) =>
    render(<CreationWorkbench projectId={projectId} canEdit {...props} />);

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

    // Other panels exist but are hidden
    const generateTab = screen.getByRole("tab", { name: /直接生成/ });
    await user.click(generateTab);
    expect(generateTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: /直接生成/ })).not.toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: /前往創作生成台/ })).toBeVisible();

    // Ask panel still mounted but hidden
    const askTab = screen.getByRole("tab", { name: /問 AI/ });
    const panels = document.querySelectorAll('[role="tabpanel"]');
    const visible = [...panels].filter((p) => !p.hasAttribute("hidden"));
    expect(visible).toHaveLength(1);
    expect(visible[0]).toHaveTextContent("前往創作生成台");
    // assistant remains in document (state-preserving mount)
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

    // draft written to storage (debounced — flush by waiting)
    await waitFor(() => {
      const stored = loadDraft(projectId);
      expect(stored.goal).toBe("拆分鏡並出圖");
      expect(stored.mode).toBe("generate");
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

  it("direct generate adapter scrolls to #sec-studio", async () => {
    const user = userEvent.setup();
    renderWorkbench();
    await user.click(screen.getByRole("tab", { name: /直接生成/ }));

    const studio = document.createElement("div");
    studio.id = "sec-studio";
    document.body.appendChild(studio);

    await user.click(screen.getByRole("button", { name: /前往創作生成台/ }));
    await waitFor(() => expect(studio.scrollIntoView).toHaveBeenCalled());
    studio.remove();
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
    rerender(<CreationWorkbench projectId={projectId} canEdit />);
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
});

describe("creationDraft helpers", () => {
  afterEach(() => {
    clearDraft("p-a");
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
});
