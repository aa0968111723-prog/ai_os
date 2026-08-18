import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Agent intake reuses the canonical Universal Intake pipeline", () => {
  const routerSource = readFileSync(join(__dirname, "externalIntake.ts"), "utf8");
  const serviceSource = readFileSync(join(__dirname, "..", "services", "universalIntake.ts"), "utf8");

  it("delegates URL and Drive imports instead of rebuilding asset inserts in the router", () => {
    const urlBlock = routerSource.slice(
      routerSource.indexOf("importUrl: authedProcedure"),
      routerSource.indexOf("importDriveFile: authedProcedure"),
    );
    const driveBlock = routerSource.slice(
      routerSource.indexOf("importDriveFile: authedProcedure"),
      routerSource.indexOf("async function createSessionTrace"),
    );
    expect(routerSource).toContain("importUrlIntoProject");
    expect(routerSource).toContain("importDriveFileIntoProject");
    expect(urlBlock).not.toContain("schema.assets");
    expect(driveBlock).not.toContain("schema.assets");
    expect(urlBlock).not.toContain("registerIntelligenceResource");
    expect(driveBlock).not.toContain("registerIntelligenceResource");
  });

  it("hands Drive bytes to ingestTmpAsset and never exposes them to an LLM", () => {
    const driveBlock = serviceSource.slice(serviceSource.indexOf("export async function importDriveFileIntoProject"));
    expect(driveBlock).toContain("fetchDrivePickedFile");
    expect(driveBlock).toContain("ingestTmpAsset");
    expect(driveBlock).not.toMatch(/callLlm|invokeLlm|chatCompletion|responses\.create/);
  });

  it("confirming an intake onto a shot bumps scene.rev", () => {
    expect(routerSource).toContain("rev: sql`${schema.scenes.rev} + 1`");
  });

  it("registers durable Intelligence jobs without running provider analysis in the request", () => {
    expect(serviceSource).toContain("registerIntelligenceResource");
    expect(serviceSource).not.toContain("claimAndProcessIntelligenceJob");
    expect(serviceSource).not.toContain("processIntelligenceJob(");
  });
});
