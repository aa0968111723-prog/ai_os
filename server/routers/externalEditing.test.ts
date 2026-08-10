import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("External Editing Bridge server safety contract", () => {
  const routerSource = readFileSync(join(__dirname, "externalEditing.ts"), "utf8");
  const serviceSource = readFileSync(join(__dirname, "..", "services", "externalEditingBridge.ts"), "utf8");
  const serverSource = readFileSync(join(__dirname, "..", "index.ts"), "utf8");
  const intakeSource = readFileSync(join(__dirname, "..", "services", "universalIntake.ts"), "utf8");

  it("exposes preview, persistent prepare, lifecycle and expiry recovery mutations", () => {
    for (const name of ["preview", "prepare", "list", "markHandedOff", "reprepare", "cancel", "complete"]) {
      expect(routerSource).toContain(`${name}: authedProcedure`);
    }
    expect(serviceSource).toContain("externalEditingSessions");
    expect(serviceSource).toContain("externalEditingPackages");
    expect(serviceSource).toContain("EDITING_PACKAGE_TTL_HOURS");
  });

  it("keeps PRIMARY_MEDIA stronger than Context reference roles", () => {
    expect(serviceSource).toContain("const roleRank: Record<EditingAssetRole, number>");
    expect(serviceSource).toContain("PRIMARY_MEDIA: 100");
    expect(serviceSource).toContain("roleRank[candidate.role] > roleRank[current.role]");
    expect(serviceSource).toContain('ref.source !== "AI_SUGGESTED"');
    expect(serviceSource).toContain("packagedContextAssetIds");
    expect(serviceSource).toContain("resolveOrAskAgentQuestion");
  });

  it("authorizes the ZIP route and fails closed for revoked, expired or unlanded assets", () => {
    const block = serverSource.slice(serverSource.indexOf('/api/editing-packages/:packageId/download'));
    expect(block).toContain("auth.groups.some");
    expect(block).toContain("revokedAt");
    expect(block).toContain("expiresAt");
    expect(block).toContain("openStoredReadStream");
    expect(block).toContain("aios-manifest.json");
    expect(block).not.toContain("publicDeepLink");
  });

  it("returns through exact editingSessionId and records parent version lineage", () => {
    expect(intakeSource).toContain("editingSessionId");
    expect(intakeSource).toContain('? "external-editor"');
    expect(intakeSource).toContain("assetRevisions");
    expect(intakeSource).toContain("intelligenceVersionLinks");
    expect(intakeSource).toContain('status: "needs_review"');
  });
});
