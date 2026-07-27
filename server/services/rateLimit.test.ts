import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "../db";
import {
  assertRateLimitConfiguration,
  decideFailureWindow,
  decideSlidingWindow,
  deriveRateLimitIdentity,
  consumeRateLimit,
  inspectFailureBlock,
  normalizeRateLimitState,
  RATE_LIMIT_MAX_WINDOW_MS,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  RATE_LIMIT_STALE_BUCKET_MS,
  RateLimitUnavailableError,
} from "./rateLimit";

describe("rate-limit key privacy", () => {
  it("HMAC key includes scope and never stores the raw email/IP", () => {
    const env = { NODE_ENV: "production", RATE_LIMIT_SECRET: "x".repeat(32) };
    const email = "person@example.com";
    const ip = "203.0.113.42";
    const emailKey = deriveRateLimitIdentity(RATE_LIMIT_SCOPES.authEmail, email, env);
    const otherScope = deriveRateLimitIdentity(RATE_LIMIT_SCOPES.authIp, email, env);
    const ipKey = deriveRateLimitIdentity(RATE_LIMIT_SCOPES.authIp, ip, env);

    expect(emailKey.keyHash).toMatch(/^v1:[a-f0-9]{64}$/);
    expect(emailKey.keyHash).not.toContain(email);
    expect(ipKey.keyHash).not.toContain(ip);
    expect(emailKey.keyHash).not.toBe(otherScope.keyHash);
    expect(emailKey.scope).toBe("auth:email");
  });

  it("production fails closed without a strong dedicated secret; local/test has a deterministic SHA-256 fallback", () => {
    expect(() => assertRateLimitConfiguration({ NODE_ENV: "production" })).toThrow("RATE_LIMIT_SECRET");
    expect(() => assertRateLimitConfiguration({
      NODE_ENV: "production",
      RATE_LIMIT_SECRET: "x".repeat(32),
    })).not.toThrow();
    expect(() =>
      deriveRateLimitIdentity("auth:email", "person@example.com", { NODE_ENV: "production" }),
    ).toThrow("RATE_LIMIT_SECRET");
    expect(() =>
      deriveRateLimitIdentity("auth:email", "person@example.com", {
        NODE_ENV: "production",
        RATE_LIMIT_SECRET: "too-short",
      }),
    ).toThrow("至少 32");

    const first = deriveRateLimitIdentity("auth:email", "person@example.com", { NODE_ENV: "test" });
    const second = deriveRateLimitIdentity("auth:email", "person@example.com", { NODE_ENV: "test" });
    expect(first).toEqual(second);
  });
});

describe("pure sliding-window decisions", () => {
  it("allows exactly 5 email attempts per rolling 15 minutes and denied calls do not extend the window", () => {
    const start = 1_000_000;
    let state: unknown;
    for (let index = 0; index < 5; index += 1) {
      const result = decideSlidingWindow(state, start + index, RATE_LIMIT_POLICIES.authEmail);
      expect(result.decision.allowed).toBe(true);
      state = result.state;
    }
    const denied = decideSlidingWindow(state, start + 5, RATE_LIMIT_POLICIES.authEmail);
    expect(denied.decision).toMatchObject({ allowed: false, hitCount: 5 });
    expect(denied.state.hits).toHaveLength(5);

    const afterOldestExpires = decideSlidingWindow(
      denied.state,
      start + RATE_LIMIT_POLICIES.authEmail.windowMs + 1,
      RATE_LIMIT_POLICIES.authEmail,
    );
    expect(afterOldestExpires.decision.allowed).toBe(true);
  });

  it("keeps the independent IP policy at 30 attempts per rolling 15 minutes", () => {
    const start = 2_000_000;
    let state: unknown;
    for (let index = 0; index < 30; index += 1) {
      const result = decideSlidingWindow(state, start + index, RATE_LIMIT_POLICIES.authIp);
      expect(result.decision.allowed).toBe(true);
      state = result.state;
    }
    expect(decideSlidingWindow(state, start + 30, RATE_LIMIT_POLICIES.authIp).decision.allowed).toBe(false);
  });

  it("defensively normalizes malformed persisted JSON", () => {
    expect(normalizeRateLimitState({
      hits: [1, "raw", Number.NaN, 2],
      blockedUntil: "not-a-number",
      dedupeUses: 999,
    })).toEqual({ hits: [1, 2] });
  });

  it("rejects policies larger than the persisted-state safety bound", () => {
    expect(() => decideSlidingWindow(undefined, 1_000, {
      limit: 1_001,
      windowMs: 60_000,
    })).toThrow("1..1000");
  });

  it("never prunes a bucket before the longest supported window or block can expire", () => {
    expect(RATE_LIMIT_STALE_BUCKET_MS).toBeGreaterThan(RATE_LIMIT_MAX_WINDOW_MS);
  });
});

