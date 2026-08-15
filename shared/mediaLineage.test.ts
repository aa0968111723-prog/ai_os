import { describe, expect, it } from "vitest";
import { deriveAmbienceFinding, deriveNarrationFinding, deriveVisualFinding } from "./mediaLineage";

describe("video parent supersession (§8 i2v)", () => {
  const base = {
    shotId: "sh1",
    currentAsset: { id: "video-1", kind: "video" },
    videoParentAssetId: "image-old",
    lastAdoptedAssetId: "image-new",
  };

  it("flags a current video whose parent image was superseded by a newer Adopt", () => {
    const finding = deriveVisualFinding(base);
    expect(finding?.code).toBe("video_parent_superseded");
    expect(finding?.assetId).toBe("video-1");
  });

  it("stays quiet when the parent is still the adopted image", () => {
    expect(deriveVisualFinding({ ...base, videoParentAssetId: "image-new" })).toBeNull();
  });

  it("stays quiet when the video itself was the adopted result", () => {
    expect(deriveVisualFinding({ ...base, lastAdoptedAssetId: "video-1" })).toBeNull();
  });

  it("does not guess when lineage or adopt history is missing", () => {
    expect(deriveVisualFinding({ ...base, videoParentAssetId: null })).toBeNull();
    expect(deriveVisualFinding({ ...base, lastAdoptedAssetId: null })).toBeNull();
  });

  it("ignores image currents (only videos have a parent-image contract)", () => {
    expect(deriveVisualFinding({ ...base, currentAsset: { id: "img", kind: "image" } })).toBeNull();
  });
});

describe("voice version drift (§8 voice)", () => {
  it("flags narration generated with an older voice version", () => {
    const finding = deriveNarrationFinding({
      shotId: "sh1",
      narrationAssetId: "audio-1",
      usedVoice: { canonId: "cv", versionId: "v1" },
      expectedVoice: { canonId: "cv", versionId: "v2" },
    });
    expect(finding?.code).toBe("voice_version_drift");
  });

  it("flags narration generated before any voice was bound", () => {
    const finding = deriveNarrationFinding({
      shotId: "sh1",
      narrationAssetId: "audio-1",
      usedVoice: null,
      expectedVoice: { canonId: "cv", versionId: "v1" },
    });
    expect(finding?.code).toBe("voice_identity_missing");
  });

  it("stays quiet when versions match or no voice is pinned", () => {
    expect(deriveNarrationFinding({
      shotId: "sh1", narrationAssetId: "audio-1",
      usedVoice: { canonId: "cv", versionId: "v1" },
      expectedVoice: { canonId: "cv", versionId: "v1" },
    })).toBeNull();
    expect(deriveNarrationFinding({
      shotId: "sh1", narrationAssetId: "audio-1",
      usedVoice: null, expectedVoice: null,
    })).toBeNull();
    expect(deriveNarrationFinding({
      shotId: "sh1", narrationAssetId: null,
      usedVoice: null, expectedVoice: { canonId: "cv", versionId: "v1" },
    })).toBeNull();
  });
});

describe("sound world drift (§8 audio)", () => {
  it("flags ambience from an older sound-world version, quiet otherwise", () => {
    expect(deriveAmbienceFinding({
      shotId: "sh1", ambienceAssetId: "amb-1",
      usedSoundWorld: { canonId: "cw", versionId: "v1" },
      expectedSoundWorld: { canonId: "cw", versionId: "v2" },
    })?.code).toBe("sound_world_drift");
    expect(deriveAmbienceFinding({
      shotId: "sh1", ambienceAssetId: "amb-1",
      usedSoundWorld: { canonId: "cw", versionId: "v2" },
      expectedSoundWorld: { canonId: "cw", versionId: "v2" },
    })).toBeNull();
    // canon pin 之前生成的舊環境音不強迫重做（音軌沒有硬約束）
    expect(deriveAmbienceFinding({
      shotId: "sh1", ambienceAssetId: "amb-1",
      usedSoundWorld: null,
      expectedSoundWorld: { canonId: "cw", versionId: "v2" },
    })).toBeNull();
  });
});
