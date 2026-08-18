import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

  it("studio PAGE_TERMS exposes shot / scene / character / generation tools instead of collapsing to status-only", () => {
    const tools = selectAssistantCapabilities({
      intent: "ASK",
      pageContext: { pageType: "studio", entityType: "shot" },
      allowWrite: true,
    });
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("list_scenes");
    expect(names).toContain("list_assets");
    expect(names).toContain("list_generations");
    expect(names).toContain("update_scene");
    expect(names).toContain("add_character");
    expect(names.some((name) => name.includes("scene") || name.includes("shot"))).toBe(true);
    expect(names).not.toEqual([
      "get_project_context", "get_project_status", "list_knowledge", "list_notes", "list_tasks",
    ]);
    expect(names).not.toContain("get_project_context");
    expect(names).not.toContain("add_prop");
    expect(names).not.toContain("update_prop");
  });

  it("studio PAGE_TERMS is scene/shot/character/generation/asset — shot in, prop out", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "assistantCapabilityRegistry.ts"), "utf8");
    expect(src).toContain('studio: ["scene", "shot", "character", "generation", "asset"]');
    expect(src).toContain('storyboard: ["scene", "asset", "generation", "character", "prop"]');
    const studioLine = src.split("\n").find((line) => /^\s*studio: \[/.test(line)) ?? "";
    expect(studioLine).toContain('"shot"');
    expect(studioLine).not.toContain('"prop"');
    expect(studioLine).not.toContain('"story"');
  });

  it("studio ASK / PLAN / AGENT never expose get_project_context", () => {
    for (const intent of ["ASK", "PLAN", "AGENT"] as const) {
      const names = selectAssistantCapabilities({
        intent,
        pageContext: { pageType: "studio", entityType: "shot" },
        allowWrite: true,
      }).map((tool) => tool.name);
      expect(names).not.toContain("get_project_context");
    }
  });

  it("can expose relevant writes for an authorized DIRECT request without bypassing catalog policy", () => {
    const tools = selectAssistantCapabilities({
      intent: "DIRECT",
      pageContext: { pageType: "notes" },
      allowWrite: true,
    });
    expect(tools.some((tool) => tool.access === "write" && /note|knowledge/.test(tool.name))).toBe(true);
    expect(tools.every((tool) => tool.name.includes("note") || tool.name.includes("knowledge") || tool.name.includes("decision"))).toBe(true);
  });
});
