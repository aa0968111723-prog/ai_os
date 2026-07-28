import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiHub } from "./AiHub";

const listByProject = vi.fn();

vi.mock("../api", () => ({
  trpc: {
    agents: {
      listByProject: {
        useQuery: (...args: unknown[]) => listByProject(...args),
      },
    },
  },
}));

vi.mock("./ProjectAssistant", () => ({
  ProjectAssistant: () => <div data-testid="assistant">assistant</div>,
}));

vi.mock("./AgentCard", () => ({
  AgentCard: () => <div data-testid="agent-card">agent-card</div>,
}));

describe("AiHub", () => {
  const renderAiHub = (props = {}) => render(<AiHub projectId="project-1" canEdit {...props} />);
  beforeEach(() => {
    listByProject.mockReset();
    listByProject.mockReturnValue({ data: [] });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("presents one creation workbench with routes into the existing systems", async () => {
    const user = userEvent.setup();
    renderAiHub();

    expect(screen.getByRole("heading", { name: "AI 創作工作台" })).toBeVisible();
    expect(screen.getByRole("navigation", { name: "AI 創作開始方式" })).toBeVisible();
    expect(screen.getByRole("button", { name: /問 AI/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /直接生成/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /製作範本/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /執行計畫/ })).toBeVisible();
    expect(screen.getByRole("group", { name: "AI 創作工作台可連動的專案系統" })).toBeVisible();

    const generationTarget = document.createElement("div");
    generationTarget.id = "sec-studio";
    document.body.appendChild(generationTarget);
    await user.click(screen.getByRole("button", { name: /直接生成/ }));
    await waitFor(() => expect(generationTarget.scrollIntoView).toHaveBeenCalled());
    generationTarget.remove();

    const details = document.querySelector("#sec-agent");
    expect(details).not.toHaveAttribute("open");
    await user.click(screen.getByRole("button", { name: /執行計畫/ }));
    await waitFor(() => expect(details).toHaveAttribute("open"));
  });

  it("collapses the whole embedded AI area while preserving mounted content", async () => {
    const user = userEvent.setup();
    renderAiHub();

    const body = document.querySelector("#sec-ai-hub-body");
    expect(body).not.toHaveAttribute("hidden");
    expect(screen.getByTestId("assistant")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(body).toHaveAttribute("hidden");
    expect(screen.getByText(/AI 創作工作台已收合/)).toBeVisible();
    expect(screen.getByTestId("assistant")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展開" }));
    expect(body).not.toHaveAttribute("hidden");
  });

  it("shows running and approval counts and opens the execution area", () => {
    listByProject.mockReturnValue({
      data: [
        { id: "run-1", status: "running" },
        { id: "run-2", status: "awaiting_approval" },
      ],
    });
    renderAiHub();

    expect(screen.getAllByText("執行中 1")).toHaveLength(2);
    expect(screen.getAllByText("待核准 1")).toHaveLength(2);
    expect(document.querySelector("#sec-agent")).toHaveAttribute("open");
  });

  it("does not reopen an active execution area after the user collapses it", async () => {
    const user = userEvent.setup();
    let data = [{ id: "run-1", status: "running" }];
    listByProject.mockImplementation(() => ({ data }));
    const { rerender } = renderAiHub();
    const details = document.querySelector("#sec-agent");
    const summary = details?.querySelector("summary");

    expect(details).toHaveAttribute("open");
    expect(summary).not.toBeNull();
    await user.click(summary!);
    expect(details).not.toHaveAttribute("open");

    // A polling update within the same active episode must preserve the user's choice.
    data = [
      { id: "run-1", status: "running" },
      { id: "run-2", status: "awaiting_approval" },
    ];
    rerender(<AiHub projectId="project-1" canEdit />);
    expect(details).not.toHaveAttribute("open");
    expect(summary).toHaveAttribute("aria-expanded", "false");
  });

  it("auto-opens for a new activity episode and resets disclosure state per project", async () => {
    let dataByProject: Record<string, Array<{ id: string; status: string }>> = {
      "project-1": [],
      "project-2": [{ id: "run-2", status: "awaiting_approval" }],
    };
    listByProject.mockImplementation(({ projectId }: { projectId: string }) => ({
      data: dataByProject[projectId],
    }));
    const { rerender } = renderAiHub();
    const details = document.querySelector("#sec-agent");

    expect(details).not.toHaveAttribute("open");

    dataByProject = {
      ...dataByProject,
      "project-1": [{ id: "run-1", status: "running" }],
    };
    rerender(<AiHub projectId="project-1" canEdit />);
    await waitFor(() => expect(details).toHaveAttribute("open"));

    rerender(<AiHub projectId="project-2" canEdit />);
    await waitFor(() => expect(details).toHaveAttribute("open"));

    rerender(<AiHub projectId="project-3" canEdit />);
    await waitFor(() => expect(details).not.toHaveAttribute("open"));
  });
});
