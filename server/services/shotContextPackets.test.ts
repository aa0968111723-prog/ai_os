import { describe, expect, it } from "vitest";
import { SHOT_CONTEXT_PACKET_SCHEMA_VERSION, type ShotContextPacketPayload } from "../../shared/shotContextPacket";
import { hashShotContextPacket } from "./shotContextPackets";

describe("hashShotContextPacket", () => {
  it("is stable for the same payload and changes when a look rev changes", () => {
    const base: ShotContextPacketPayload = {
      schemaVersion: SHOT_CONTEXT_PACKET_SCHEMA_VERSION,
      projectId: "p",
      storyId: "s",
      storyRev: 1,
      storySceneId: null,
      storySceneRev: null,
      shotId: "sh",
      shotRev: 1,
      characters: [],
      looks: [{ kind: "character_look", id: "l1", rev: 1 }],
      presets: [],
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
    const a = hashShotContextPacket(base);
    const b = hashShotContextPacket(base);
    const c = hashShotContextPacket({
      ...base,
      looks: [{ kind: "character_look", id: "l1", rev: 2 }],
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    expect(c).not.toBe(a);
  });
});
