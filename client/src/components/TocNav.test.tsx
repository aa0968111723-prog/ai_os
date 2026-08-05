/**
 * WB-06: TocNav defaults to three stage anchors (not per-mode AI sections).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ITEMS, TocNav } from "./TocNav";

describe("TocNav (WB-06)", () => {
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
    for (const id of ["stage-context", "stage-create", "stage-deliver"]) {
      const el = document.createElement("div");
      el.id = id;
      document.body.appendChild(el);
    }
  });

  afterEach(() => {
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    for (const id of ["stage-context", "stage-create", "stage-deliver"]) {
      document.getElementById(id)?.remove();
    }
  });

  it("DEFAULT_ITEMS is three stages: 定調 → 創作 → 交付 (C3)", () => {
    expect(DEFAULT_ITEMS).toEqual([
      { id: "stage-context", label: "① 定調" },
      { id: "stage-create", label: "② 創作" },
      { id: "stage-deliver", label: "③ 交付" },
    ]);
    // Must not list mode anchors as separate page sections
    const ids = DEFAULT_ITEMS.map((i) => i.id);
    expect(ids).not.toContain("sec-studio");
    expect(ids).not.toContain("sec-workflow");
    expect(ids).not.toContain("sec-agent");
    expect(ids).not.toContain("sec-assistant");
    expect(ids).not.toContain("sec-prompts");
    expect(ids).not.toContain("stage-plan");
    expect(ids).not.toContain("stage-assets");
  });

  it("renders default three links and jumps to #stage-create for workbench", async () => {
    const user = userEvent.setup();
    render(<TocNav />);

    expect(screen.getByRole("button", { name: /① 定調/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /② 創作/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /③ 交付/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: /② 創作/ }));
    expect(scrollIntoView).toHaveBeenCalled();
    expect(window.location.hash).toBe("#stage-create");
  });
});
