import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MobileNavigation } from "./MobileNavigation";

describe("MobileNavigation", () => {
  afterEach(() => window.history.replaceState(null, "", "/"));

  it("keeps the five daily destinations reachable", () => {
    window.history.replaceState(null, "", "/planner");
    render(<MobileNavigation />);

    expect(screen.getByRole("navigation", { name: "主要功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "今日" })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: "專案" })).toHaveAttribute("href", "/dashboard#projects");
    expect(screen.getByRole("link", { name: "AI 工作" })).toHaveAttribute("href", "/dashboard#ai-work");
    expect(screen.getByRole("link", { name: "排程" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "資料" })).toHaveAttribute("href", "/databases");
  });
});
