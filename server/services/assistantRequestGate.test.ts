import { describe, expect, it, beforeEach } from "vitest";
import {
  acquireAssistantRequest,
  releaseAssistantRequest,
  resetAssistantRequestGateForTests,
} from "./assistantRequestGate";

describe("assistantRequestGate", () => {
  beforeEach(() => resetAssistantRequestGateForTests());

  it("allows the first acquire and rejects a duplicate while in flight", () => {
    expect(acquireAssistantRequest("u1", "r1")).toEqual({ ok: true });
    expect(acquireAssistantRequest("u1", "r1")).toEqual({ ok: false, reason: "duplicate_in_flight" });
  });

  it("allows re-acquire after release", () => {
    expect(acquireAssistantRequest("u1", "r1")).toEqual({ ok: true });
    releaseAssistantRequest("u1", "r1");
    expect(acquireAssistantRequest("u1", "r1")).toEqual({ ok: true });
  });

  it("scopes by user and request id independently", () => {
    expect(acquireAssistantRequest("u1", "r1")).toEqual({ ok: true });
    expect(acquireAssistantRequest("u2", "r1")).toEqual({ ok: true });
    expect(acquireAssistantRequest("u1", "r2")).toEqual({ ok: true });
  });

  it("ignores missing request ids (legacy clients)", () => {
    expect(acquireAssistantRequest("u1", undefined)).toEqual({ ok: true });
    expect(acquireAssistantRequest("u1", undefined)).toEqual({ ok: true });
  });
});
