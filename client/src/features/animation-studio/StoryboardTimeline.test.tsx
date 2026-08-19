import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StoryboardTimeline } from "./StoryboardTimeline";
import type { StudioShot } from "./ShotStrip";
import { mergeDuplicatedShotIntoList, runStudioDuplicateShot } from "../../lib/studioDuplicateShot";
import { LAPTOP_VIEWPORT, ZOOMED_TALL_VIEWPORT, shotMenuCoversWhiteboard } from "./placeFixedShotMenu";

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
  it("/studio/:id timeline ⋯ 複製 calls onDuplicate (not a no-op on 分鏡卡 / 單格工作室)", async () => {
    const user = userEvent.setup();
    const props = setup();
    const shot04 = screen.getAllByRole("listitem")[1]!;
    const more = within(shot04).getByRole("button", { name: /的更多操作/ });
    expect(more.className).toContain("studio-tlshot__more");
    await user.click(more);
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
    expect(screen.queryByRole("button", { name: "關閉選單" })).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /在這之後插入一鏡/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /複製這一鏡/ })).toBeInTheDocument();
  });

  it("timeline ⋯ → 複製 bumps 3→4 via insertAfter(duplicate) (fails on silent no-op)", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [rows, setRows] = useState(SHOTS);
      return (
        <>
          <p data-testid="studio-count">{rows.length} 鏡</p>
          <StoryboardTimeline
            shots={rows}
            activeId="s2"
            draftIds={new Set()}
            canEdit
            shotSizeOf={() => null}
            onSelect={vi.fn()}
            onMove={vi.fn()}
            onReorder={vi.fn()}
            onNewShot={vi.fn()}
            onInsertAfter={vi.fn()}
            onDelete={vi.fn()}
            onDuplicate={(id) => {
              void runStudioDuplicateShot({
                sceneId: id,
                insertAfter: async ({ sceneId }) => {
                  const src = rows.find((row) => row.id === sceneId);
                  if (!src) return { id: "", orderIndex: 0, title: "" };
                  return { id: "s2-copy", orderIndex: src.orderIndex + 1, title: `${src.title} 複本`, durationSec: src.durationSec };
                },
                mergeIntoCache: (sourceId, created) => {
                  setRows((prev) => mergeDuplicatedShotIntoList(prev, sourceId, created));
                },
                refresh: async () => undefined,
              });
            }}
          />
        </>
      );
    }
    render(<Harness />);
    expect(screen.getByTestId("studio-count")).toHaveTextContent("3 鏡");
    const shot04 = screen.getAllByRole("listitem")[1]!;
    await user.click(within(shot04).getByRole("button", { name: /的更多操作/ }));
    await user.click(screen.getByRole("menuitem", { name: /複製這一鏡/ }));
    expect(await screen.findByTestId("studio-count")).toHaveTextContent("4 鏡");
    expect(screen.getByText("第04鏡 複本")).toBeInTheDocument();
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

  it.each([
    { name: "1280×800", viewport: LAPTOP_VIEWPORT, triggerTop: 668 },
    { name: "zoomed/tall 2560×1320", viewport: ZOOMED_TALL_VIEWPORT, triggerTop: 1188 },
  ])("$name: 複製 bounding box is on-screen and the overlay does not cover the whiteboard", async ({ viewport, triggerTop }) => {
    const user = userEvent.setup();
    const prevW = window.innerWidth;
    const prevH = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: viewport.vw });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: viewport.vh });
    const triggerRect = {
      x: 320,
      y: triggerTop,
      top: triggerTop,
      left: 320,
      bottom: triggerTop + 24,
      right: 344,
      width: 24,
      height: 24,
      toJSON() {
        return {};
      },
    };
    const origGbr = HTMLElement.prototype.getBoundingClientRect;
    const offsetH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight");
    const offsetW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.classList?.contains("studio-tlshot__more")) return triggerRect as DOMRect;
      if (this.getAttribute("data-studio-shot-menu") === "1") {
        const top = Number.parseFloat(this.style.top || "0") || 0;
        const left = Number.parseFloat(this.style.left || "0") || 0;
        return {
          x: left,
          y: top,
          top,
          left,
          bottom: top + 120,
          right: left + 190,
          width: 190,
          height: 120,
          toJSON() {
            return {};
          },
        } as DOMRect;
      }
      if (this.getAttribute("role") === "menuitem" && (this.textContent ?? "").includes("複製這一鏡")) {
        const menu = this.closest("[data-studio-shot-menu]");
        const top = (Number.parseFloat((menu as HTMLElement | null)?.style.top ?? "0") || 0) + 40;
        const left = (Number.parseFloat((menu as HTMLElement | null)?.style.left ?? "0") || 0) + 8;
        return {
          x: left,
          y: top,
          top,
          left,
          bottom: top + 32,
          right: left + 170,
          width: 170,
          height: 32,
          toJSON() {
            return {};
          },
        } as DOMRect;
      }
      return origGbr.call(this);
    };
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return (this as HTMLElement).getAttribute?.("data-studio-shot-menu") === "1" ? 120 : 24;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      get() {
        return (this as HTMLElement).getAttribute?.("data-studio-shot-menu") === "1" ? 190 : 24;
      },
    });
    try {
      setup();
      const more = screen.getAllByRole("button", { name: /的更多操作/ })[0]!;
      expect(more).toHaveAttribute("title", "更多（插入、複製、刪除）");
      await user.click(more);
      const copy = screen.getByRole("menuitem", { name: "複製這一鏡" });
      expect(copy).toBeVisible();
      const copyBox = copy.getBoundingClientRect();
      expect(copyBox.top).toBeGreaterThanOrEqual(0);
      expect(copyBox.bottom).toBeLessThanOrEqual(viewport.vh);
      expect(copyBox.left).toBeGreaterThanOrEqual(0);
      expect(copyBox.right).toBeLessThanOrEqual(viewport.vw);
      const menu = screen.getByRole("menu");
      expect(menu.className).toContain("studio-menu--fixed");
      expect(menu.className).not.toContain("studio-menu--shot");
      expect(menu).toHaveAttribute("data-studio-shot-menu", "1");
      expect(menu.style.right).toBe("auto");
      expect(menu.style.bottom).toBe("auto");
      expect(menu.style.transform).toBe("none");
      expect(menu.style.maxWidth).toBe("240px");
      expect(menu.style.maxHeight).toBe("240px");
      expect(menu.style.borderRadius).toBe("10px");
      const menuBox = menu.getBoundingClientRect();
      expect(menuBox.width).toBeLessThanOrEqual(240);
      expect(menuBox.height).toBeLessThanOrEqual(240);
      expect(shotMenuCoversWhiteboard(
        { top: menuBox.top, left: menuBox.left, width: menuBox.width, height: menuBox.height },
        viewport,
      )).toBe(false);
      expect(document.querySelector(".studio-menu__scrim")).toBeNull();
      expect(screen.queryByRole("button", { name: "關閉選單" })).not.toBeInTheDocument();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = origGbr;
      if (offsetH) Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetH);
      if (offsetW) Object.defineProperty(HTMLElement.prototype, "offsetWidth", offsetW);
      Object.defineProperty(window, "innerWidth", { configurable: true, value: prevW });
      Object.defineProperty(window, "innerHeight", { configurable: true, value: prevH });
    }
  });

  it("Escape dismisses the shot menu (live cream ellipse ignored Escape)", async () => {
    const user = userEvent.setup();
    setup();
    const shot04 = screen.getAllByRole("listitem")[1]!;
    await user.click(within(shot04).getByRole("button", { name: /的更多操作/ }));
    expect(screen.getByRole("menuitem", { name: "複製這一鏡" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
