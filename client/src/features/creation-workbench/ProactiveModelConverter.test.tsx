import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProactiveModelConverter } from "./ProactiveModelConverter";

describe("ProactiveModelConverter", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows usable model data without any remote request", () => {
    render(<ProactiveModelConverter intent="同一角色要做六個分鏡並保持同一張臉" />);
    expect(screen.getByText("已自動配對模型、資料需求與提示詞")).toBeVisible();
    expect(screen.getByText("見證故事主角跨多個分鏡同一張臉")).toBeVisible();
    expect(screen.getByText("Nano Banana 2 Edit")).toBeVisible();
    expect(screen.getByText(/保留來源圖的人物身分/)).toBeVisible();
  });

  it("brings the converted prompt and exact model into direct generation", async () => {
    const onCreationAction = vi.fn();
    const user = userEvent.setup();
    render(<ProactiveModelConverter intent="清晨禪堂的療癒空鏡影片" onCreationAction={onCreationAction} />);
    await user.click(screen.getAllByRole("button", { name: "帶入直接生成" })[0]);
    expect(onCreationAction).toHaveBeenCalledWith(expect.objectContaining({
      type: "generate",
      draft: expect.objectContaining({
        modelId: expect.any(String),
        prompt: expect.stringContaining("鏡頭"),
      }),
    }));
  });

  it("can dismiss a scenario card and persist under projectId", async () => {
    const user = userEvent.setup();
    render(
      <ProactiveModelConverter
        intent="同一角色要做六個分鏡並保持同一張臉"
        projectId="proj-test-1"
      />,
    );
    expect(screen.getByText("見證故事主角跨多個分鏡同一張臉")).toBeVisible();
    const skipButtons = screen.getAllByRole("button", { name: "略過" });
    await user.click(skipButtons[0]);
    expect(localStorage.getItem("aios.proactive.dismissed:proj-test-1")).toBeTruthy();
  });

  it("can collapse the whole panel", async () => {
    const user = userEvent.setup();
    render(
      <ProactiveModelConverter intent="清晨禪堂的療癒空鏡影片" projectId="proj-collapse" />,
    );
    await user.click(screen.getByRole("button", { name: "收合" }));
    expect(screen.getByText(/已收合/)).toBeVisible();
    expect(localStorage.getItem("aios.proactive.collapsed:proj-collapse")).toBe("1");
  });

  it("offers plan bring-in alongside generate", async () => {
    const onCreationAction = vi.fn();
    const user = userEvent.setup();
    render(
      <ProactiveModelConverter
        intent="清晨禪堂的療癒空鏡影片"
        onCreationAction={onCreationAction}
      />,
    );
    await user.click(screen.getAllByRole("button", { name: "建立多步開拍" })[0]);
    expect(onCreationAction).toHaveBeenCalledWith(expect.objectContaining({
      type: "create_plan",
    }));
  });
});
