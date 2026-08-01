/**
 * ConfirmButton 連按不丟單（體檢 P1-5／Mobile-First M1-4）
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./interactions";

describe("ConfirmButton multi-arm（連按不丟單）", () => {
  it("連點兩顆觸發器時兩份確認都還在，不會靜默取代", async () => {
    const user = userEvent.setup();
    const a = vi.fn();
    const b = vi.fn();
    render(
      <div>
        <ConfirmButton onConfirm={a} message="存 A">存 A</ConfirmButton>
        <ConfirmButton onConfirm={b} message="存 B">存 B</ConfirmButton>
      </div>,
    );
    await user.click(screen.getByRole("button", { name: "存 A" }));
    await user.click(screen.getByRole("button", { name: "存 B" }));
    // 兩份確認面板同時可見
    expect(screen.getByText("存 A")).toBeInTheDocument();
    expect(screen.getByText("存 B")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "確認" })).toHaveLength(2);
    await user.click(screen.getAllByRole("button", { name: "確認" })[0]);
    expect(a).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "確認" }));
    expect(b).toHaveBeenCalledTimes(1);
  });
});
