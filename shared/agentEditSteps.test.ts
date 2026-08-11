import { describe, expect, it } from "vitest";
import {
  formatRevisionConflictMessage,
  isAgentEditStepKindsV1Enabled,
  isReorderAlreadyApplied,
  sceneOrderFingerprint,
  validateReorderSceneIds,
  validateUpdateScenePatch,
} from "./agentEditSteps";

describe("isAgentEditStepKindsV1Enabled", () => {
  it("defaults on and can be disabled", () => {
    expect(isAgentEditStepKindsV1Enabled({})).toBe(true);
    expect(isAgentEditStepKindsV1Enabled({ AGENT_EDIT_STEP_KINDS_V1: "0" })).toBe(false);
    expect(isAgentEditStepKindsV1Enabled({ AGENT_EDIT_STEP_KINDS_V1: "off" })).toBe(false);
  });
});

describe("validateReorderSceneIds", () => {
  const current = ["a", "b", "c"];
  it("accepts exact permutation", () => {
    expect(validateReorderSceneIds(["c", "a", "b"], current)).toEqual({ ok: true });
  });
  it("rejects duplicate / unknown / incomplete sets", () => {
    expect(validateReorderSceneIds(["a", "a", "b"], current).ok).toBe(false);
    expect(validateReorderSceneIds(["a", "b", "ghost"], current).ok).toBe(false);
    expect(validateReorderSceneIds(["a", "b"], current).ok).toBe(false);
    expect(validateReorderSceneIds(["a"], current).ok).toBe(false);
  });
});

describe("validateUpdateScenePatch", () => {
  it("rejects empty, bad duration, bad trim", () => {
    expect(validateUpdateScenePatch({}).ok).toBe(false);
    expect(validateUpdateScenePatch({ durationSec: 0 }).ok).toBe(false);
    expect(validateUpdateScenePatch({ trimStartMs: 1000, trimEndMs: 500 }).ok).toBe(false);
  });
  it("accepts whitelist fields", () => {
    const r = validateUpdateScenePatch({ voiceover: "hi", durationSec: 4, trimStartMs: 0, trimEndMs: 2000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields).toContain("voiceover");
  });
});

describe("sceneOrderFingerprint / idempotent reorder", () => {
  it("fingerprint is order-sensitive", () => {
    const a = sceneOrderFingerprint([
      { id: "x", orderIndex: 0 },
      { id: "y", orderIndex: 1 },
    ]);
    const b = sceneOrderFingerprint([
      { id: "y", orderIndex: 0 },
      { id: "x", orderIndex: 1 },
    ]);
    expect(a).not.toBe(b);
    expect(isReorderAlreadyApplied(["x", "y"], ["x", "y"])).toBe(true);
    expect(isReorderAlreadyApplied(["x", "y"], ["y", "x"])).toBe(false);
  });
});

describe("formatRevisionConflictMessage", () => {
  it("mentions expected vs current without inviting overwrite", () => {
    const msg = formatRevisionConflictMessage({ expectedRev: 3, currentRev: 5 });
    expect(msg).toContain("3");
    expect(msg).toContain("5");
    expect(msg).toMatch(/重新|不會覆蓋/);
  });
});