describe("MCP failure block decisions", () => {
  it("records 10 failures in one minute, then blocks for 5 minutes", () => {
    const start = 3_000_000;
    let state: unknown;
    for (let index = 0; index < 9; index += 1) {
      const result = decideFailureWindow(state, start + index, RATE_LIMIT_POLICIES.mcpFailures);
      expect(result.decision.blocked).toBe(false);
      state = result.state;
    }
    const tenth = decideFailureWindow(state, start + 9, RATE_LIMIT_POLICIES.mcpFailures);
    expect(tenth.decision).toEqual({
      blocked: true,
      hitCount: 10,
      retryAfterMs: 5 * 60_000,
    });
    expect(inspectFailureBlock(
      tenth.state,
      start + 10,
      RATE_LIMIT_POLICIES.mcpFailures.windowMs,
    ).blocked).toBe(true);
    expect(inspectFailureBlock(
      tenth.state,
      start + 9 + RATE_LIMIT_POLICIES.mcpFailures.blockMs + 1,
      RATE_LIMIT_POLICIES.mcpFailures.windowMs,
    ).blocked).toBe(false);
  });
});

describe("project assistant duplicate-request safety", () => {
  it("charges every external invocation; a repeated client nonce grants no free LLM call", () => {
    const now = 4_000_000;
    const first = decideSlidingWindow(undefined, now, RATE_LIMIT_POLICIES.projectAssistant);
    const second = decideSlidingWindow(first.state, now + 1, RATE_LIMIT_POLICIES.projectAssistant);
    expect(first.decision).toMatchObject({ allowed: true, hitCount: 1 });
    expect(second.decision).toMatchObject({ allowed: true, hitCount: 2 });
    expect(second.state.hits).toHaveLength(2);
  });
});

describe("distributed limiter wiring regression guards", () => {
  const source = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

  it("uses a transaction-scoped PostgreSQL lock plus UPSERT and has no memory fallback", () => {
    const implementation = source("./rateLimit.ts");
    expect(implementation).toContain("db.transaction");
    expect(implementation).toContain("pg_advisory_xact_lock");
    expect(implementation).toContain("hashtextextended");
    expect(implementation).toContain(".onConflictDoUpdate");
    expect(implementation).toContain("throw new RateLimitUnavailableError");
    expect(implementation).not.toMatch(/catch[\s\S]{0,200}new Map/);
    expect(implementation).not.toContain("projectAssistantNonce");
    expect(implementation).not.toContain("dedupeUses");
    expect(implementation).not.toContain("dedupeExpiresAt");
    expect(implementation).toContain("return { ...decision, deduplicated: false }");
  });

  it("removes every former process-memory cost/auth limiter and routes it through the shared service", () => {
    const files = [
      ["./auth.ts", ["const attempts = new Map", "const ipHits = new Map"]],
      ["./mcp.ts", ["const mcpFails = new Map"]],
      ["../routers/assistant.ts", ["const seenNonce = new Map", "const hits = new Map"]],
      ["../routers/teamAssistant.ts", ["const hits = new Map"]],
      ["./agentCore.ts", ["const hits = new Map"]],
      ["./messageAssistant.ts", ["const assistantHits = new Map"]],
      ["./dmAssistant.ts", ["const hits = new Map"]],
      ["../routers/director.ts", ["const suggestHits = new Map"]],
      ["../routers/knowledge.ts", ["const describeHits = new Map"]],
      ["./integrations.ts", ["const apiFetchWindow = new Map"]],
    ] as const;
    for (const [file, forbidden] of files) {
      const implementation = source(file);
      expect(implementation, file).toContain("rateLimit");
      for (const pattern of forbidden) expect(implementation, `${file}: ${pattern}`).not.toContain(pattern);
    }
  });

  it("checks and clears login/MCP buckets asynchronously", () => {
    const auth = source("./auth.ts");
    const authRouter = source("../routers/auth.ts");
    const mcp = source("./mcp.ts");
    expect(auth).toContain("export async function checkLoginRate");
    expect(auth).toContain("export async function clearLoginRate");
    expect(authRouter).toContain("await guardedAuthRateLimit(() => checkLoginRate");
    expect(authRouter).toContain("await guardedAuthRateLimit(() => clearLoginRate");
    expect(mcp).toContain("await inspectFailureRateLimit");
    expect(mcp).toContain("await recordRateLimitFailure");
    expect(mcp).toContain("await clearRateLimit");
  });

  it("runs the production secret preflight before the server starts listening", () => {
    const index = source("../index.ts");
    expect(index.indexOf("assertRateLimitConfiguration()")).toBeGreaterThan(-1);
    expect(index.indexOf("assertRateLimitConfiguration()")).toBeLessThan(index.indexOf(".listen("));
  });

  it("fails closed when PostgreSQL is unavailable instead of falling back to process memory", async () => {
    const execute = vi.spyOn(db, "execute").mockRejectedValueOnce(new Error("database offline"));
    await expect(
      consumeRateLimit("test:db-failure", "subject", { limit: 1, windowMs: 1_000 }),
    ).rejects.toBeInstanceOf(RateLimitUnavailableError);
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockRestore();
  });
});
