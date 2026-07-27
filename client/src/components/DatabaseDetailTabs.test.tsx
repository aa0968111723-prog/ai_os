import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DatabaseDetailTabs } from "./DatabaseDetailTabs";
import type { DatabaseDetailTab } from "./databaseTabs";

function Harness() {
  const [tab, setTab] = useState<DatabaseDetailTab>("rows");
  return <DatabaseDetailTabs value={tab} rowCount={1234} onChange={setTab} />;
}

describe("DatabaseDetailTabs", () => {
  it("changes the selected tab by click and exposes the linked panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const rows = screen.getByRole("tab", { name: "資料列 1,234" });
    const files = screen.getByRole("tab", { name: "文件" });

    expect(rows).toHaveAttribute("aria-selected", "true");
    expect(rows).toHaveAttribute("aria-controls", "database-rows-panel");
    expect(files).toHaveAttribute("tabindex", "-1");

    await user.click(files);
    expect(files).toHaveAttribute("aria-selected", "true");
    expect(files).toHaveAttribute("tabindex", "0");
    expect(rows).toHaveAttribute("aria-selected", "false");
  });

  it("moves selection and focus with arrows, Home, and End", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const rows = screen.getByRole("tab", { name: "資料列 1,234" });
    const files = screen.getByRole("tab", { name: "文件" });
    const connect = screen.getByRole("tab", { name: "同步與 API" });

    rows.focus();
    await user.keyboard("{ArrowLeft}");
    expect(connect).toHaveFocus();
    expect(connect).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{Home}");
    expect(rows).toHaveFocus();
    expect(rows).toHaveAttribute("aria-selected", "true");

    await user.keyboard("{End}");
    expect(connect).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(files).toHaveFocus();
    expect(files).toHaveAttribute("aria-selected", "true");
  });
});
