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

  it("blocks adopt when the required scene preset is missing even if other scores are high", () => {
    const withScene: typeof packet = {
      ...packet,
      presets: [{ kind: "scene_preset", id: "sp1", rev: 1 }],
    };
    const report = evaluateGenerationCandidate({
      packet: withScene,
      candidate: {
        prompt: "安倢撐傘走上石階",
        characterIds: ["c1"],
        lookIds: ["l1"],
        propIds: ["pr1"],
        scenePresetIds: [],
      },
    });
    expect(report.scores.scene).toBe(0);
    expect(report.issues.some((issue) => issue.code === "scene_mismatch")).toBe(true);
    expect(report.adoptAllowed).toBe(false);
    expect(shouldAdoptCandidate(report, true)).toBe(false);
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

describe("PR-B deepening: prop ownership and continuity", () => {
  it("wrong_prop_owner blocks preflight unless the script transfers the prop", () => {
    const withForeignProp = {
      ...packet,
      props: [{ kind: "prop", id: "sword", rev: 1, name: "刀", ownerKind: "character", ownerId: "zoro" }],
    };
    const blocked = preflightShotPacket(withForeignProp);
    expect(blocked.ok).toBe(false);
    expect(blocked.issues.some((issue) => issue.code === "wrong_prop_owner")).toBe(true);

    const transferred = preflightShotPacket({
      ...withForeignProp,
      scriptAuthorizedChanges: [{ type: "prop_transfer", excerpt: "索隆把刀交給魯夫" }],
    });
    expect(transferred.issues.some((issue) => issue.code === "wrong_prop_owner")).toBe(false);
  });

  it("continuity_costume_break fires only for unauthorized look changes", () => {
    const withContinuity = {
      ...packet,
      continuity: {
        previousShotId: "sh0",
        nextShotId: null,
        previousEnd: { actors: [{ characterId: "c1", lookId: "look-red" }], environment: null },
        currentStart: {
          actors: [{ characterId: "c1", lookId: "look-blue" }],
          environment: null,
          transitionType: "cut" as const,
        },
      },
    };
    const drift = evaluateGenerationCandidate({
      packet: withContinuity,
      candidate: { prompt: "安倢撐傘走上石階", characterIds: ["c1"], lookIds: ["l1"], propIds: ["pr1"] },
    });
    expect(drift.issues.some((issue) => issue.code === "continuity_costume_break")).toBe(true);
    expect(drift.adoptAllowed).toBe(false);

    const authorized = evaluateGenerationCandidate({
      packet: {
        ...withContinuity,
        scriptAuthorizedChanges: [{ type: "costume_change", excerpt: "脫掉紅外套" }],
      },
      candidate: { prompt: "安倢撐傘走上石階", characterIds: ["c1"], lookIds: ["l1"], propIds: ["pr1"] },
    });
    expect(authorized.issues.some((issue) => issue.code === "continuity_costume_break")).toBe(false);
  });
});
