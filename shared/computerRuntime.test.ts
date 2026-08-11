import { describe, expect, it } from "vitest";
import {
  canAcceptComputerAction,
  canAcceptHumanControl,
  isComputerArtifactIngestionEnabled,
  isComputerBrowserEnabled,
  isComputerDesktopEnabled,
  isComputerHumanTakeoverEnabled,
  isComputerRuntimeEnabled,
  isComputerSessionTerminal,
  selectRuntimeRoute,
  validateDesktopAction,
  formatDesktopEscalationReason,
} from "./computerRuntime";
import {
  mapProviderErrorToCode,
  redactSensitiveActionText,
  validateComputerNavigationUrl,
} from "./computerRuntimePolicy";

describe("computer runtime flags", () => {
  it("defaults off", () => {
    expect(isComputerRuntimeEnabled({})).toBe(false);
    expect(isComputerBrowserEnabled({})).toBe(false);
    expect(isComputerHumanTakeoverEnabled({})).toBe(false);
    expect(isComputerArtifactIngestionEnabled({})).toBe(false);
    expect(isComputerDesktopEnabled({})).toBe(false);
    expect(isComputerDesktopEnabled({ COMPUTER_RUNTIME_ENABLED: "1", COMPUTER_DESKTOP_ENABLED: "1" })).toBe(true);
    expect(isComputerBrowserEnabled({ COMPUTER_RUNTIME_ENABLED: "1" })).toBe(true);
    expect(isComputerHumanTakeoverEnabled({ COMPUTER_RUNTIME_ENABLED: "1" })).toBe(true);
    expect(isComputerArtifactIngestionEnabled({ COMPUTER_RUNTIME_ENABLED: "1" })).toBe(true);
    expect(isComputerBrowserEnabled({ COMPUTER_RUNTIME_ENABLED: "1", COMPUTER_BROWSER_ENABLED: "0" })).toBe(false);
    expect(isComputerHumanTakeoverEnabled({
      COMPUTER_RUNTIME_ENABLED: "1",
      COMPUTER_HUMAN_TAKEOVER_ENABLED: "0",
    })).toBe(false);
  });
});

describe("session state guards", () => {
  it("terminal and action acceptance", () => {
    expect(isComputerSessionTerminal("stopped")).toBe(true);
    expect(canAcceptComputerAction("agent_control", "agent")).toBe(true);
    expect(canAcceptComputerAction("agent_control", "human")).toBe(false);
    expect(canAcceptComputerAction("human_control", "human")).toBe(false);
    expect(canAcceptComputerAction("waiting_human", "none")).toBe(false);
    expect(canAcceptComputerAction("stopped", "agent")).toBe(false);
    expect(canAcceptComputerAction("ready", "none")).toBe(true);
    expect(canAcceptHumanControl("human_control", "human")).toBe(true);
    expect(canAcceptHumanControl("waiting_human", "none")).toBe(true);
    expect(canAcceptHumanControl("agent_control", "agent")).toBe(false);
  });
});

describe("runtime router", () => {
  it("prefers native then browser DOM", () => {
    expect(selectRuntimeRoute({
      hasNativeTool: true, needsDesktopGui: false, needsHumanLoginOrChallenge: false, hasStableDom: true,
    }).route).toBe("native_tool");
    expect(selectRuntimeRoute({
      hasNativeTool: false, needsDesktopGui: false, needsHumanLoginOrChallenge: false, hasStableDom: true,
    }).route).toBe("browser_dom");
    expect(selectRuntimeRoute({
      hasNativeTool: false, needsDesktopGui: false, needsHumanLoginOrChallenge: true, hasStableDom: true,
    }).route).toBe("human_takeover");
    expect(selectRuntimeRoute({
      hasNativeTool: false, needsDesktopGui: true, needsHumanLoginOrChallenge: false, hasStableDom: false,
    }).route).toBe("vision_computer_use");
  });
});

describe("desktop action validation", () => {
  it("accepts normalized coords and rejects shell-like keys", () => {
    expect(validateDesktopAction({ kind: "click", x: 10, y: 20 }).ok).toBe(true);
    expect(validateDesktopAction({ kind: "click", x: -1, y: 0 }).ok).toBe(false);
    expect(formatDesktopEscalationReason("canvas_or_unstable_dom")).toMatch(/DOM/);
  });
});

describe("navigation policy SSRF", () => {
  it("allows public https and blocks private/metadata", () => {
    expect(validateComputerNavigationUrl("https://example.com/path").ok).toBe(true);
    expect(validateComputerNavigationUrl("http://example.com").ok).toBe(false);
    expect(validateComputerNavigationUrl("https://127.0.0.1/").ok).toBe(false);
    expect(validateComputerNavigationUrl("https://169.254.169.254/latest").ok).toBe(false);
    expect(validateComputerNavigationUrl("https://10.0.0.5/").ok).toBe(false);
    expect(validateComputerNavigationUrl("https://localhost/").ok).toBe(false);
    expect(validateComputerNavigationUrl("https://user:pass@example.com/").ok).toBe(false);
    expect(validateComputerNavigationUrl("file:///etc/passwd").ok).toBe(false);
  });

  it("redacts sensitive action text", () => {
    expect(redactSensitiveActionText("secret", true).safeTarget).toContain("redacted");
    expect(redactSensitiveActionText("hello", false).safeTarget).toBe("hello");
  });

  it("maps provider errors", () => {
    expect(mapProviderErrorToCode("Timeout waiting")).toBe("COMPUTER_ACTION_TIMEOUT");
    expect(mapProviderErrorToCode("selector not found")).toBe("COMPUTER_ELEMENT_NOT_FOUND");
  });
});
