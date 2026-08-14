import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpPage } from "./HelpPage";

vi.mock("./ModelsPage", () => ({
  ModelsPage: ({ embedded }: { embedded?: boolean }) => (
    <div data-testid="models-embed">{embedded ? "embedded-models" : "full-models"}</div>
  ),
}));

describe("HelpPage 說明中心", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("預設顯示怎麼用，可切到同一份模型指南", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/help");
    render(<HelpPage groupId="g1" />);

    expect(screen.getByRole("tab", { name: "怎麼用" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/一句話：/)).toBeInTheDocument();
    expect(screen.queryByTestId("models-embed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "模型指南" }));
    expect(screen.getByRole("tab", { name: "模型指南" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("models-embed")).toHaveTextContent("embedded-models");
    expect(window.location.hash).toBe("#help-models");
  });

  it("舊 hash／query 仍打開模型指南分頁", () => {
    window.history.replaceState(null, "", "/help#help-models");
    const { unmount } = render(<HelpPage />);
    expect(screen.getByTestId("models-embed")).toBeInTheDocument();
    unmount();

    window.history.replaceState(null, "", "/help?tab=models");
    render(<HelpPage />);
    expect(screen.getByTestId("models-embed")).toBeInTheDocument();
  });
});
