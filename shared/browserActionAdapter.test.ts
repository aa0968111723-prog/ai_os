import { describe, expect, it } from "vitest";
import { browserEffectPolicy, browserFallbackAllowed } from "./browserActionAdapter";

describe("browser action fallback", () => {
  it("never replaces an internal tool or connector", () => {
    expect(browserFallbackAllowed({ hasInternalTool: true, hasConnector: false, requiresUiInteraction: true })).toBe(false);
    expect(browserFallbackAllowed({ hasInternalTool: false, hasConnector: true, requiresUiInteraction: true })).toBe(false);
    expect(browserFallbackAllowed({ hasInternalTool: false, hasConnector: false, requiresUiInteraction: true })).toBe(true);
  });
  it("allows observation/navigation but gates the exact external effect", () => {
    expect(browserEffectPolicy("observe")).toMatchObject({ allowed: true, confirmationRequired: false, risk: "read" });
    expect(browserEffectPolicy("navigate")).toMatchObject({ allowed: true, confirmationRequired: false, risk: "read" });
    expect(browserEffectPolicy("publish")).toMatchObject({ allowed: false, confirmationRequired: true, risk: "external" });
    expect(browserEffectPolicy("publish", "publish").allowed).toBe(true);
    expect(browserEffectPolicy("purchase", "submit")).toMatchObject({ allowed: false, risk: "financial" });
    expect(browserEffectPolicy("delete", "delete")).toMatchObject({ allowed: true, risk: "destructive" });
    expect(browserEffectPolicy("oauth_login_takeover")).toMatchObject({ allowed: false, risk: "identity" });
  });
});
