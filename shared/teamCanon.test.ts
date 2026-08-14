import { describe, expect, it } from "vitest";
import {
  CANON_VERSION_SCHEMA_VERSION,
  buildCanonDescriptorFromEntity,
  canPromoteCanonVersion,
  canonKindForLocalEntity,
  canonicalCanonVersionMaterial,
  localEntityKindForCanon,
  localFieldsForCanonKind,
  pinState,
  type CanonVersionPayload,
} from "./teamCanon";

function payload(over: Partial<CanonVersionPayload> = {}): CanonVersionPayload {
  return {
    schemaVersion: CANON_VERSION_SCHEMA_VERSION,
    kind: "character",
    name: "魯夫",
    descriptor: { appearance: "草帽、紅背心", notes: null },
    references: [
      { assetId: "a2", role: "identity", priority: "PRIMARY", rightsReady: true, sourceProjectId: "p1" },
      { assetId: "a1", role: "look", priority: "SECONDARY", rightsReady: true, sourceProjectId: "p1" },
    ],
    datasetFingerprint: null,
    adapterRef: null,
    trainingJobId: null,
    trainingKind: null,
    evaluation: null,
    ...over,
  };
}

describe("canon version material", () => {
  it("is stable across reference ordering and descriptor key ordering", () => {
    const a = canonicalCanonVersionMaterial(payload());
    const b = canonicalCanonVersionMaterial(payload({
      descriptor: { notes: null, appearance: "草帽、紅背心" },
      references: [...payload().references].reverse(),
    }));
    expect(a).toBe(b);
  });

  it("changes when a reference, descriptor, or adapter changes", () => {
    const base = canonicalCanonVersionMaterial(payload());
    expect(canonicalCanonVersionMaterial(payload({
      references: [{ assetId: "a3", role: "identity", priority: "PRIMARY", rightsReady: true, sourceProjectId: "p1" }],
    }))).not.toBe(base);
    expect(canonicalCanonVersionMaterial(payload({
      descriptor: { appearance: "草帽、藍背心", notes: null },
    }))).not.toBe(base);
    expect(canonicalCanonVersionMaterial(payload({ adapterRef: "lora://v8" }))).not.toBe(base);
  });

  it("ignores mutable evaluation snapshots (evaluation is not identity)", () => {
    expect(canonicalCanonVersionMaterial(payload({ evaluation: { identity: 0.9 } })))
      .toBe(canonicalCanonVersionMaterial(payload({ evaluation: null })));
  });
});

describe("pin state", () => {
  it("reports UPDATE_AVAILABLE only when production moved past the pin", () => {
    expect(pinState({ pinnedVersionId: "v7", productionVersionId: "v7" })).toBe("PINNED");
    expect(pinState({ pinnedVersionId: "v7", productionVersionId: "v8" })).toBe("UPDATE_AVAILABLE");
    expect(pinState({ pinnedVersionId: "v7", productionVersionId: null })).toBe("PINNED");
  });
});

describe("promote gate", () => {
  it("never promotes an unfinished or drifted training version", () => {
    expect(canPromoteCanonVersion({
      versionArchived: false, canonArchived: false, trainingJobStatus: "training", lookChangedDuringTraining: false,
    }).ok).toBe(false);
    expect(canPromoteCanonVersion({
      versionArchived: false, canonArchived: false, trainingJobStatus: "succeeded", lookChangedDuringTraining: true,
    }).ok).toBe(false);
    expect(canPromoteCanonVersion({
      versionArchived: false, canonArchived: false, trainingJobStatus: "succeeded", lookChangedDuringTraining: false,
    }).ok).toBe(true);
  });

  it("blocks archived canon or archived version", () => {
    expect(canPromoteCanonVersion({
      versionArchived: true, canonArchived: false, trainingJobStatus: null, lookChangedDuringTraining: false,
    }).ok).toBe(false);
    expect(canPromoteCanonVersion({
      versionArchived: false, canonArchived: true, trainingJobStatus: null, lookChangedDuringTraining: false,
    }).ok).toBe(false);
    expect(canPromoteCanonVersion({
      versionArchived: false, canonArchived: false, trainingJobStatus: null, lookChangedDuringTraining: false,
    }).ok).toBe(true);
  });
});

describe("local entity mapping", () => {
  it("round-trips the four card kinds and excludes style/voice/sound_world", () => {
    expect(localEntityKindForCanon("character")).toBe("character");
    expect(localEntityKindForCanon("character_look")).toBe("character_look");
    expect(localEntityKindForCanon("scene")).toBe("scene_preset");
    expect(localEntityKindForCanon("prop")).toBe("prop");
    expect(localEntityKindForCanon("style")).toBeNull();
    expect(localEntityKindForCanon("voice")).toBeNull();
    expect(localEntityKindForCanon("sound_world")).toBeNull();
    expect(canonKindForLocalEntity("scene_preset")).toBe("scene");
    expect(canonKindForLocalEntity("character")).toBe("character");
  });

  it("descriptor mapping matches the sync field list", () => {
    const descriptor = buildCanonDescriptorFromEntity("scene", { palette: "暖橘", lighting: "夕陽側光" });
    expect(descriptor).toEqual({ palette: "暖橘", lighting: "夕陽側光" });
    expect(Object.keys(descriptor).sort()).toEqual([...localFieldsForCanonKind("scene")].sort());
    const char = buildCanonDescriptorFromEntity("character", { appearance: "草帽", notes: "  " });
    expect(char).toEqual({ appearance: "草帽", notes: null });
    expect(Object.keys(char).sort()).toEqual([...localFieldsForCanonKind("character")].sort());
  });
});
