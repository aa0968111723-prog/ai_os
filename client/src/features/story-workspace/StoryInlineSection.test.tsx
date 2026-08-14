import { useState } from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoryInlineSection } from "./StoryInlineSection";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <StoryInlineSection
      sectionId="characters"
      anchorId="sec-characters"
      title="角色"
      summary="3 位・1 項待確認"
      warning="造型未齊"
      open={open}
      onOpenChange={setOpen}
    >
      <div>角色管理內容</div>
    </StoryInlineSection>
  );
}

describe("StoryInlineSection", () => {
  it("stays collapsed until toggled and keeps the legacy anchor", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.getElementById("sec-characters")).toBeTruthy();
    expect(screen.queryByText("角色管理內容")).toBeNull();
    await user.click(screen.getByRole("button", { name: /角色/ }));
    expect(screen.getByText("角色管理內容")).toBeTruthy();
    expect(screen.getByRole("button", { name: /角色/ })).toHaveAttribute("aria-expanded", "true");
  });
});
