import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissInstallBanner, isInstallDismissed, isStandaloneApp } from "./pwa";
describe("pwa helpers", () => {
  afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
  it("tracks install banner dismiss", () => {
    expect(isInstallDismissed()).toBe(false);
    dismissInstallBanner();
    expect(isInstallDismissed()).toBe(true);
  });
  it("detects standalone via matchMedia", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockImplementation((q: string) => ({
      matches: q.includes("standalone"), media: q,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(), onchange: null,
    })));
    expect(isStandaloneApp()).toBe(true);
  });
});
