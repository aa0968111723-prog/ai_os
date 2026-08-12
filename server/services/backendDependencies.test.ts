import { describe, expect, it } from "vitest";
import { capabilityBlockedByRuntime, formatBackendDoctor, type BackendRuntimeSnapshot } from "./backendDependencies";

function snapshot(over: Partial<BackendRuntimeSnapshot> = {}): BackendRuntimeSnapshot {
  return {
    checkedAt: "2026-08-12T00:00:00.000Z",
    overall: "HEALTHY",
    ready: true,
    degraded: false,
    database: {
      configured: true, connected: true, latencyMs: 4, schemaCompatible: true, errorClass: null,
      identity: { environment: "test", gitSha: null, schemaVersion: "0070", migrationHead: "0070", databaseIdentityHash: "abc", processRole: "all" },
      pool: { totalCount: 1, idleCount: 1, waitingCount: 0 },
      target: { driver: "postgres", hostnameKind: "loopback", sslRequired: false, port: 5432 },
    },
    dependencies: [
      { id: "postgresql", required: true, configured: true, connected: true, state: "HEALTHY", latencyMs: 4, lastSuccessAt: null, lastFailureAt: null, failureClass: null },
      { id: "redis", required: false, configured: false, connected: false, state: "UNCONFIGURED", latencyMs: null, lastSuccessAt: null, lastFailureAt: null, failureClass: null },
      { id: "fal", required: true, configured: true, connected: true, state: "HEALTHY", latencyMs: null, lastSuccessAt: null, lastFailureAt: null, failureClass: null },
      { id: "google", required: false, configured: false, connected: false, state: "UNCONFIGURED", latencyMs: null, lastSuccessAt: null, lastFailureAt: null, failureClass: null },
    ],
    ...over,
  };
}

describe("backendDependencies", () => {
  it("does not leak host/password in the doctor report", () => {
    const text = formatBackendDoctor(snapshot());
    expect(text).toContain("POSTGRESQL HEALTHY");
    expect(text).toContain("OVERALL HEALTHY");
    expect(text).not.toMatch(/postgres:\/\//);
    expect(text).not.toMatch(/password/i);
  });

  it("blocks generate_media when Fal is down and Drive import when Google is missing", () => {
    const down = snapshot({
      dependencies: [
        { id: "postgresql", required: true, configured: true, connected: true, state: "HEALTHY", latencyMs: 4, lastSuccessAt: null, lastFailureAt: null, failureClass: null },
        { id: "fal", required: true, configured: true, connected: false, state: "UNHEALTHY", latencyMs: null, lastSuccessAt: null, lastFailureAt: null, failureClass: "network" },
        { id: "google", required: false, configured: false, connected: false, state: "UNCONFIGURED", latencyMs: null, lastSuccessAt: null, lastFailureAt: null, failureClass: null },
      ],
    });
    expect(capabilityBlockedByRuntime("generate_media", down)).toBe(true);
    expect(capabilityBlockedByRuntime("import_google_drive", down)).toBe(true);
    expect(capabilityBlockedByRuntime("read_assets", down)).toBe(false);
  });
});
