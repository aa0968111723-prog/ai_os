import { describe, expect, it } from "vitest";
import {
  buildExecutionReceipt,
  executionTerminalStatus,
  receiptAllowsCompletion,
} from "./executionReceipt";

describe("executionReceipt", () => {
  it("never completes while confirmation is still pending", () => {
    expect(executionTerminalStatus(1, [{ verification: { status: "verified" } }])).toBe("waiting");
  });

  it("fails when any result is not verified", () => {
    expect(executionTerminalStatus(0, [
      { verification: { status: "verified" } },
      { verification: { status: "unverified" } },
    ])).toBe("failed");
  });

  it("completes only when every result is verified and nothing is pending", () => {
    expect(executionTerminalStatus(0, [{ verification: { status: "verified" } }])).toBe("completed");
  });

  it("receiptAllowsCompletion requires verified status", () => {
    const ok = buildExecutionReceipt({
      runId: "r1",
      verificationMethod: "read_back",
      verificationStatus: "verified",
      verifiedAt: new Date().toISOString(),
    });
    const bad = buildExecutionReceipt({
      runId: "r1",
      verificationMethod: "read_back",
      verificationStatus: "unverified",
    });
    expect(receiptAllowsCompletion([ok])).toBe(true);
    expect(receiptAllowsCompletion([ok, bad])).toBe(false);
    expect(receiptAllowsCompletion([])).toBe(true);
    expect(receiptAllowsCompletion([], { requireAtLeastOne: true })).toBe(false);
  });
});
