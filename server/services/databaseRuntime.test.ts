import { describe, expect, it } from "vitest";
import { databaseReadyNote, type DatabaseRuntimeReport } from "./databaseRuntime";

function report(over: Partial<DatabaseRuntimeReport> = {}): DatabaseRuntimeReport {
  return {
    configured: true,
    connected: true,
    latencyMs: 4,
    schemaCompatible: true,
    errorClass: null,
    identity: {
      environment: "test",
      gitSha: null,
      schemaVersion: "0070_agent_live_certification",
      migrationHead: "0070_agent_live_certification",
      databaseIdentityHash: "abc",
      processRole: "all",
    },
    pool: { totalCount: 1, idleCount: 1, waitingCount: 0 },
    target: { driver: "postgres", hostnameKind: "loopback", sslRequired: false, port: 5432 },
    ...over,
  };
}

describe("databaseReadyNote", () => {
  it("fails closed when DATABASE_URL is missing", () => {
    expect(databaseReadyNote(report({ configured: false, connected: false, errorClass: "missing_url" })).ok).toBe(false);
  });

  it("fails closed when the TCP/auth probe fails", () => {
    expect(databaseReadyNote(report({ connected: false, errorClass: "network" })).ok).toBe(false);
  });

  it("fails closed on schema mismatch even if SELECT 1 works", () => {
    expect(databaseReadyNote(report({ schemaCompatible: false })).ok).toBe(false);
  });

  it("is ready only when configured, connected and schema-compatible", () => {
    expect(databaseReadyNote(report()).ok).toBe(true);
  });
});
