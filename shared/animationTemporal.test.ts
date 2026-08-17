import { describe, expect, it } from "vitest";
import {
  compileTemporalSequence,
  deriveSequenceLock,
  temporalImpactShotIds,
} from "./animationTemporal";
import type { ScenePackagePayload } from "./scenePackage";
import type { ShotContinuityState, ShotDependencyGraph } from "./shotContextPacket";

const packagePayload = (over: Partial<ScenePackagePayload> = {}): ScenePackagePayload => ({
  schemaVersion: "scene-package.v1",
  projectId: "p1",
  storySceneId: "seq1",
  storySceneRev: 1,
  location: { kind: "scene_preset", id: "loc1", rev: 1, name: "老街" },
  sceneCanon: { canonId: "scene-canon", versionId: "scene-v1" },
  environment: { time: "night", weather: "rain" },
  activeCharacters: [
    { kind: "character", id: "a", rev: 1, name: "安捷" },
    { kind: "character", id: "b", rev: 1, name: "小柏" },
  ],
  activeLooks: [
    { kind: "character_look", id: "look-a1", rev: 1, name: "雨衣" },
  ],
  props: [{ kind: "prop", id: "map", rev: 1, name: "藏寶圖", ownerKind: "character", ownerId: "a" }],
  style: ["手繪"],
  styleCanon: { canonId: "style-canon", versionId: "style-v1" },
  soundWorld: { ambience: "雨聲", canonId: "sound-canon", canonVersionId: "sound-v1", music: null },
  cameraLanguage: ["中景"],
  narrativeGoal: "兩人交接藏寶圖",
  entryContinuity: null,
  exitConstraints: [],
  ...over,
});

const entry: ShotContinuityState = {
  actors: [
    {
      characterId: "a",
      lookId: "look-a1",
      screenPosition: "left",
      facingDirection: "screen-right",
      bodyPoseClass: "standing",
      handOccupancy: { left: "map", right: "empty" },
      heldPropId: "map",
      wetness: "wet",
    },
    {
      characterId: "b",
      lookId: "look-b1",
      screenPosition: "right",
      facingDirection: "screen-left",
      bodyPoseClass: "standing",
      handOccupancy: { left: "empty", right: "empty" },
      heldPropId: null,
    },
  ],
  props: [{
    propId: "map",
    holderCharacterId: "a",
    heldInHand: "left",
    visibility: "visible",
    wetness: "wet",
    integrity: "intact",
  }],
  spatial: {
    axisId: "axis-main",
    screenDirectionRule: "screen-right",
    relativeOrdering: [{ subjectId: "a", relation: "left_of", objectId: "b" }],
  },
  environment: { weather: "rain" },
  transitionType: "cut",
};

describe("Animation temporal state foundation", () => {
  it("derives Sequence Lock from Scene Package instead of creating another pointer", () => {
    const lock = deriveSequenceLock({
      packagePayload: packagePayload(),
      packageFingerprint: "fp1",
      packageStale: false,
    });
    expect(lock.status).toBe("ready");
    expect(lock.characterIds).toEqual(["a", "b"]);
    expect(lock.styleCanon).toEqual({ canonId: "style-canon", versionId: "style-v1" });
    expect(lock.dependencyKeys).toEqual(expect.arrayContaining([
      "character:a",
      "character:b",
      "prop:map",
      "canon:style-canon",
      "canon:sound-canon",
    ]));
  });

  it("reports upstream change and incomplete lock honestly", () => {
    expect(deriveSequenceLock({
      packagePayload: packagePayload(),
      packageStale: true,
    })).toMatchObject({ status: "changed_upstream", reasons: ["上游設定已變更"] });
    const incomplete = deriveSequenceLock({
      packagePayload: packagePayload({ location: null, narrativeGoal: null }),
      packageStale: false,
    });
    expect(incomplete.status).toBe("needs_confirmation");
    expect(incomplete.reasons).toContain("場景身份尚未確認");
  });

  it("propagates explicit prop handoff while keeping unknown hand unknown", () => {
    const [handoff, next] = compileTemporalSequence([
      {
        shotId: "s1",
        transitionType: "cut",
        environment: { weather: "rain" },
        authorizedChanges: [{
          type: "prop_transfer",
          excerpt: "安捷把藏寶圖交給小柏",
          propId: "map",
          fromCharacterId: "a",
          toCharacterId: "b",
          resolved: true,
        }],
      },
      {
        shotId: "s2",
        transitionType: "cut",
        environment: { weather: "rain" },
        authorizedChanges: [],
      },
    ], entry);

    expect(handoff.expectedEnd.actors.find((row) => row.characterId === "a")?.heldPropId).toBeNull();
    expect(handoff.expectedEnd.actors.find((row) => row.characterId === "b")?.heldPropId).toBe("map");
    expect(handoff.expectedEnd.props?.[0]).toMatchObject({
      propId: "map",
      holderCharacterId: "b",
      heldInHand: "unknown",
    });
    expect(next.expectedStart.props?.[0]?.holderCharacterId).toBe("b");
    // No authored/evidence hand is available, so we never manufacture left/right.
    expect(next.expectedStart.props?.[0]?.heldInHand).toBe("unknown");
  });

  it("keeps expected and observed output states separate", () => {
    const observed: ShotContinuityState = {
      ...entry,
      actors: entry.actors.map((actor) => ({
        ...actor,
        facingDirection: "screen-left",
      })),
    };
    const [contract] = compileTemporalSequence([{
      shotId: "s1",
      transitionType: "cut",
      environment: entry.environment,
      authorizedChanges: [],
      observedEnd: observed,
    }], entry);
    expect(contract.expectedEnd.actors[0]?.facingDirection).toBe("screen-right");
    expect(contract.observedEnd?.actors[0]?.facingDirection).toBe("screen-left");
  });

  it("time jump and montage release pose/position/contact but preserve identity and Look", () => {
    const [jump] = compileTemporalSequence([{
      shotId: "future",
      transitionType: "time_jump",
      environment: { weather: "sunny" },
      authorizedChanges: [],
    }], entry);
    const actor = jump.expectedStart.actors.find((row) => row.characterId === "a");
    expect(actor).toEqual({ characterId: "a", lookId: "look-a1" });
    expect(jump.expectedStart.props).toBeUndefined();
    expect(jump.expectedStart.spatial).toBeUndefined();
    expect(jump.expectedStart.environment).toEqual({ weather: "sunny" });
  });

  it("scene change resets environment when authored but preserves character/prop continuity", () => {
    const [changed] = compileTemporalSequence([{
      shotId: "new-scene",
      transitionType: "scene_change",
      environment: { location: "temple" },
      authoredStart: { environment: { location: "temple" } },
      authorizedChanges: [],
    }], entry);
    expect(changed.expectedStart.environment).toEqual({ location: "temple" });
    expect(changed.expectedStart.actors[0]?.heldPropId).toBe("map");
    expect(changed.expectedStart.props?.[0]?.propId).toBe("map");
  });

  it("only impacts shots already linked by the packet dependency graph", () => {
    const graphs: ShotDependencyGraph[] = [
      { shotId: "s1", entityKeys: ["character:a", "character_look:look-a1", "prop:map"] },
      { shotId: "s2", entityKeys: ["character:a", "prop:map"] },
      { shotId: "s3", entityKeys: ["character:b"] },
    ];
    expect(temporalImpactShotIds(graphs, { kind: "character_look", id: "look-a1" })).toEqual(["s1"]);
    expect(temporalImpactShotIds(graphs, { kind: "prop", id: "map" })).toEqual(["s1", "s2"]);
  });
});

