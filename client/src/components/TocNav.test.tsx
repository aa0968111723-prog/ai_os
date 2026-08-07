/**
 * WB-06 + Story-first：TocNav defaults to the four stage anchors (not per-mode AI sections).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ITEMS, LEGACY_STAGE_ALIAS, TocNav } from "./TocNav";

const STAGE_IDS = ["stage-story", "stage-board", "stage-create", "stage-deliver"];

describe("TocNav (WB-06 / Story-first)", () => {
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView as typeof HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, // desktop: nav open by default
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(_cb: IntersectionObserverCallback, _opts?: IntersectionObserverInit) {}
      },
    );
    for (const id of STAGE_IDS) {
      const el = document.createElement("div");
      el.id = id;
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    for (const id of STAGE_IDS) {
      document.getElementById(id)?.remove();
    }
  });

  it("DEFAULT_ITEMS is four stages: 故事 → 分鏡 → 製作 → 成片 (PE 計畫 §03)", () => {
    expect(DEFAULT_ITEMS).toEqual([
      { id: "stage-story", label: "① 故事" },
      { id: "stage-board", label: "② 分鏡" },
      { id: "stage-create", label: "③ 製作" },
      { id: "stage-deliver", label: "④ 成片" },
    ]);
    // 「定調」不再是必經頁面：不得回到目錄
    const ids = DEFAULT_ITEMS.map((i) => i.id);
    expect(ids).not.toContain("stage-context");
    // Must not list mode anchors as separate page sections
    expect(ids).not.toContain("sec-studio");
    expect(ids).not.toContain("sec-workflow");
    expect(ids).not.toContain("sec-agent");
    expect(ids).not.toContain("sec-assistant");
    expect(ids).not.toContain("sec-prompts");
    expect(ids).not.toContain("stage-plan");
    expect(ids).not.toContain("stage-assets");
  });

  it("legacy #stage-context deep links map to the new story stage", () => {
    // 舊書籤／推播 URL 不能斷（重構前的「① 定調」）
    expect(LEGACY_STAGE_ALIAS["stage-context"]).toBe("stage-story");
  });

  it("renders default four links and jumps to #stage-create for workbench", async () => {
    const user = userEvent.setup();
    render(<TocNav />);

    expect(screen.getByRole("button", { name: /① 故事/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /② 分鏡/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /③ 製作/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /④ 成片/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /③ 製作/ }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe("#stage-create");
  });
});
