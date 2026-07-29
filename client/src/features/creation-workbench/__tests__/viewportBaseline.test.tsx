/**
 * WB-00 / WB-01 baseline: **presence smoke only (no layout engine)**.
 *
 * jsdom does not compute CSS layout. Setting window.innerWidth / matchMedia and
 * asserting that the four workbench mode tabs + collapse control remain in the
 * document at 360 / 390 / 1280 is intentionally a presence check — it does NOT
 * prove 360px main-flow completability, grid reflow, or “固定浮動元件不遮住主要操作”.
 * Real mobile UX (FAB collision, TocNav, long-page scroll) needs Playwright/e2e
 * or CSS-computed metrics before WB-06 if required.
 *
 * Floating feedback widget lives outside CreationWorkbench (App-level FeedbackWidget at
 * fixed right/bottom, data-fb="回饋按鈕").
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreationWorkbench } from "../CreationWorkbench";
import { clearDraft } from "../creationDraft";

const listByProject = vi.fn();

vi.mock("../../../api", () => ({
  trpc: {
    useUtils: () => ({
      prompts: { list: { invalidate: vi.fn() } },
      generation: {
        listByProject: { invalidate: vi.fn() },
        listByProjectPaged: { invalidate: vi.fn() },
      },
      quota: { my: { invalidate: vi.fn() } },
      scenes: { listByProject: { invalidate: vi.fn() } },
    }),
    agents: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
      },
    },
    projects: {
      assets: { useQuery: () => ({ data: [] }) },
    },
    quota: { my: { useQuery: () => ({ data: undefined }) } },
    prompts: { save: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    scenes: { addDraft: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
    generation: {
      submit: { useMutation: () => ({ mutate: vi.fn(), isPending: false, error: null }) },
    },
  },
}));

vi.mock("../../../components/ProjectAssistant", () => ({
  ProjectAssistant: () => <div data-testid="assistant">assistant</div>,
}));

vi.mock("../../../components/AgentCard", () => ({
  AgentCard: () => <div data-testid="agent-card">agent-card</div>,
}));

vi.mock("../../../components/WorkflowCard", () => ({
  WorkflowCard: () => <div data-testid="workflow-card">workflow-card</div>,
}));

vi.mock("../../../components/ModelPicker", () => ({
  ModelPicker: () => <div data-testid="model-picker">model-picker</div>,
}));

vi.mock("../../../components/GenerationList", () => ({
  GenerationList: () => <div data-testid="generation-list">generation-list</div>,
}));

vi.mock("../../../realtime", () => ({
  CollabZone: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  // jsdom matchMedia stub only — does not drive real CSS layout
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const min = /min-width:\s*(\d+)/.exec(query);
    const max = /max-width:\s*(\d+)/.exec(query);
    let matches = true;
    if (min) matches = matches && width >= Number(min[1]);
    if (max) matches = matches && width <= Number(max[1]);
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  });
  window.dispatchEvent(new Event("resize"));
}

const TAB_NAMES = [/問 AI/, /直接生成/, /製作範本/, /執行計畫/] as const;

describe("viewport presence smoke — CreationWorkbench shell (no layout engine)", () => {
  beforeEach(() => {
    listByProject.mockReset();
    listByProject.mockReturnValue({ data: [] });
    clearDraft("project-1");
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    setViewportWidth(1024);
    clearDraft("project-1");
  });

  it.each([
    { width: 360, label: "360px phone" },
    { width: 390, label: "390px phone" },
    { width: 1280, label: "1280px desktop" },
  ] as const)(
    "presence smoke: four mode tabs + collapse control still in the document at $label",
    ({ width }) => {
      setViewportWidth(width);
      render(<CreationWorkbench projectId="project-1" canEdit />);

      expect(screen.getByRole("heading", { name: "AI 創作工作台" })).toBeInTheDocument();
      expect(screen.getByRole("tablist", { name: "AI 創作模式" })).toBeInTheDocument();
      for (const name of TAB_NAMES) {
        expect(screen.getByRole("tab", { name })).toBeInTheDocument();
      }
      expect(screen.getByRole("button", { name: "收合" })).toBeInTheDocument();
      expect(screen.getByTestId("assistant")).toBeInTheDocument();
      expect(document.getElementById("sec-ai-hub")).toBeTruthy();
      expect(document.getElementById("sec-assistant")).toBeTruthy();
      expect(document.getElementById("sec-agent")).toBeTruthy();

      // Presence only: tabs remain mounted (CSS auto-fit minmax is not evaluated in jsdom)
      const tablist = screen.getByRole("tablist", { name: "AI 創作模式" });
      expect(tablist.querySelectorAll('[role="tab"]')).toHaveLength(4);
    },
  );

  it("documents floating feedback as outside workbench (presence ownership, not collision geometry)", () => {
    // FeedbackWidget is fixed bottom-right on App shell (data-fb="回饋按鈕"), not inside workbench.
    setViewportWidth(360);
    render(<CreationWorkbench projectId="project-1" canEdit />);
    expect(document.querySelector('[data-fb="AI 創作工作台"]')).toBeTruthy();
    expect(document.querySelector('[data-fb="回饋按鈕"]')).toBeNull();
  });
});
