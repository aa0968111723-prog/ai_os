import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ChatEmptyState, focusChatPartnerPicker } from "./ChatEmptyState";

function Harness({ scrollIntoView }: { scrollIntoView: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={(node) => {
          inputRef.current = node;
          if (node) node.scrollIntoView = scrollIntoView;
        }}
        aria-label="搜尋夥伴"
      />
      <ChatEmptyState onStart={() => focusChatPartnerPicker(inputRef.current)} />
    </>
  );
}

describe("ChatEmptyState", () => {
  it("provides a visible start action that focuses and reveals the partner picker", async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    render(<Harness scrollIntoView={scrollIntoView} />);

    const start = screen.getByRole("button", { name: "發起新對話" });
    expect(start).toHaveAttribute("aria-controls", "dm-partner-picker");
    await user.click(start);

    expect(screen.getByRole("textbox", { name: "搜尋夥伴" })).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "nearest" });
  });

  it("is safe when the picker is not mounted", () => {
    expect(() => focusChatPartnerPicker(null)).not.toThrow();
  });
});
