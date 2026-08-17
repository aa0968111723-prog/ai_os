import { describe, expect, it } from "vitest";
import {
  buildShotMotionContract,
  evaluateMotionTransition,
  planCrossShotFramePropagation,
} from "./animationMotion";
import type { ProviderCapabilities } from "./providerCapabilities";
import type { ShotContinuityState } from "./shotContextPacket";

const capability = (over: Partial<ProviderCapabilities> = {}): ProviderCapabilities => ({
  modelId: "test",
  referenceField: null,
  maxReferenceImages: 0,
  identityAdapterSupport: false,
  multiCharacterIdentity: false,
  sceneReferenceSupport: false,
  styleAdapterSupport: false,
  imageToVideo: false,
  previousFrameSupport: false,
  seedSupport: false,
  negativePromptSupport: false,
  cardTextAnchors: true,
  asyncJob: true,
  ...over,
});

const state = (over: Partial<ShotContinuityState> = {}): ShotContinuityState => ({
  actors: [{
    characterId: "a",
    lookId: "look-a",
    screenPosition: "left",
    facingDirection: "screen-right",
    bodyPoseClass: "standing",
    handOccupancy: { left: "map", right: "empty" },
    heldPropId: "map",
  }],
  props: [{
    propId: "map",
    holderCharacterId: "a",
    heldInHand: "left",
    visibility: "visible",
  }],
  spatial: { axisId: "axis-1", screenDirectionRule: "screen-right" },
  environment: null,
  ...over,
});

describe("motion and physics continuity", () => {
  it("builds a compact provider-independent motion contract from known state", () => {
    const contract = buildShotMotionContract({
      shotId: "s2",
      expectedStart: state(),
      expectedEnd: state({
        actors: [{
          ...state().actors[0]!,
          screenPosition: "center",
          bodyPoseClass: "walking",
        }],
      }),
      movementByCharacter: { a: "walk" },
      movementDirectionByCharacter: { a: "screen-right" },
      contactsByCharacter: {
        a: [{ targetType: "prop", targetId: "map", phase: "during" }],
      },
      cameraMovement: "跟拍",
    });
    expect(contract.subjects[0]).toMatchObject({
      characterId: "a",
      startPose: "standing",
      endPose: "walking",
      movement: "walk",
      movementDirection: "screen-right",
      heldProps: [{ propId: "map", hand: "left" }],
    });
    expect(contract.camera).toMatchObject({ axisId: "axis-1", screenDirectionRule: "screen-right" });
  });

  it("finds unexplained hand swap, position jump and direction flip from explicit evidence", () => {
    const current = state({
      actors: [{
        ...state().actors[0]!,
        screenPosition: "right",
        facingDirection: "screen-left",
        handOccupancy: { left: "empty", right: "map" },
      }],
      props: [{
        propId: "map",
        holderCharacterId: "a",
        heldInHand: "right",
        visibility: "visible",
      }],
    });
    const contract = buildShotMotionContract({
      shotId: "s2",
      expectedStart: state(),
      expectedEnd: state(),
    });
    const codes = evaluateMotionTransition({
      previousObservedEnd: state(),
      currentObservedStart: current,
      contract,
    }).map((row) => row.code);
    expect(codes).toEqual(expect.arrayContaining([
      "hand_swap_unexplained",
      "position_jump",
      "screen_direction_flip",
    ]));
  });

  it("finds prop teleport but suppresses an explicit handoff", () => {
    const current = state({
      actors: [
        { characterId: "a", lookId: "look-a", heldPropId: null },
        { characterId: "b", lookId: "look-b", heldPropId: "map" },
      ],
      props: [{ propId: "map", holderCharacterId: "b", heldInHand: "unknown" }],
    });
    const contract = buildShotMotionContract({ shotId: "s2", expectedStart: state(), expectedEnd: state() });
    expect(evaluateMotionTransition({
      previousObservedEnd: state(),
      currentObservedStart: current,
      contract,
    }).map((row) => row.code)).toContain("prop_teleport");
    expect(evaluateMotionTransition({
      previousObservedEnd: state(),
      currentObservedStart: current,
      contract,
      authorizedPropTransferIds: ["map"],
    }).map((row) => row.code)).not.toContain("prop_teleport");
  });

  it("honors deliberate axis reset and returns no false direction finding", () => {
    const current = state({
      actors: [{
        ...state().actors[0]!,
        facingDirection: "screen-left",
      }],
    });
    const contract = buildShotMotionContract({ shotId: "s2", expectedStart: state(), expectedEnd: state() });
    expect(evaluateMotionTransition({
      previousObservedEnd: state(),
      currentObservedStart: current,
      contract,
      axisResetAuthorized: true,
    }).map((row) => row.code)).not.toContain("screen_direction_flip");
  });

  it("does not invent findings when visual evidence is unavailable", () => {
    const contract = buildShotMotionContract({ shotId: "s2", expectedStart: state(), expectedEnd: state() });
    expect(evaluateMotionTransition({
      previousObservedEnd: null,
      currentObservedStart: null,
      contract,
    })).toEqual([]);
  });
});

describe("cross-shot frame propagation", () => {
  it("uses trusted previous frame as i2v primary source", () => {
    const plan = planCrossShotFramePropagation({
      previousFrameAssetId: "prev",
      previousFrameTrusted: true,
      references: [{ assetId: "identity", role: "identity", priority: "PRIMARY" }],
      capability: capability({
        imageToVideo: true,
        previousFrameSupport: true,
        maxReferenceImages: 1,
      }),
      characterCount: 1,
    });
    expect(plan.sourceAssetId).toBe("prev");
    expect(plan.referenceMix.orderedAssetIds).toEqual([]);
  });

  it("attaches previous frame through a real multi-reference field", () => {
    const plan = planCrossShotFramePropagation({
      previousFrameAssetId: "prev",
      previousFrameTrusted: true,
      references: [],
      capability: capability({
        referenceField: "image_urls",
        maxReferenceImages: 4,
        previousFrameSupport: true,
      }),
      characterCount: 1,
    });
    expect(plan.sourceAssetId).toBeNull();
    expect(plan.referenceMix.orderedAssetIds).toEqual(["prev"]);
    expect(plan.referenceMix.dropped).toEqual([]);
  });

  it("reports unsupported and untrusted previous frames instead of silently claiming attachment", () => {
    const unsupported = planCrossShotFramePropagation({
      previousFrameAssetId: "prev",
      previousFrameTrusted: true,
      references: [],
      capability: capability(),
      characterCount: 1,
    });
    expect(unsupported.referenceMix.orderedAssetIds).toEqual([]);
    expect(unsupported.referenceMix.downgrades.map((row) => row.code)).toContain("previous_frame_unsupported");

    const untrusted = planCrossShotFramePropagation({
      previousFrameAssetId: "prev",
      previousFrameTrusted: false,
      references: [],
      capability: capability({ referenceField: "image_urls", maxReferenceImages: 4 }),
      characterCount: 1,
    });
    expect(untrusted.referenceMix.orderedAssetIds).toEqual([]);
    expect(untrusted.referenceMix.dropped[0]).toMatchObject({
      assetId: "prev",
      role: "continuity_previous_frame",
    });
  });
});

