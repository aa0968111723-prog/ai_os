/**
 * AUTH-01 / AUTH-02：sliding session 決策、裝置 meta、list/revoke 契約守衛。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SESSION_DAYS,
  SESSION_SLIDE_REMAINING_DAYS,
  SESSION_TOUCH_MIN_MS,
  hashSessionIp,
  nextSessionExpiry,
  shouldRenewSession,
  shouldTouchLastSeen,
  truncateUserAgent,
} from "./auth";

const authRouter = readFileSync(new URL("../routers/auth.ts", import.meta.url), "utf8");
const authService = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../drizzle/0012_session_device_meta.sql", import.meta.url), "utf8");

describe("AUTH-01 sliding session pure helpers", () => {
  it("does not renew when more than 7 days remain", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 8 * 86_400_000);
    expect(shouldRenewSession(expiresAt, now)).toBe(false);
  });

  it("renews when remaining lifetime is under 7 days", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const expiresAt = new Date(now.getTime() + 6 * 86_400_000);
    expect(shouldRenewSession(expiresAt, now)).toBe(true);
  });

  it("renews at the exact 7-day boundary (remaining < 7d window uses strict less-than)", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    // remaining === 7d → NOT yet in window (only when strictly under 7d)
    const atBoundary = new Date(now.getTime() + SESSION_SLIDE_REMAINING_DAYS * 86_400_000);
    expect(shouldRenewSession(atBoundary, now)).toBe(false);
    const justInside = new Date(now.getTime() + SESSION_SLIDE_REMAINING_DAYS * 86_400_000 - 1);
    expect(shouldRenewSession(justInside, now)).toBe(true);
  });

  it("nextSessionExpiry is SESSION_DAYS from now", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    const next = nextSessionExpiry(now);
    expect(next.getTime() - now.getTime()).toBe(SESSION_DAYS * 86_400_000);
  });

  it("after a renew, remaining is 30d so a follow-up should not renew (throttle without lastSeenAt)", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    const nearEnd = new Date(now.getTime() + 2 * 86_400_000);
    expect(shouldRenewSession(nearEnd, now)).toBe(true);
    const after = nextSessionExpiry(now);
    expect(shouldRenewSession(after, now)).toBe(false);
  });
});

describe("AUTH-01 logoutAll / touchSession contract", () => {
  it("exposes logoutAll that wipes all user sessions then re-mints current cookie", () => {
    expect(authRouter).toContain("logoutAll: authedProcedure.mutation");
    expect(authRouter).toContain("destroyAllUserSessions");
    expect(authRouter).toContain("await destroyAllUserSessions(userId)");
    expect(authRouter).toMatch(/createSession\(userId,\s*sessionMetaFromReq\(ctx\.req\)\)/);
    expect(authRouter).toContain("setSessionCookie(ctx.res, token)");
    // Must NOT revoke MCP on logoutAll (unlike changePassword)
    const logoutAllBlock = authRouter.slice(
      authRouter.indexOf("logoutAll: authedProcedure"),
      authRouter.indexOf("touchSession: authedProcedure"),
    );
    expect(logoutAllBlock).not.toContain("revokeAllUserMcpTokens");
  });

  it("exposes touchSession that only Set-Cookie when renewed", () => {
    expect(authRouter).toContain("touchSession: authedProcedure.mutation");
    expect(authRouter).toContain("renewSessionIfNeeded");
    expect(authRouter).toMatch(/if \(result\.renewed\)[\s\S]*setSessionCookie\(ctx\.res, token\)/);
  });

  it("service renewSessionIfNeeded gates sliding and throttles lastSeenAt", () => {
    expect(authService).toContain("export async function renewSessionIfNeeded");
    expect(authService).toContain("const renew = shouldRenewSession(session.expiresAt, now)");
    expect(authService).toContain("shouldTouchLastSeen(session.lastSeenAt, now)");
    expect(authService).toContain("export async function destroyAllUserSessions");
  });
});

describe("AUTH-02 session device meta helpers", () => {
  it("truncates user-agent to 240 chars", () => {
    expect(truncateUserAgent(null)).toBeNull();
    expect(truncateUserAgent("  ")).toBeNull();
    expect(truncateUserAgent("Chrome")).toBe("Chrome");
    const long = "x".repeat(300);
    expect(truncateUserAgent(long)?.length).toBe(240);
  });

  it("hashes IP with pepper and never returns raw IP", () => {
    const h = hashSessionIp("1.2.3.4", { SESSION_IP_PEPPER: "pepper-test", NODE_ENV: "test" });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    expect(h).not.toContain("1.2.3.4");
    const h2 = hashSessionIp("1.2.3.4", { SESSION_IP_PEPPER: "other", NODE_ENV: "test" });
    expect(h2).not.toBe(h);
    expect(hashSessionIp(null, { SESSION_IP_PEPPER: "x" })).toBeNull();
    expect(hashSessionIp("1.2.3.4", { NODE_ENV: "production" })).toBeNull();
  });

  it("throttles lastSeen touch to SESSION_TOUCH_MIN_MS", () => {
    const now = new Date("2026-07-30T12:00:00.000Z");
    expect(shouldTouchLastSeen(null, now)).toBe(true);
    expect(shouldTouchLastSeen(new Date(now.getTime() - SESSION_TOUCH_MIN_MS + 1), now)).toBe(false);
    expect(shouldTouchLastSeen(new Date(now.getTime() - SESSION_TOUCH_MIN_MS), now)).toBe(true);
  });

  it("migration adds nullable last_seen_at / user_agent / ip_hash", () => {
    expect(migration).toContain("last_seen_at");
    expect(migration).toContain("user_agent");
    expect(migration).toContain("ip_hash");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS");
  });

  it("exposes listSessions + revokeSession (scoped, no ipHash in API)", () => {
    expect(authRouter).toContain("listSessions: authedProcedure.query");
    expect(authRouter).toContain("listUserSessions");
    expect(authRouter).toContain("revokeSession: authedProcedure");
    expect(authRouter).toContain("revokeUserSession");
    expect(authService).toContain("export async function listUserSessions");
    expect(authService).toContain("export async function revokeUserSession");
    // Response shape must not include ipHash
    expect(authService).toMatch(/userAgent: r\.userAgent/);
    expect(authService).not.toMatch(/ipHash:\s*r\.ipHash/);
  });
});
