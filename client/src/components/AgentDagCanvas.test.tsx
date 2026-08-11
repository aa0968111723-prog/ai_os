import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AgentDagCanvas, AgentDagListFallback } from "./AgentDagCanvas";
import type { AgentDagCanvasStep } from "./AgentDagCanvas";

function step(
  id: string,
  status: AgentDagCanvasStep["status"] = "pending",
  dependsOn?: string[],
  extra: Partial<AgentDagCanvasStep> = {},
): AgentDagCanvasStep {
  return {
    id,
    note: id,
    title: id,
    status,
    dependsOn,
    executionMode: "dag",
    ...extra,
  };
}

describe("AgentDagCanvas", () => {
  it("renders dependency graph nodes and edges for a valid DAG", () => {
    render(
      <AgentDagCanvas
        steps={[
          step("root", "done"),
          step("a", "running", ["root"]),
          step("b", "pending", ["root"]),
        ]}
      />,
    );
    expect(screen.getByTestId("agent-dag")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "代理步驟依賴圖" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /root，完成/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /a，進行中/ })).toBeVisible();
  });

  it("opens step detail with rationale on click / keyboard", async () => {
    const user = userEvent.setup();
    render(
      <AgentDagCanvas
        steps={[
          step("plan", "done", undefined, { rationale: "先建立結構再生成" }),
          step("draw", "pending", ["plan"]),
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: /plan，完成/ }));
    expect(screen.getByRole("region", { name: /步驟詳情：plan/ })).toBeVisible();
    expect(screen.getByText("先建立結構再生成")).toBeVisible();
  });

  it("fail-closed: cycle shows alert list, not a broken graph", () => {
    render(
      <AgentDagCanvas
        steps={[
          step("a", "pending", ["b"]),
          step("b", "pending", ["a"]),
        ]}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/迴圈|結構/);
    expect(screen.getByRole("list", { name: "代理步驟文字流程" })).toBeVisible();
    expect(screen.queryByRole("group", { name: "代理步驟依賴圖" })).toBeNull();
  });

  it("fail-closed: missing dependency uses list fallback", () => {
    render(
      <AgentDagCanvas steps={[step("blocked", "pending", ["ghost"])]} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/不存在的前置/);
  });

  it("list fallback is keyboard selectable", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <AgentDagListFallback
        steps={[step("one", "done"), step("two", "pending", ["one"])]}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button", { name: /two，排隊/ }));
    expect(onSelect).toHaveBeenCalledWith("two");
  });

  it("can switch to text flow mode", async () => {
    const user = userEvent.setup();
    render(
      <AgentDagCanvas
        steps={[step("a", "done"), step("b", "pending", ["a"])]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "文字流程" }));
    expect(screen.getByRole("list", { name: "代理步驟文字流程" })).toBeVisible();
  });
});
