import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssistantInteractionCard } from "./AssistantInteractionCard";

const request = {
  interactionId: "11111111-1111-4111-8111-111111111111",
  runId: "run-1",
  goalId: "22222222-2222-4222-8222-222222222222",
  type: "SOURCE_PICKER" as const,
  title: "你要使用哪個來源？",
  description: "選擇後會接著同一個工作。",
  required: true,
  options: [
    { id: "google-drive", label: "Google Drive", availability: "AVAILABLE" as const },
    { id: "google-photos", label: "Google Photos", availability: "BLOCKED" as const, blockerReason: "尚未連線" },
    { id: "local-file", label: "本機檔案", availability: "AVAILABLE" as const },
  ],
  resumeToken: "33333333-3333-4333-8333-333333333333",
  expiresAt: "2026-09-01T00:00:00.000Z",
  expectedResultType: "selection" as const,
  status: "pending" as const,
  createdAt: "2026-08-12T00:00:00.000Z",
};

describe("AssistantInteractionCard", () => {
  it("renders honest inline source cards and submits a structured id", async () => {
    const onSelect = vi.fn();
    render(<AssistantInteractionCard request={request} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: /Google Drive/ }));
    expect(onSelect).toHaveBeenCalledWith(["google-drive"]);
    expect(screen.getByRole("button", { name: /Google Photos/ })).toBeDisabled();
    expect(screen.getByText("尚未連線")).toBeInTheDocument();
  });

  it("keeps every mobile selection target at least 44px through the CSS contract", () => {
    const css = readFileSync("client/src/styles.css", "utf8");
    expect(css).toContain(".assistant-interaction__option");
    expect(css).toMatch(/\.assistant-interaction__option\s*\{[\s\S]*?min-height:\s*56px/);
    expect(css).toMatch(/\.assistant-interaction__cancel\s*\{[\s\S]*?min-height:\s*44px/);
  });

  it("reports presentation once and keeps cancel recoverable", async () => {
    const onPresented = vi.fn();
    const onCancel = vi.fn();
    const { rerender } = render(
      <AssistantInteractionCard request={request} onPresented={onPresented} onSelect={vi.fn()} onCancel={onCancel} />,
    );
    rerender(<AssistantInteractionCard request={request} onPresented={onPresented} onSelect={vi.fn()} onCancel={onCancel} />);
    expect(onPresented).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "稍後再選" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("PROJECT_PICKER：專案選擇卡渲染可選專案並送出結構化 id", async () => {
    const onSelect = vi.fn();
    const projectPicker = {
      ...request,
      type: "PROJECT_PICKER" as const,
      title: "要放進哪個專案？",
      options: [
        { id: "p-1", label: "招生短片", subtitle: "2 個素材", availability: "AVAILABLE" as const },
        { id: "p-2", label: "挑戰營回顧", availability: "AVAILABLE" as const },
      ],
    };
    render(<AssistantInteractionCard request={projectPicker} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /招生短片/ })).toBeInTheDocument();
    expect(screen.getByText("2 個素材")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /招生短片/ }));
    expect(onSelect).toHaveBeenCalledWith(["p-1"]);
  });

  it("FILE_PICKER／FOLDER_PICKER：資料夾與檔案來源也走同一張選擇卡", async () => {
    const onSelect = vi.fn();
    const { unmount } = render(
      <AssistantInteractionCard
        request={{
          ...request,
          type: "FILE_PICKER" as const,
          title: "選擇要加入的檔案",
          options: [
            { id: "file-1", label: "訪談逐字稿.pdf", icon: "Image", availability: "AVAILABLE" as const },
            { id: "file-2", label: "空拍素材.mov", availability: "BLOCKED" as const, blockerReason: "超過單檔上限" },
          ],
        }}
        onSelect={onSelect}
      />,
    );
    // 類型標在 DOM 上，picker 前端的後續分流（external intake mini workspace）靠它
    expect(screen.getByText("選擇要加入的檔案").closest("section")).toHaveAttribute("data-interaction-type", "FILE_PICKER");
    expect(screen.getByRole("button", { name: /空拍素材.mov/ })).toBeDisabled();
    expect(screen.getByText("超過單檔上限")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /訪談逐字稿.pdf/ }));
    expect(onSelect).toHaveBeenCalledWith(["file-1"]);
    unmount();

    render(
      <AssistantInteractionCard
        request={{
          ...request,
          type: "FOLDER_PICKER" as const,
          title: "選擇要匯入的資料夾",
          options: [{ id: "dir-1", label: "北藝素材", availability: "AVAILABLE" as const }],
        }}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /北藝素材/ }));
    expect(onSelect).toHaveBeenLastCalledWith(["dir-1"]);
  });

  it("沒有可選項目時誠實說「目前沒有可選項目。」，不給假按鈕", () => {
    render(<AssistantInteractionCard request={{ ...request, options: [] }} onSelect={vi.fn()} />);
    expect(screen.getByText("目前沒有可選項目。")).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("busy 時全部選項與取消都停用，避免同一互動重複送出", () => {
    render(<AssistantInteractionCard request={request} busy onSelect={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Google Drive/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "稍後再選" })).toBeDisabled();
  });
});
