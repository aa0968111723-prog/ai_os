import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCapabilityContractReport, certificationStateForEvidence, effectiveVerificationMode } from "./agentCapabilityCertification";
import { currentDeploymentIdentity, deploymentDrift } from "./deploymentIdentity";

const fullProof = { declared: true, resolvable: true, reachable: true, executable: true, verifiable: true, useful: true };

afterEach(() => vi.unstubAllEnvs());

describe("live capability certification contract", () => {
  it("has zero dangling required handlers and never publishes an unresolved skill", () => {
    const report = buildCapabilityContractReport();
    expect(report.ready).toBe(true);
    expect(report.danglingHandlers).toEqual([]);
    expect(report.danglingSkills).toEqual([]);
    expect(report.missingCapabilities).toEqual([]);
    expect(report.skills.every((skill) => skill.resolvable)).toBe(true);
  });

  it("cannot label mock evidence as staging or live verified", () => {
    vi.stubEnv("E2E_MOCK", "1");
    expect(effectiveVerificationMode("staging")).toBe("mock");
    expect(effectiveVerificationMode("external_live")).toBe("mock");
    expect(certificationStateForEvidence(effectiveVerificationMode("production_smoke"), fullProof)).toBe("MOCK_VERIFIED");
  });

  it("rejects a client-claimed live mode when deployment identity does not prove that environment", () => {
    expect(() => effectiveVerificationMode("staging", {})).toThrow(/does not match/);
    expect(() => effectiveVerificationMode("external_live", { AGENT_CERTIFICATION_ENV: "external_live" })).toThrow(/does not match/);
    expect(effectiveVerificationMode("staging", { AGENT_CERTIFICATION_ENV: "staging" })).toBe("staging");
    expect(effectiveVerificationMode("production_smoke", {
      AGENT_CERTIFICATION_ENV: "production", NODE_ENV: "production", BUILD_SHA: "abc",
    })).toBe("production_smoke");
  });

  it("requires all six proof layers before production evidence is certified", () => {
    expect(certificationStateForEvidence("staging", { ...fullProof, useful: false })).toBe("DEGRADED");
    expect(certificationStateForEvidence("staging", fullProof)).toBe("STAGING_VERIFIED");
    expect(certificationStateForEvidence("external_live", { ...fullProof, verifiable: false })).toBe("DEGRADED");
    expect(certificationStateForEvidence("production_smoke", { ...fullProof, useful: false })).toBe("PRODUCTION_SMOKE_VERIFIED");
    expect(certificationStateForEvidence("production_smoke", fullProof)).toBe("CERTIFIED");
  });

  it("publishes a deterministic registry identity and detects expected/live drift", () => {
    const identity = currentDeploymentIdentity({ BUILD_SHA: "abc", BUILD_TIME: "now" } as NodeJS.ProcessEnv);
    expect(identity.capabilityRegistryHash).toMatch(/^[a-f0-9]{64}$/);
    expect(deploymentDrift({ sha: "abc", schemaVersion: identity.schemaVersion, capabilityRegistryHash: identity.capabilityRegistryHash }, identity).ok).toBe(true);
    expect(deploymentDrift({ sha: "other" }, identity)).toMatchObject({ ok: false, state: "DEPLOYMENT_DRIFT" });
  });
});
