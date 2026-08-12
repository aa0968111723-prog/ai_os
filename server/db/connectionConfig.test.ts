import { describe, expect, it } from "vitest";
import { buildPoolConfig, parseDatabaseUrl, sslOptionForTarget } from "./connectionConfig";

describe("parseDatabaseUrl", () => {
  it("reports missing URL without inventing a target", () => {
    const target = parseDatabaseUrl(undefined);
    expect(target.configured).toBe(false);
    expect(target.driver).toBe("none");
    expect(target.identityHash).toBeNull();
  });

  it("parses a loopback URL and does not require SSL", () => {
    const target = parseDatabaseUrl("postgres://aios:secret@127.0.0.1:5432/aidirector");
    expect(target.configured).toBe(true);
    expect(target.driver).toBe("postgres");
    expect(target.hostnameKind).toBe("loopback");
    expect(target.port).toBe(5432);
    expect(target.databaseNamePresent).toBe(true);
    expect(target.usernamePresent).toBe(true);
    expect(target.passwordPresent).toBe(true);
    expect(target.sslRequired).toBe(false);
    expect(target.identityHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(target)).not.toContain("secret");
  });

  it("does not force TLS for a remote host unless sslmode explicitly enables it", () => {
    const remote = parseDatabaseUrl("postgres://u:p@db.example.com:5432/app");
    expect(remote.hostnameKind).toBe("public");
    expect(remote.sslRequired).toBe(false);
    const require = parseDatabaseUrl("postgres://u:p@db.example.com:5432/app?sslmode=require");
    expect(require.sslRequired).toBe(true);
    const disabled = parseDatabaseUrl("postgres://u:p@db.example.com:5432/app?sslmode=disable");
    expect(disabled.sslRequired).toBe(false);
  });

  it("honours verify-full", () => {
    const target = parseDatabaseUrl("postgres://u:p@db.example.com/app?sslmode=verify-full");
    expect(sslOptionForTarget(target, {})).toEqual({ rejectUnauthorized: true });
  });
});

describe("buildPoolConfig", () => {
  it("keeps pool max at 10 and times out instead of waiting forever", () => {
    const cfg = buildPoolConfig("postgres://u:p@127.0.0.1:5432/aidirector", { PROCESS_ROLE: "web" });
    expect(cfg.max).toBe(10);
    expect(cfg.connectionTimeoutMillis).toBe(15_000);
    expect(cfg.idleTimeoutMillis).toBe(30_000);
    expect(cfg.application_name).toBe("aios-web");
    expect(cfg.ssl).toBeUndefined();
  });
});
