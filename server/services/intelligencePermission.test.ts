import { describe, expect, it } from "vitest";
import { filterAiReadableResources, filterVisibleIntelligenceRows } from "./intelligenceLibrary";

describe("Intelligence Library permission boundary", () => {
  it("drops intelligence rows before vector scoring when the legacy ACL did not expose the resource", () => {
    const visible = [
      { kind: "asset" as const, rawId: "asset-visible" },
      { kind: "knowledge" as const, rawId: "knowledge-visible" },
    ];
    const rows = [
      { resourceKind: "asset", resourceId: "asset-visible", secret: false },
      { resourceKind: "asset", resourceId: "asset-other-group", secret: true },
      { resourceKind: "knowledge", resourceId: "knowledge-visible", secret: false },
    ];
    expect(filterVisibleIntelligenceRows(visible, rows)).toEqual([rows[0], rows[2]]);
  });

  it("does not treat human-visible agentAccess=none resources as AI-readable", () => {
    const readable = { id: "readable", ai: { access: "readable" as const, reason: "allowed" } };
    const hidden = { id: "hidden", ai: { access: "none" as const, reason: "owner disabled AI" } };
    expect(filterAiReadableResources([readable, hidden])).toEqual([readable]);
  });
});
