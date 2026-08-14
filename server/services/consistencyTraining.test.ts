import { describe, expect, it } from "vitest";
import { classifyAssetForTraining, falTrainerConfigured, paidTrainingAuthorized } from "./consistencyTraining";

describe("consistency training gates", () => {
  it("excludes cross-project, revoked, and unconsented AI images", () => {
    const project = "p1";
    expect(classifyAssetForTraining({
      projectId: "p2", deletedAt: null, locked: false, isAiGenerated: false, sha256: "a", kind: "image", title: "x",
    }, project).excludeReason).toBe("cross_project");
    expect(classifyAssetForTraining({
      projectId: "p1", deletedAt: new Date(), locked: false, isAiGenerated: false, sha256: "a", kind: "image", title: "x",
    }, project).excludeReason).toBe("revoked");
    expect(classifyAssetForTraining({
      projectId: "p1", deletedAt: null, locked: false, isAiGenerated: true, sha256: "a", kind: "image", title: "x",
    }, project).excludeReason).toBe("identity_wrong");
    expect(classifyAssetForTraining({
      projectId: "p1", deletedAt: null, locked: true, isAiGenerated: false, sha256: "a", kind: "image", title: "x",
    }, project).included).toBe(true);
  });

  it("does not claim a paid trainer is available in this environment", () => {
    expect(paidTrainingAuthorized()).toBe(false);
    expect(falTrainerConfigured() && paidTrainingAuthorized()).toBe(false);
  });
});
