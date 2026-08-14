import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoryContextSheet } from "./StoryContextSheet";

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <StoryContextSheet open={open} title="角色" onClose={() => setOpen(false)}>
      <div>既有角色卡</div>
    </StoryContextSheet>
  );
}

describe("StoryContextSheet", () => {
  it("restores the previous scroll position when closed", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const opts = args[0];
      if (typeof opts === "number") {
        Object.defineProperty(window, "scrollY", { configurable: true, value: args[1] ?? 0 });
        return;
      }
      if (opts && typeof opts === "object" && "top" in opts) {
        Object.defineProperty(window, "scrollY", { configurable: true, value: Number(opts.top) || 0 });
      }
    });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
    render(<Harness />);
    expect(screen.getByRole("dialog", { name: "角色" })).toBeTruthy();
    expect(screen.getByText("既有角色卡")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "關閉" }));
    expect(screen.queryByRole("dialog", { name: "角色" })).toBeNull();
    expect(window.scrollTo).toHaveBeenCalled();
  });
});
