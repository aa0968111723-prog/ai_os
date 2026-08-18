import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StoryboardTimeline } from "./StoryboardTimeline";
import type { StudioShot } from "./ShotStrip";

const SHOTS: StudioShot[] = [
  { id: "s1", title: "第01鏡", orderIndex: 0, durationSec: 4 },
  { id: "s2", title: "第04鏡", orderIndex: 1, durationSec: 5, assetUrl: "/a.png", assetKind: "image" },
  { id: "s3", title: "第05鏡", orderIndex: 2, durationSec: 6 },
];

function setup(overrides: Partial<React.ComponentProps<typeof StoryboardTimeline>> = {}) {
  const props = {
    shots: SHOTS,
    activeId: "s2",
    draftIds: new Set<string>(),
    canEdit: true,
    shotSizeOf: () => null,
    onSelect: vi.fn(),
    onMove: vi.fn(),
    onReorder: vi.fn(),
    onNewShot: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof StoryboardTimeline>;
  render(<StoryboardTimeline {...props} />);
  return props;
}

describe("StoryboardTimeline 複製這一鏡", () => {
  it("menu 複製 calls onDuplicate with the source shot id (not a no-op)", async () => {
    const user = userEvent.setup();
    const props = setup();
    const shot04 = screen.getAllByRole("listitem")[1]!;
    await user.click(within(shot04).getByRole("button", { name: /更多操作/ }));
    await user.click(screen.getByRole("menuitem", { name: /複製這一鏡/ }));
    expect(props.onDuplicate).toHaveBeenCalledTimes(1);
    expect(props.onDuplicate).toHaveBeenCalledWith("s2");
    expect(props.onDelete).not.toHaveBeenCalled();
  });
});
