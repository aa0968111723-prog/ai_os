import { describe, expect, it } from "vitest";
import {
  CUTOS_PROTOCOL_VERSION,
  CUTOS_SUPPORTED_PROTOCOLS,
  PROTOCOL_CONTRACT,
  PROTOCOL_CONTRACT_FINGERPRINT,
  argsFingerprint,
  capabilityInvocationSchema,
  capabilityResultSchema,
  checkProtocolCompatibility,
  cutosIdempotencyKey,
  isRetryableCutosError,
  protocolContractFingerprint,
  runCorrelationSchema,
} from "./cutosProtocol";

describe("protocol version", () => {
  it("is cutos.agent.v2 and still advertises v1", () => {
    expect(CUTOS_PROTOCOL_VERSION).toBe("cutos.agent.v2");
    expect(CUTOS_SUPPORTED_PROTOCOLS).toContain("cutos.agent.v1");
  });

  it("negotiates the newest shared version", () => {
    const result = checkProtocolCompatibility("cutos.agent.v2", ["cutos.agent.v1"]);
    expect(result.compatible).toBe(true);
    expect(result.negotiated).toBe("cutos.agent.v2");
  });

  it("falls back to v1 when the peer only speaks v1", () => {
    const result = checkProtocolCompatibility("cutos.agent.v1", []);
    expect(result.compatible).toBe(true);
    expect(result.negotiated).toBe("cutos.agent.v1");
  });

  it("fails loudly — never silently — on an unknown protocol", () => {
    const result = checkProtocolCompatibility("cutos.agent.v9", ["cutos.agent.v8"]);
    expect(result.compatible).toBe(false);
    expect(result.code).toBe("PROTOCOL_VERSION_MISMATCH");
    expect(result.messageKey).toBe("aios.protocol.mismatch");
  });

  it("fails when the peer reports no version at all", () => {
    const result = checkProtocolCompatibility(undefined, undefined);
    expect(result.compatible).toBe(false);
    expect(result.code).toBe("PROTOCOL_VERSION_UNKNOWN");
  });
});

describe("cross-repo contract fingerprint", () => {
  it("matches the constant mirrored in aa0968111723-prog/CUTOS", () => {
    expect(protocolContractFingerprint()).toBe(PROTOCOL_CONTRACT_FINGERPRINT);
  });

  it("changes when the contract changes", () => {
    const before = protocolContractFingerprint();
    const mutated = { ...PROTOCOL_CONTRACT, version: "cutos.agent.v3" };
    expect(JSON.stringify(mutated)).not.toBe(JSON.stringify(PROTOCOL_CONTRACT));
    expect(before).toBe(PROTOCOL_CONTRACT_FINGERPRINT);
  });

  it("lists every capability both repos require", () => {
    expect(PROTOCOL_CONTRACT.requiredCapabilities).toContain("search_semantic");
    expect(PROTOCOL_CONTRACT.requiredCapabilities).toContain("apply_edit_plan");
    expect(PROTOCOL_CONTRACT.requiredCapabilities).toContain("resume_agent_run");
  });
});

describe("runtime validation", () => {
  it("rejects an invocation missing the correlation requestId", () => {
    const parsed = capabilityInvocationSchema.safeParse({
      protocolVersion: "cutos.agent.v2",
      capability: "get_project",
      args: { projectId: "p1" },
      correlation: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts a minimal valid invocation", () => {
    const parsed = capabilityInvocationSchema.safeParse({
      protocolVersion: "cutos.agent.v2",
      capability: "get_project",
      args: { projectId: "p1" },
      correlation: { requestId: "req-1" },
    });
    expect(parsed.success).toBe(true);
  });

  it("requires createdAt/updatedAt on a full correlation", () => {
    expect(runCorrelationSchema.safeParse({ requestId: "r" }).success).toBe(false);
    expect(runCorrelationSchema.safeParse({
      requestId: "r",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }).success).toBe(true);
  });

  it("defaults activity and replayed on a result", () => {
    const parsed = capabilityResultSchema.parse({
      protocolVersion: "cutos.agent.v2",
      capability: "get_project",
      ok: true,
      result: {},
      correlation: {
        requestId: "r",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(parsed.activity).toEqual([]);
    expect(parsed.replayed).toBe(false);
  });
});

describe("idempotency key derivation", () => {
  it("is stable for the same logical effect", () => {
    const key = () => cutosIdempotencyKey({
      aiosRunId: "run-1",
      aiosStepId: "step-2",
      capability: "apply_edit_plan",
      cutosProjectId: "proj-9",
      argsFingerprint: argsFingerprint({ projectId: "proj-9" }),
    });
    expect(key()).toBe(key());
    expect(key()).toContain("cutos.v2:run-1:step-2:apply_edit_plan:proj-9:");
  });

  it("differs when the arguments differ", () => {
    const base = { aiosRunId: "r", aiosStepId: "s", capability: "apply_edit_plan", cutosProjectId: "p" };
    expect(cutosIdempotencyKey({ ...base, argsFingerprint: argsFingerprint({ a: 1 }) }))
      .not.toBe(cutosIdempotencyKey({ ...base, argsFingerprint: argsFingerprint({ a: 2 }) }));
  });

  it("hashes arguments order-independently", () => {
    expect(argsFingerprint({ a: 1, b: 2 })).toBe(argsFingerprint({ b: 2, a: 1 }));
  });
});

describe("retry classification", () => {
  it("treats a stale revision as non-retryable — the caller must replan", () => {
    expect(isRetryableCutosError("STALE_TIMELINE_REVISION")).toBe(false);
  });

  it("treats an in-flight duplicate effect as retryable", () => {
    expect(isRetryableCutosError("IDEMPOTENCY_IN_PROGRESS")).toBe(true);
  });
});
