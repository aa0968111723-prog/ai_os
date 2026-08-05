/**
 * #269：session cookie set/clear 對稱 Secure（production）
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { clearSessionCookie, setSessionCookie } from "./auth";

function mockRes() {
  const headers: string[] = [];
  return {
    append: (_name: string, value: string) => {
      headers.push(value);
    },
    headers,
  };
}

describe("session cookie Secure symmetry (#269)", () => {
  const orig = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = orig;
  });

  it("production: set and clear both include Secure", () => {
    process.env.NODE_ENV = "production";
    const set = mockRes();
    setSessionCookie(set as never, "tok");
    expect(set.headers[0]).toMatch(/Secure/);
    const clear = mockRes();
    clearSessionCookie(clear as never);
    expect(clear.headers[0]).toMatch(/Secure/);
    expect(clear.headers[0]).toMatch(/Max-Age=0/);
  });

  it("development: neither forces Secure", () => {
    process.env.NODE_ENV = "development";
    const clear = mockRes();
    clearSessionCookie(clear as never);
    expect(clear.headers[0]).not.toMatch(/Secure/);
  });
});
