import { describe, expect, it } from "vitest";
import {
  animationEvidenceFingerprint,
  mergeVisualEvaluation,
  parseVisualEvaluatorPayload,
  structuralAnimationEvaluation,
} from "./animationEvaluation";
import type { ShotContextPacketPayload } from "./shotContextPacket";

const packet: ShotContextPacketPayload = {
  schemaVersion: "shot-context-packet.v1",
  projectId: "p",
  storyId: "story",
  storyRev: 1,
  storySceneId: "scene",
  storySceneRev: 1,
  shotId: "shot",
  shotRev: 1,
  characters: [{ kind: "character", id: "c1", rev: 1 }],
  looks: [{ kind: "character_look", id: "l1", rev: 1 }],
  presets: [{ kind: "scene_preset", id: "s1", rev: 1 }],
  props: [{ kind: "prop", id: "p1", rev: 1 }],
  assets: [],
  knowledge: [],
  dataRows: [],
  environment: null,
  visual: {
    title: "shot",
    prompt: "two characters",
    action: null,
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
  worldStyle: ["水彩"],
  provider: { modelId: "m", policyVersion: "v1" },
  why: [],
};

describe("animation output evaluation contracts", () => {
  it("fingerprints exact evidence deterministically and changes with previous frame", () => {
    const base = {
      generationId: "g",
      shotId: "shot",
      packetId: "packet",
      packetFingerprint: "fp",
      candidateAssetId: "candidate",
      referenceAssetIds: ["b", "a"],
      previousFrameAssetId: null,
      evaluatorVersion: "v1",
    };
    expect(animationEvidenceFingerprint(base)).toBe(animationEvidenceFingerprint({
      ...base,
      referenceAssetIds: ["a", "b"],
    }));
    expect(animationEvidenceFingerprint(base)).not.toBe(animationEvidenceFingerprint({
      ...base,
      previousFrameAssetId: "previous",
    }));
  });

  it("runs structural checks without pretending visual dimensions passed", () => {
    const result = structuralAnimationEvaluation({
      generationId: "g",
      shotId: "shot",
      packet,
      candidate: { characterIds: ["c1"], scenePresetIds: ["s1"], propIds: ["p1"] },
      evidenceFingerprint: "fp",
      evaluatorVersion: "structural",
    });
    expect(result.visualCheckStatus).toBe("not_checked");
    expect(result.dimensions.identity.status).toBe("not_checked");
    expect(result.recommendation).toBe("review");
  });

  it("blocks high-confidence missing frozen bindings", () => {
    const result = structuralAnimationEvaluation({
      generationId: "g",
      shotId: "shot",
      packet,
      candidate: { characterIds: [], scenePresetIds: [], propIds: [] },
      evidenceFingerprint: "fp",
      evaluatorVersion: "structural",
    });
    expect(result.recommendation).toBe("block_adopt");
    expect(result.findings.map((row) => row.code)).toEqual(expect.arrayContaining([
      "semantic_character_binding_missing",
      "semantic_scene_binding_missing",
      "semantic_prop_binding_missing",
    ]));
  });

  it("parses deterministic evaluator fixtures for all visual/temporal dimensions", () => {
    const parsed = parseVisualEvaluatorPayload({
      dimensions: Object.fromEntries([
        "semantic", "identity", "look", "scene", "prop", "style", "temporal", "physics",
      ].map((name) => [name, {
        status: name === "semantic" ? "consistent" : "finding",
        confidence: "high",
        summary: `${name} evidence`,
        evidenceSourceIds: ["candidate", "canon"],
      }])),
      findings: [
        ["identity_drift", "identity"],
        ["look_mismatch", "look"],
        ["prop_detail_missing", "prop"],
        ["shading_style_drift", "style"],
        ["hand_swap_unexplained", "temporal"],
        ["body_pose_jump", "physics"],
      ].map(([code, dimension]) => ({
        code,
        dimension,
        severity: "warning",
        confidence: "high",
        reason: code,
        evidenceSourceIds: ["candidate", "canon"],
      })),
    });
    expect(parsed.findings).toHaveLength(6);
    expect(parsed.dimensions.identity.status).toBe("finding");
    expect(parsed.dimensions.semantic.status).toBe("consistent");
  });

  it("malformed/omitted evaluator output becomes insufficient evidence, never false green", () => {
    const parsed = parseVisualEvaluatorPayload({ dimensions: { identity: { status: "ok" } } });
    expect(parsed.dimensions.identity.status).toBe("insufficient_evidence");
    expect(parsed.dimensions.style.status).toBe("insufficient_evidence");
    expect(Object.values(parsed.dimensions).some((row) => row.status === "consistent")).toBe(false);
  });

  it("intentional change fixture stays unblocked when real evaluator returns no finding", () => {
    const structural = structuralAnimationEvaluation({
      generationId: "g",
      shotId: "shot",
      packet: {
        ...packet,
        scriptAuthorizedChanges: [{ type: "costume_change", excerpt: "換上雨衣" }],
      },
      candidate: { characterIds: ["c1"], scenePresetIds: ["s1"], propIds: ["p1"] },
      evidenceFingerprint: "fp",
      evaluatorVersion: "fixture",
    });
    const visual = parseVisualEvaluatorPayload({
      dimensions: Object.fromEntries([
        "semantic", "identity", "look", "scene", "prop", "style", "temporal", "physics",
      ].map((name) => [name, {
        status: "consistent",
        confidence: "high",
        summary: "script-authorized",
        evidenceSourceIds: ["candidate"],
      }])),
      findings: [],
    });
    const merged = mergeVisualEvaluation(structural, visual);
    expect(merged.recommendation).toBe("keep");
    expect(merged.findings).toEqual([]);
  });
});

