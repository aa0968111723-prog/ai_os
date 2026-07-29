import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissInstallBanner, isInstallDismissed, isStandaloneApp } from "./pwa";
describe("pwa helpers", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
        removeItem: (key: string) => { values.delete(key); },
        clear: () => values.clear(),
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() { return values.size; },
      } satisfies Storage,
    });
  });
  afterEach(() => { values.clear(); vi.unstubAllGlobals(); });
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
