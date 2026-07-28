import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrandReveal } from "./BrandReveal";

describe("BrandReveal", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("shows children immediately when prefers-reduced-motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );

    render(
      <BrandReveal mode="fade-rise" onceKey="test-rm">
        <span>Aios</span>
      </BrandReveal>,
    );

    const el = screen.getByText("Aios").parentElement!;
    expect(el).toHaveAttribute("data-brand-reveal-phase", "to");
    // 不得因 reduced-motion 保持隱藏
    expect(el.style.opacity === "" || el.style.opacity === "1").toBe(true);
  });

  it("mode=none is static and visible", () => {
    render(
      <BrandReveal mode="none">
        <span>Logo</span>
      </BrandReveal>,
    );
    const el = screen.getByText("Logo").parentElement!;
    expect(el).toHaveAttribute("data-brand-reveal-phase", "to");
    expect(screen.getByText("Logo")).toBeVisible();
  });

  it("plays fade-rise once per onceKey and skips on remount", async () => {
    const { unmount } = render(
      <BrandReveal mode="fade-rise" onceKey="login" durationMs={100}>
        <span>First</span>
      </BrandReveal>,
    );

    const first = screen.getByText("First").parentElement!;
    expect(first).toHaveAttribute("data-brand-reveal-phase", "from");

    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    });
    expect(first).toHaveAttribute("data-brand-reveal-phase", "to");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 120));
    });
    expect(sessionStorage.getItem("aios.brandReveal.login")).toBe("1");

    unmount();
    render(
      <BrandReveal mode="fade-rise" onceKey="login" durationMs={100}>
        <span>Second</span>
      </BrandReveal>,
    );
    expect(screen.getByText("Second").parentElement).toHaveAttribute(
      "data-brand-reveal-phase",
      "to",
    );
  });

  it("keeps children in the tree even in from phase (no layout hide via unmount)", () => {
    render(
      <BrandReveal mode="fade-rise" onceKey="keep">
        <span>Always here</span>
      </BrandReveal>,
    );
    expect(screen.getByText("Always here")).toBeInTheDocument();
  });
});
