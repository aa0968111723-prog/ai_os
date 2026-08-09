import { describe, expect, it } from "vitest";
import { browserFallbackAllowed } from "./browserActionAdapter";

describe("browser action fallback", () => {
  it("never replaces an internal tool or connector", () => {
    expect(browserFallbackAllowed({ hasInternalTool: true, hasConnector: false, requiresUiInteraction: true })).toBe(false);
    expect(browserFallbackAllowed({ hasInternalTool: false, hasConnector: true, requiresUiInteraction: true })).toBe(false);
    expect(browserFallbackAllowed({ hasInternalTool: false, hasConnector: false, requiresUiInteraction: true })).toBe(true);
  });
});
