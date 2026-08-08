import { describe, expect, it } from "vitest";
import { selectAssistantCapabilities } from "./assistantCapabilityRegistry";

describe("assistant capability registry", () => {
  it("exposes a bounded page-relevant read catalog for ASK", () => {
    const tools = selectAssistantCapabilities({
      intent: "ASK",
      pageContext: { pageType: "storyboard", entityType: "shot" },
      allowWrite: false,
    });
    expect(tools.length).toBeLessThanOrEqual(18);
    expect(tools.every((tool) => tool.access === "read")).toBe(true);
    expect(tools.some((tool) => tool.name === "list_scenes")).toBe(true);
    expect(tools.some((tool) => tool.name === "list_assets")).toBe(true);
    expect(tools.some((tool) => tool.name === "list_databases")).toBe(false);
  });

  it("can expose relevant writes for an authorized ACT without bypassing catalog policy", () => {
    const tools = selectAssistantCapabilities({
      intent: "ACT",
      pageContext: { pageType: "notes" },
      allowWrite: true,
    });
    expect(tools.some((tool) => tool.access === "write" && /note|knowledge/.test(tool.name))).toBe(true);
    expect(tools.every((tool) => tool.name.includes("note") || tool.name.includes("knowledge"))).toBe(true);
  });
});
