import { describe, expect, it } from "vitest";
import {
  SHOT_CONTEXT_PACKET_SCHEMA_VERSION,
  canonicalShotContextMaterial,
  packetDependencies,
  staleShotIdsForEntityChange,
  type ShotContextPacketPayload,
} from "./shotContextPacket";

function packet(over: Partial<ShotContextPacketPayload> = {}): ShotContextPacketPayload {
  return {
    schemaVersion: SHOT_CONTEXT_PACKET_SCHEMA_VERSION,
    projectId: "p1",
    storyId: "st1",
    storyRev: 2,
    storySceneId: "sc1",
    storySceneRev: 1,
    shotId: "sh1",
    shotRev: 4,
    characters: [{ kind: "character", id: "c1", rev: 3, name: "安倢" }],
    looks: [{ kind: "character_look", id: "l1", rev: 1, name: "米白外套" }],
    presets: [],
    props: [{ kind: "prop", id: "pr1", rev: 1, name: "紅傘" }],
    assets: [],
    knowledge: [],
    dataRows: [],
    environment: { weather: "雨" },
    visual: {
      title: "雨中",
      prompt: "安倢撐傘",
      action: "走上石階",
      camera: { shotSize: "中景" },
      performance: null,
      durationSec: 4,
      dialogue: null,
      voiceover: null,
      ambience: "雨聲",
      music: null,
    },
    continuity: { previousShotId: null, nextShotId: "sh2" },
    locks: [],
    negativeConstraints: ["不得使用療效字眼"],
    worldStyle: ["寫實"],
    provider: { modelId: "fal-ai/fast-lightning-sdxl", policyVersion: "v1" },
    why: ["綁定角色安倢"],
    ...over,
  };
}

describe("shot context packets", () => {
  it("changes canonical material when a look revision advances", () => {
    const a = canonicalShotContextMaterial(packet());
    const b = canonicalShotContextMaterial(packet({
      looks: [{ kind: "character_look", id: "l1", rev: 2, name: "米白外套" }],
    }));
    expect(a).not.toBe(b);
  });

  it("PR-B optional fields do not disturb legacy fingerprints, but change material when present", () => {
    const legacy = canonicalShotContextMaterial(packet());
    // 空陣列／null 的新欄位＝與 #753 相同素材（歷史指紋不動）
    expect(canonicalShotContextMaterial(packet({
      scenePackage: null,
      characterSlots: [],
      scriptAuthorizedChanges: [],
    }))).toBe(legacy);
    // 真的有 Scene Package／授權改變時，素材要跟著變（凍結內容不同）
    expect(canonicalShotContextMaterial(packet({
      scenePackage: { packageId: "pkg1", fingerprint: "f1" },
    }))).not.toBe(legacy);
    expect(canonicalShotContextMaterial(packet({
      scriptAuthorizedChanges: [{ type: "costume_change", excerpt: "脫掉紅外套" }],
    }))).not.toBe(legacy);
  });

  it("stales only shots that depend on the changed look", () => {
    const rain = packetDependencies(packet({ shotId: "rain" }));
    const interior = packetDependencies(packet({
      shotId: "interior",
      looks: [],
      characters: [{ kind: "character", id: "c2", rev: 1 }],
      props: [],
    }));
    expect(staleShotIdsForEntityChange([rain, interior], { kind: "character_look", id: "l1" })).toEqual(["rain"]);
    expect(staleShotIdsForEntityChange([rain, interior], { kind: "prop", id: "pr1" })).toEqual(["rain"]);
    expect(staleShotIdsForEntityChange([rain, interior], { kind: "knowledge", id: "k9" })).toEqual([]);
  });
});
