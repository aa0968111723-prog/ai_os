import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoryResultFix } from "./StoryResultFix";

describe("StoryResultFix", () => {
  it("does not write data until Apply, and opens the proposed section", async () => {
    const user = userEvent.setup();
    const onApplySection = vi.fn();
    render(<StoryResultFix onApplySection={onApplySection} />);
    await user.click(screen.getByRole("button", { name: "哪裡需要修改？" }));
    await user.click(screen.getByText("人物不像"));
    expect(onApplySection).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /套用建議/ }));
    expect(onApplySection).toHaveBeenCalledWith("characters");
  });
});
