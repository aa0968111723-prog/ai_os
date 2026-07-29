/**
 * WB-00 baseline: key AI workbench interactive controls remain present at
 * 360px / 390px (mobile) and 1280px (desktop). No layout redesign — smoke only.
 *
 * Floating feedback widget lives outside AiHub (App-level FeedbackWidget at
 * fixed right/bottom). Long-page scroll vs floating feedback collision is a
 * ProjectPage shell concern; documented here so later PRs do not regress the
 * workbench route buttons themselves.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiHub } from "../../../components/AiHub";

const listByProject = vi.fn();

vi.mock("../../../api", () => ({
  trpc: {
    agents: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
      },
    },
  },
}));

vi.mock("../../../components/ProjectAssistant", () => ({
  ProjectAssistant: () => <div data-testid="assistant">assistant</div>,
}));

vi.mock("../../../components/AgentCard", () => ({
  AgentCard: () => <div data-testid="agent-card">agent-card</div>,
}));

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
  // jsdom matchMedia stub: callers that branch on min-width still resolve
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

const ROUTE_NAMES = [
  "問 AI 問答、發想、拆分鏡",
  "直接生成 圖片、影片、聲音",
  "製作範本 固定步驟一次串起",
  "執行計畫 多步任務、估點與核准",
] as const;

describe("viewport baseline — AiHub workbench shell", () => {
  beforeEach(() => {
    listByProject.mockReset();
    listByProject.mockReturnValue({ data: [] });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    setViewportWidth(1024);
  });

  it.each([
    { width: 360, label: "360px phone" },
    { width: 390, label: "390px phone" },
    { width: 1280, label: "1280px desktop" },
  ] as const)("keeps all four start routes and collapse control in document at $label", ({ width }) => {
    setViewportWidth(width);
    render(<AiHub projectId="project-1" canEdit />);

    expect(screen.getByRole("heading", { name: "AI 創作工作台" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "AI 創作開始方式" })).toBeInTheDocument();
    for (const name of ROUTE_NAMES) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "收合" })).toBeInTheDocument();
    expect(screen.getByTestId("assistant")).toBeInTheDocument();
    expect(document.getElementById("sec-ai-hub")).toBeTruthy();
    expect(document.getElementById("sec-assistant")).toBeTruthy();
    expect(document.getElementById("sec-agent")).toBeTruthy();

    // grid uses auto-fit minmax(155px, 1fr) — at 360px columns still mount as buttons
    const nav = screen.getByRole("navigation", { name: "AI 創作開始方式" });
    expect(nav.querySelectorAll("button")).toHaveLength(4);
  });

  it("documents floating feedback as outside AiHub (no collision assertion inside hub)", () => {
    // FeedbackWidget is fixed bottom-right on App shell (data-fb="回饋按鈕"), not inside AiHub.
    // Chapter TocNav + long-page scroll vs that FAB is ProjectPage-level; later workbench
    // PRs must keep route buttons reachable without relying on feedback widget geometry.
    setViewportWidth(360);
    render(<AiHub projectId="project-1" canEdit />);
    expect(document.querySelector('[data-fb="AI 創作工作台"]')).toBeTruthy();
    expect(document.querySelector('[data-fb="回饋按鈕"]')).toBeNull();
  });
});
