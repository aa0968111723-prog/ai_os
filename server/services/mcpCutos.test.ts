import { describe, expect, it } from "vitest";
import { MCP_TOOLS, isMcpWriteTool, mcpToolAnnotations } from "../../shared/mcpCatalog";
import { agentToolRegistry } from "./agentToolRegistry";
import { CUTOS_TOOL_IDS } from "./cutosToolRegistry";
import {
  MCP_CUTOS_TOOLS,
  MCP_WITHHELD_CUTOS_TOOLS,
  assertNoDestructiveCutosToolExposed,
  isMcpCutosTool,
  mcpCutosToolDefinitions,
  mcpCutosToolNames,
} from "./mcpCutos";

/**
 * MCP exposure of CUTOS is governed, not a passthrough. These tests pin the
 * three properties that make it safe: a fixed allow-list, no destructive
 * capability on it, and no way for a client to name its own project.
 */

describe("MCP CUTOS exposure", () => {
  it("exposes a fixed allow-list, not the whole capability set", () => {
    expect(MCP_CUTOS_TOOLS.length).toBeGreaterThan(5);
    expect(MCP_CUTOS_TOOLS.length).toBeLessThan(CUTOS_TOOL_IDS.length);
    for (const tool of MCP_CUTOS_TOOLS) {
      expect(CUTOS_TOOL_IDS).toContain(tool.toolId);
    }
  });

  it("withholds every capability that mutates the timeline or ships a deliverable", () => {
    expect(() => assertNoDestructiveCutosToolExposed()).not.toThrow();
    const exposedIds = new Set(MCP_CUTOS_TOOLS.map((tool) => tool.toolId));
    for (const withheld of MCP_WITHHELD_CUTOS_TOOLS) {
      expect(exposedIds.has(withheld), `${withheld} must not be exposed over MCP`).toBe(false);
    }
    // Those are exactly the tools whose confirmation policy needs a human, and
    // MCP has no approval surface to satisfy it.
    for (const withheld of MCP_WITHHELD_CUTOS_TOOLS) {
      const definition = agentToolRegistry.get(withheld);
      expect(["always", "high_risk"]).toContain(definition.confirmation);
    }
  });

  it("exposes no generic invoke over MCP either", () => {
    for (const name of mcpCutosToolNames()) {
      expect(name).not.toMatch(/invoke|raw|exec|eval|shell/);
    }
  });

  it("never accepts a caller-supplied CUTOS project id", () => {
    for (const definition of mcpCutosToolDefinitions()) {
      const properties = Object.keys(
        (definition.inputSchema as { properties: Record<string, unknown> }).properties,
      );
      expect(properties).not.toContain("cutosProjectId");
      // Every tool is addressed by the AI Director project; the binding resolves
      // the video, so the client cannot pick someone else's footage.
      expect(properties).toContain("projectId");
      expect((definition.inputSchema as { additionalProperties: boolean }).additionalProperties)
        .toBe(false);
    }
  });

  it("never accepts a filesystem path, url or command", () => {
    for (const definition of mcpCutosToolDefinitions()) {
      const properties = Object.keys(
        (definition.inputSchema as { properties: Record<string, unknown> }).properties,
      );
      for (const forbidden of ["path", "filePath", "url", "uri", "command", "cwd"]) {
        expect(properties).not.toContain(forbidden);
      }
    }
  });

  it("recognises only its own tool names", () => {
    expect(isMcpCutosTool("cutos_search_semantic")).toBe(true);
    expect(isMcpCutosTool("cutos_apply_edit_plan")).toBe(false);
    expect(isMcpCutosTool("submit_generation")).toBe(false);
  });
});

describe("MCP catalog integration", () => {
  const catalogNames = new Set(MCP_TOOLS.map((tool) => tool.name));

  it("registers every exposed CUTOS tool in the shared catalog", () => {
    for (const name of mcpCutosToolNames()) {
      expect(catalogNames.has(name), `${name} is missing from shared/mcpCatalog`).toBe(true);
    }
    expect(catalogNames.has("cutos_list_activity")).toBe(true);
  });

  it("classifies the read/write split the same way the tool registry does", () => {
    for (const tool of MCP_CUTOS_TOOLS) {
      const catalog = MCP_TOOLS.find((entry) => entry.name === tool.name)!;
      expect(catalog.access).toBe(tool.access);
      // The read-only key guard reads the catalog, so a mismatch here would let
      // a read-only key start an analysis job.
      expect(isMcpWriteTool(tool.name)).toBe(tool.access === "write");
    }
  });

  it("blocks the two writes behind a read-only key", () => {
    expect(isMcpWriteTool("cutos_start_analysis")).toBe(true);
    expect(isMcpWriteTool("cutos_create_edit_plan")).toBe(true);
    expect(isMcpWriteTool("cutos_search_semantic")).toBe(false);
  });

  it("publishes honest annotations for every CUTOS tool", () => {
    for (const name of [...mcpCutosToolNames(), "cutos_list_activity"]) {
      const annotations = mcpToolAnnotations(name);
      expect(annotations, `${name} has no annotations`).not.toBeNull();
      expect(annotations!.readOnlyHint).toBe(!isMcpWriteTool(name));
      // Nothing exposed over MCP is destructive; that is the whole design.
      expect(annotations!.destructiveHint).toBe(false);
    }
  });

  it("keeps the exposed writes non-destructive by construction", () => {
    // `analyze` produces a job and `create_edit_plan` stages a plan; neither
    // touches the timeline, so neither can lose a user's work.
    for (const id of ["cutos.analysis.start", "cutos.edit.plan"]) {
      const definition = agentToolRegistry.get(id);
      expect(definition.risk).toBe("low");
      expect(definition.confirmation).toBe("never");
    }
  });
});
