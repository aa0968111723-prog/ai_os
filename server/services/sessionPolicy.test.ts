import { describe, expect, it } from "vitest";
import { sessionGate } from "./sessionPolicy";

describe("sessionGate", () => {
  it("distinguishes missing, restricted and usable sessions", () => {
    expect(sessionGate(null)).toBe("unauthenticated");
    expect(sessionGate({ user: { mustChangePassword: true } })).toBe("password-change-required");
    expect(sessionGate({ user: { mustChangePassword: false } })).toBeNull();
  });
});
