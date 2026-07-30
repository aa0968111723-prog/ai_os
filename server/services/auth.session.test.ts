/**
 * AUTH-01：sliding session 決策純函式 + logoutAll／touchSession 契約守衛。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SESSION_DAYS,
  SESSION_SLIDE_REMAINING_DAYS,
  nextSessionExpiry,
  shouldRenewSession,
} from "./auth";

const authRouter = readFileSync(new URL("../routers/auth.ts", import.meta.url), "utf8");
const authService = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");

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
    expect(authRouter).toContain("const token = await createSession(userId)");
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

  it("service renewSessionIfNeeded is gated by shouldRenewSession (no write outside window)", () => {
    expect(authService).toContain("export async function renewSessionIfNeeded");
    expect(authService).toContain("if (!shouldRenewSession(session.expiresAt, now))");
    expect(authService).toContain("return { renewed: false, expiresAt: session.expiresAt }");
    expect(authService).toContain("export async function destroyAllUserSessions");
  });
});
