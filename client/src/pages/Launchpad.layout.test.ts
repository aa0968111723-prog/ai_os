import { afterEach, describe, expect, it } from "vitest";
import {
  LAUNCH_LAYOUT_KEY,
  loadLaunchLayout,
  saveLaunchLayout,
} from "./Launchpad";

afterEach(() => {
  try {
    localStorage.removeItem(LAUNCH_LAYOUT_KEY);
  } catch {
    /* ignore */
  }
});

describe("launchpad layout preference", () => {
  it("defaults to grid when unset or corrupt", () => {
    expect(loadLaunchLayout()).toBe("grid");
    localStorage.setItem(LAUNCH_LAYOUT_KEY, "gallery");
    expect(loadLaunchLayout()).toBe("grid");
  });

  it("round-trips list and grid", () => {
    saveLaunchLayout("list");
    expect(loadLaunchLayout()).toBe("list");
    saveLaunchLayout("grid");
    expect(loadLaunchLayout()).toBe("grid");
  });
});
