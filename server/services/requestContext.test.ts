import { describe, expect, it } from "vitest";
import { currentRequestId, normalizeRequestId, withRequestContext } from "./requestContext";

describe("requestContext", () => {
  it("keeps an accepted request id through asynchronous work", async () => {
    await withRequestContext("edge-req_123", async () => {
      await Promise.resolve();
      expect(currentRequestId()).toBe("edge-req_123");
    });
    expect(currentRequestId()).toBeUndefined();
  });

  it("rejects header injection, oversized values and unsafe arrays", () => {
    for (const bad of ["bad\nheader", "x".repeat(65), "", ["bad\nvalue"]]) {
      const generated = normalizeRequestId(bad);
      expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("uses the first safe value when a proxy supplies an array", () => {
    expect(normalizeRequestId(["proxy:request-42", "ignored"])).toBe("proxy:request-42");
  });
});
