import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { evaluateGenerationCandidate, preflightShotPacket, shouldAdoptCandidate } from "../../shared/consistencyEval";
import { SHOT_CONTEXT_PACKET_SCHEMA_VERSION, type ShotContextPacketPayload } from "../../shared/shotContextPacket";
import { splitGenerationSourceMeta, storeGenerationSourceMeta } from "../../shared/generationSourceMeta";

const src = readFileSync(join(process.cwd(), "server/services/generationCommand.ts"), "utf8");
const runner = readFileSync(join(process.cwd(), "server/services/agentRunner.ts"), "utf8");

const packet: ShotContextPacketPayload = {
  schemaVersion: SHOT_CONTEXT_PACKET_SCHEMA_VERSION,
  projectId: "p",
  storyId: null,
  storyRev: null,
  storySceneId: null,
  storySceneRev: null,
  shotId: "sh",
  shotRev: 1,
  characters: [],
  looks: [],
  presets: [{ kind: "scene_preset", id: "sp1", rev: 1 }],
  props: [],
  assets: [],
  knowledge: [],
  dataRows: [],
  environment: null,
  visual: {
    title: "t",
    prompt: null,
    action: null,
    camera: null,
    performance: null,
    durationSec: 3,
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

describe("generationCommand #749 review guards", () => {
  it("freezes and preflights before submitGenerationCore", () => {
    const freezeAt = src.indexOf("freezeShotContextPacket");
    const loadAt = src.indexOf("loadShotContextPacket");
    const preflightAt = src.indexOf("if (!preflight.ok)");
    const submitAt = src.indexOf("const generation = await submitGenerationCore");
    expect(freezeAt).toBeGreaterThan(-1);
    expect(loadAt).toBeGreaterThan(-1);
    expect(preflightAt).toBeGreaterThan(-1);
    expect(submitAt).toBeGreaterThan(preflightAt);
    expect(preflightAt).toBeGreaterThan(Math.min(freezeAt, loadAt));
  });

  it("refuses a failed first send so MCP generate_into is not a silent no-op", () => {
    expect(src).toContain("shouldReplayIdempotentGeneration(generation.status)");
    expect(src).toContain("IDEMPOTENT_FAILED_GENERATION_RETRY");
    const afterSubmit = src.slice(src.indexOf("const generation = await submitGenerationCore"));
    expect(afterSubmit).toContain("shouldReplayIdempotentGeneration(generation.status)");
    expect(afterSubmit.indexOf("shouldReplayIdempotentGeneration")).toBeLessThan(afterSubmit.lastIndexOf("return generation"));
  });

  it("defaults visual scene-bound generations to preserveScenePointer", () => {
    expect(src).toContain("const preserveScenePointer = core.preserveScenePointer ?? isVisualSceneBound(core)");
    expect(src).toContain("preserveScenePointer");
  });

  it("passes the batch packet id through both agent runner generate paths", () => {
    expect(runner.match(/shotContextPacketId: step.shotContextPacketId/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("planAgentCore stamps shotContextPacketId on visual generate steps like batchGenerate", () => {
    const core = readFileSync(join(process.cwd(), "server/services/agentCore.ts"), "utf8");
    expect(core).toContain("async function stampAgentGenerateShotContextPackets");
    expect(core.match(/stampAgentGenerateShotContextPackets\(auth, project.id, plan.steps\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(core).toContain("step.shotContextPacketId = frozen.packetId");
    expect(core).toContain("sceneFillRole(model) !== \"visual\"");
    expect(core).toContain("freezeShotContextPacket");
  });

  it("stores the frozen packet id in generation source meta for resume", () => {
    const stored = storeGenerationSourceMeta({ prompt: "x" }, { shotContextPacketId: "pkt-1", preserveScenePointer: true });
    const split = splitGenerationSourceMeta(stored);
    expect(split.meta.shotContextPacketId).toBe("pkt-1");
    expect(split.meta.preserveScenePointer).toBe(true);
  });

  it("preflight rejects before any provider work when the packet has no visual", () => {
    const pre = preflightShotPacket(packet);
    expect(pre.ok).toBe(false);
    expect(pre.issues[0]?.code).toBe("missing_visual");
  });

  it("missing required scene preset cannot be adopted", () => {
    const report = evaluateGenerationCandidate({
      packet: { ...packet, visual: { ...packet.visual, prompt: "場景在山嵐" } },
      candidate: { prompt: "場景在山嵐", scenePresetIds: [] },
    });
    expect(report.issues.some((issue) => issue.code === "scene_mismatch")).toBe(true);
    expect(shouldAdoptCandidate(report, true)).toBe(false);
  });
});
