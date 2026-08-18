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
    onInsertAfter: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof StoryboardTimeline>;
  render(<StoryboardTimeline {...props} />);
  return props;
}

describe("StoryboardTimeline empty vs loading", () => {
  it("loading + 0 shots shows 載入中, not 0 鏡 / 還沒有分鏡", () => {
    setup({ shots: [], loading: true, activeId: null });
    expect(screen.getByText("載入中")).toBeInTheDocument();
    expect(screen.getByText("正在載入分鏡…")).toBeInTheDocument();
    expect(screen.queryByText(/還沒有分鏡/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 鏡/)).not.toBeInTheDocument();
  });
});

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

  it("menu is portaled as position:fixed so 1024px height can still reach 複製", async () => {
    const user = userEvent.setup();
    setup();
    const shot04 = screen.getAllByRole("listitem")[1]!;
    await user.click(within(shot04).getByRole("button", { name: /更多操作/ }));
    const menu = screen.getByRole("menu");
    expect(menu.className).toContain("studio-menu--fixed");
    expect(document.body.contains(menu)).toBe(true);
    expect(shot04.contains(menu)).toBe(false);
  });

  it("menu 在這之後插入一鏡 calls onInsertAfter with the source shot id", async () => {
    const user = userEvent.setup();
    const props = setup();
    const shot04 = screen.getAllByRole("listitem")[1]!;
    await user.click(within(shot04).getByRole("button", { name: /更多操作/ }));
    await user.click(screen.getByRole("menuitem", { name: /在這之後插入一鏡/ }));
    expect(props.onInsertAfter).toHaveBeenCalledWith("s2");
    expect(props.onDuplicate).not.toHaveBeenCalled();
  });
});
