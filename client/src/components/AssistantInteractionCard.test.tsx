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
});
