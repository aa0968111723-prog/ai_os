import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccountMenu } from "./AccountMenu";

const props = {
  userName: "Bruce",
  isAdmin: false,
  activeIsLeader: false,
  canSeeOrg: false,
  onChangePw: vi.fn(),
  onNotifSettings: vi.fn(),
  onLogout: vi.fn(),
  loggingOut: false,
};

describe("AccountMenu", () => {
  it("moves focus into the menu and returns it on Escape", async () => {
    const user = userEvent.setup();
    render(<AccountMenu {...props} />);

    const trigger = screen.getByRole("button", { name: /Bruce/ });
    await user.click(trigger);
    expect(await screen.findByRole("menu", { name: "使用者選單" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "怎麼用" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "模型指南" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
