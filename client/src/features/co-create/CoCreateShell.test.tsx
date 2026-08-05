import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CoCreateShell } from "./CoCreateShell";

describe("CoCreateShell", () => {
  it("shows four progress steps and current focus", () => {
    render(
      <CoCreateShell phase="theme" onPhaseChange={() => undefined} onExit={() => undefined} />,
    );
    expect(screen.getByTestId("co-create-shell")).toBeInTheDocument();
    expect(screen.getByLabelText("共創進度")).toBeInTheDocument();
    expect(screen.getByText("定調")).toBeInTheDocument();
    expect(screen.getByText("分鏡")).toBeInTheDocument();
    expect(screen.getByText("畫面")).toBeInTheDocument();
    expect(screen.getByText("收斂")).toBeInTheDocument();
    expect(screen.getByTestId("co-create-focus")).toHaveTextContent("一句話故事");
    expect(screen.getAllByTestId("co-create-chip").length).toBeGreaterThanOrEqual(2);
  });

  it("lets advanced users jump phase via progress bar", async () => {
    const user = userEvent.setup();
    const onPhaseChange = vi.fn();
    render(
      <CoCreateShell phase="theme" onPhaseChange={onPhaseChange} onExit={() => undefined} />,
    );
    await user.click(screen.getByRole("button", { name: /分鏡/ }));
    expect(onPhaseChange).toHaveBeenCalledWith("structure");
  });

  it("exits co-create without requiring data wipe", async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<CoCreateShell phase="theme" onPhaseChange={() => undefined} onExit={onExit} />);
    await user.click(screen.getByTestId("co-create-exit"));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("picks a direction chip when editable", async () => {
    const user = userEvent.setup();
    const onPickChip = vi.fn();
    render(
      <CoCreateShell
        phase="theme"
        onPhaseChange={() => undefined}
        onExit={() => undefined}
        onPickChip={onPickChip}
      />,
    );
    await user.click(screen.getAllByTestId("co-create-chip")[0]!);
    expect(onPickChip).toHaveBeenCalled();
  });
});
