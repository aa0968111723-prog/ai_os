import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatExecutionRightsError, packetCanonDependencies } from "./executionRights";
import { SHOT_CONTEXT_PACKET_SCHEMA_VERSION, type ShotContextPacketPayload } from "../../shared/shotContextPacket";

const packet = (over: Partial<ShotContextPacketPayload> = {}): ShotContextPacketPayload => ({
  schemaVersion: SHOT_CONTEXT_PACKET_SCHEMA_VERSION,
  projectId: "p1",
  storyId: null,
  storyRev: null,
  storySceneId: null,
  storySceneRev: null,
  shotId: "sh1",
  shotRev: 1,
  characters: [],
  looks: [],
  presets: [],
  props: [],
  assets: [],
  knowledge: [],
  dataRows: [],
  environment: null,
  visual: {
    title: "t", prompt: "p", action: null, camera: null, performance: null,
    durationSec: 3, dialogue: null, voiceover: null, ambience: null, music: null,
  },
  continuity: { previousShotId: null, nextShotId: null },
  locks: [],
  negativeConstraints: [],
  worldStyle: [],
  provider: { modelId: null, policyVersion: "v1" },
  why: [],
  ...over,
});

describe("packetCanonDependencies", () => {
  it("collects identity, voice, style and sound-world canon deps", () => {
    const deps = packetCanonDependencies(packet({
      characterSlots: [{
        characterId: "c1", characterRev: 1, characterName: "魯夫",
        canonId: "canon-char", canonVersionId: "ver-char",
        lookId: null, lookRev: null,
        identityReferenceAssetId: null, lookReferenceAssetId: null,
        ownedPropIds: [], priority: 1,
        voiceCanonId: "canon-voice", voiceVersionId: "ver-voice",
        voiceModelId: "fal-ai/kokoro/mandarin-chinese", voiceId: "zm_yunjian",
      }],
      styleCanon: { canonId: "canon-style", versionId: "ver-style" },
      narrationVoice: { canonId: "canon-narr", versionId: "ver-narr", modelId: "m", voiceId: "v", language: null },
      soundWorld: { canonId: "canon-sound", versionId: "ver-sound", ambience: "海浪", music: null },
    }));
    expect(deps.canonIds.sort()).toEqual(["canon-char", "canon-narr", "canon-sound", "canon-style", "canon-voice"]);
    expect(deps.versionIds.sort()).toEqual(["ver-char", "ver-narr", "ver-sound", "ver-style", "ver-voice"]);
  });

  it("legacy packets with no canon deps revalidate trivially", () => {
    const deps = packetCanonDependencies(packet());
    expect(deps.canonIds).toEqual([]);
    expect(deps.versionIds).toEqual([]);
  });
});

describe("formatExecutionRightsError", () => {
  it("joins every blocker into one durable sentence", () => {
    const text = formatExecutionRightsError([
      { code: "canon_generation_revoked", message: "團隊設定「魯夫」的生成授權已撤回" },
      { code: "membership_revoked", message: "送出者已不在這個組，請由現任成員重新送出" },
    ]);
    expect(text).toContain("魯夫");
    expect(text).toContain("送出者已不在這個組");
  });
});

describe("decideCost wiring (source order)", () => {
  const src = readFileSync(join(process.cwd(), "server/routers/generation.ts"), "utf8");

  it("revalidates execution rights after the CAS claim and before quota/provider", () => {
    const claimAt = src.indexOf('eq(schema.generations.status, "awaiting_approval")');
    const revalidateAt = src.indexOf("revalidateExecutionRights");
    const quotaAt = src.indexOf("reserveQuota(gen.userId");
    const submitAt = src.indexOf("await falSubmit(");
    expect(claimAt).toBeGreaterThan(-1);
    expect(revalidateAt).toBeGreaterThan(claimAt);
    expect(quotaAt).toBeGreaterThan(revalidateAt);
    expect(submitAt).toBeGreaterThan(quotaAt);
  });

  it("blocked resume fails the row without charging and reports structured blockers", () => {
    expect(src).toContain('return { ...blocked, blockers: rights.blockers }');
    expect(src).toContain("formatExecutionRightsError");
  });
});

describe("packet-reuse resume wiring (source order)", () => {
  const src = readFileSync(join(process.cwd(), "server/services/generationCommand.ts"), "utf8");

  it("revalidates canon rights when reusing a frozen packet, before submit", () => {
    const reuseAt = src.indexOf("revalidatePacketCanonRights");
    const submitAt = src.indexOf("const generation = await submitGenerationCore");
    expect(reuseAt).toBeGreaterThan(-1);
    expect(submitAt).toBeGreaterThan(reuseAt);
  });
});
