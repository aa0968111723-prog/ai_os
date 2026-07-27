import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { PlannerSection, plannerInitialSections } from "./PlannerSection";

function Harness({ initiallyOpen = false }: { initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <PlannerSection
      open={open}
      onOpenChange={setOpen}
      contentId="planner-test-content"
      title="筆記・會議紀錄"
      lede="集中共用筆記"
      analyticsLabel="筆記卡"
      primary
    >
      <button type="button">內容操作</button>
    </PlannerSection>
  );
}

describe("PlannerSection", () => {
  it("opens only the main schedule by default and honours note/schedule deep links", () => {
    expect(plannerInitialSections(null)).toEqual({
      schedule: true,
      notes: false,
      knowledgeMap: false,
    });
    expect(plannerInitialSections("note-note-1")).toEqual({
      schedule: false,
      notes: true,
      knowledgeMap: false,
    });
    expect(plannerInitialSections("schedule-event-1")).toEqual({
      schedule: true,
      notes: false,
      knowledgeMap: false,
    });
  });

  it("starts collapsed and lets the summary expand and collapse the work area", async () => {
    const user = userEvent.setup();
    const { container } = render(<Harness />);
    const details = container.querySelector("details");
    const summary = screen.getByText("筆記・會議紀錄").closest("summary");

    expect(details).not.toHaveAttribute("open");
    expect(screen.getByText("展開")).toBeInTheDocument();
    expect(summary).toHaveAttribute("aria-controls", "planner-test-content");

    await user.click(summary!);
    expect(details).toHaveAttribute("open");
    expect(screen.getByText("收合")).toBeInTheDocument();

    await user.click(summary!);
    expect(details).not.toHaveAttribute("open");
  });

  it("supports the primary planner area being open initially", () => {
    const { container } = render(<Harness initiallyOpen />);
    expect(container.querySelector("details")).toHaveAttribute("open");
    expect(screen.getByText("主要")).toBeVisible();
    expect(screen.getByText("內容操作")).toBeInTheDocument();
  });
});
