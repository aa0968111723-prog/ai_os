import { describe, expect, it } from "vitest";
import { SHOT_CONTEXT_PACKET_SCHEMA_VERSION, type ShotContextPacketPayload } from "./shotContextPacket";
import { evaluateGenerationCandidate, preflightShotPacket, shouldAdoptCandidate } from "./consistencyEval";

const packet: ShotContextPacketPayload = {
  schemaVersion: SHOT_CONTEXT_PACKET_SCHEMA_VERSION,
  projectId: "p",
  storyId: null,
  storyRev: null,
  storySceneId: null,
  storySceneRev: null,
  shotId: "sh",
  shotRev: 1,
  characters: [{ kind: "character", id: "c1", rev: 1 }],
  looks: [{ kind: "character_look", id: "l1", rev: 1 }],
  presets: [],
  props: [{ kind: "prop", id: "pr1", rev: 1 }],
  assets: [],
  knowledge: [],
  dataRows: [],
  environment: null,
  visual: {
    title: "雨中",
    prompt: "安倢撐傘走上石階",
    action: "走上石階",
    camera: null,
    performance: null,
    durationSec: 4,
    dialogue: null,
    voiceover: null,
    ambience: null,
    music: null,
  },
  continuity: { previousShotId: null, nextShotId: null },
  locks: [],
  negativeConstraints: [],
  worldStyle: [],
  provider: { modelId: null, policyVersion: "generation-command.v1" },
  why: [],
};

describe("consistency evaluation", () => {
  it("does not silently adopt a mismatched candidate", () => {
    const report = evaluateGenerationCandidate({
      packet,
      candidate: { prompt: "another person", characterIds: ["c9"], lookIds: [], propIds: [] },
    });
    expect(report.adoptAllowed).toBe(false);
    expect(shouldAdoptCandidate(report, false)).toBe(false);
    expect(shouldAdoptCandidate(report, true)).toBe(false);
  });

  it("still requires an explicit adopt even when scores are high", () => {
    const report = evaluateGenerationCandidate({
      packet,
      candidate: {
        prompt: "安倢撐傘走上石階",
        characterIds: ["c1"],
        lookIds: ["l1"],
        propIds: ["pr1"],
      },
    });
    expect(report.adoptAllowed).toBe(true);
    expect(shouldAdoptCandidate(report, false)).toBe(false);
    expect(shouldAdoptCandidate(report, true)).toBe(true);
  });

  it("blocks generation when the packet has no visual description", () => {
    const pre = preflightShotPacket({
      ...packet,
      visual: { ...packet.visual, prompt: null, action: null },
    });
    expect(pre.ok).toBe(false);
    expect(pre.issues[0]?.code).toBe("missing_visual");
  });
});
