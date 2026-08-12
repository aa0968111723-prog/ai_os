import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAssistantInteraction } from "./assistantInteractionCore";

describe("Assistant Interaction security and resumability", () => {
  it("creates a bounded durable handoff on the same run and goal", () => {
    const request = createAssistantInteraction({
      runId: "run-original",
      goalId: "11111111-1111-4111-8111-111111111111",
      type: "FILE_PICKER",
      title: "選擇檔案",
      targetProjectId: "22222222-2222-4222-8222-222222222222",
      expectedResultType: "import",
      now: new Date("2026-08-12T00:00:00.000Z"),
    });
    expect(request).toMatchObject({ runId: "run-original", goalId: "11111111-1111-4111-8111-111111111111", status: "pending" });
    expect(Date.parse(request.expiresAt)).toBeGreaterThan(Date.parse(request.createdAt));
  });

  it("keeps replay rejection, advisory serialization, ACL and provenance read-back in the callback path", () => {
    const source = readFileSync("server/services/assistantInteractionCore.ts", "utf8");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain("Stale interaction callback 已拒絕");
    expect(source).toContain("constantTimeTokenEqual");
    expect(source).toContain("assertProjectEditable");
    expect(source).toContain("provenance 與 Drive handoff 不一致");
    expect(source).toContain("libraryResources");
    expect(source).toContain("assetIntelligence");
    expect(source).toContain("alreadyRecorded");
    expect(source).toContain("interaction.cancelled");
    expect(source).toContain('request.capabilityId === "attach_asset_to_shot"');
    expect(source).toContain("attachAssetsToShotVerified");
  });
});
