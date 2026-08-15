import { describe, expect, it } from "vitest";
import {
  classifyCostumeChange,
  deriveShotEndState,
  detectTransitionType,
  parseScriptAuthorizedChanges,
  resolvePropTransfers,
  unresolvedPropTransfers,
} from "./scriptChanges";

describe("script authorized changes", () => {
  it("parses explicit costume / wet / prop markers with provenance excerpts", () => {
    const changes = parseScriptAuthorizedChanges("魯夫脫掉紅外套，跳進水裡；娜美把藏寶圖交給索隆");
    expect(changes.map((row) => row.type)).toEqual(
      expect.arrayContaining(["costume_change", "got_wet", "prop_transfer"]),
    );
    expect(changes.find((row) => row.type === "costume_change")?.excerpt).toContain("脫掉");
  });

  it("stays conservative: plain narration yields no authorized change", () => {
    expect(parseScriptAuthorizedChanges("魯夫和娜美走在沙灘上")).toEqual([]);
  });
});

describe("transition detection", () => {
  it("explicit time markers beat scene change; scene change beats cut", () => {
    expect(detectTransitionType({
      shotText: "多年後，魯夫回到村子", previousStorySceneId: "s1", currentStorySceneId: "s1",
    })).toBe("time_jump");
    expect(detectTransitionType({
      shotText: "他們抵達街頭", previousStorySceneId: "s1", currentStorySceneId: "s2",
    })).toBe("scene_change");
    expect(detectTransitionType({
      shotText: "他繼續往前走", previousStorySceneId: "s1", currentStorySceneId: "s1",
    })).toBe("cut");
  });
});

describe("costume drift vs script-authorized change", () => {
  it("look change without authorization is unintentional drift", () => {
    expect(classifyCostumeChange({
      previousLookId: "look-red", currentLookId: "look-blue",
      authorizedChanges: [], transitionType: "cut",
    })).toBe("unintentional_drift");
  });

  it("「脫掉紅外套」is a legal state change, not drift", () => {
    expect(classifyCostumeChange({
      previousLookId: "look-red", currentLookId: "look-blue",
      authorizedChanges: parseScriptAuthorizedChanges("魯夫脫掉紅外套"), transitionType: "cut",
    })).toBe("script_authorized_change");
  });

  it("time jumps release the costume constraint", () => {
    expect(classifyCostumeChange({
      previousLookId: "look-red", currentLookId: "look-blue",
      authorizedChanges: [], transitionType: "time_jump",
    })).toBe("script_authorized_change");
  });
});

describe("end-state derivation at Adopt", () => {
  it("rain wets everyone; drying clears it; injuries persist", () => {
    const wet = deriveShotEndState({
      currentStart: { actors: [{ characterId: "c1", lookId: "l1" }, { characterId: "c2", lookId: null }], environment: { weather: "雨" } },
      authorizedChanges: parseScriptAuthorizedChanges("兩人被雨淋成落湯雞"),
      environment: null,
    });
    expect(wet.actors.every((actor) => actor.wetness === "wet")).toBe(true);

    const dried = deriveShotEndState({
      currentStart: wet,
      authorizedChanges: parseScriptAuthorizedChanges("回到屋裡擦乾身體"),
      environment: null,
    });
    expect(dried.actors.every((actor) => actor.wetness === undefined)).toBe(true);
  });
});

describe("closure §9 durable prop transfer", () => {
  const characters = [{ id: "nami", name: "娜美" }, { id: "zoro", name: "索隆" }];
  const props = [{ id: "map", name: "藏寶圖" }];

  it("resolves 「娜美把藏寶圖交給索隆」 to a structured transfer", () => {
    const text = "娜美把藏寶圖交給索隆，兩人繼續前進。";
    const changes = resolvePropTransfers({
      changes: parseScriptAuthorizedChanges(text),
      shotText: text,
      characters,
      props,
    });
    const transfer = changes.find((row) => row.type === "prop_transfer");
    expect(transfer?.resolved).toBe(true);
    expect(transfer?.propId).toBe("map");
    expect(transfer?.fromCharacterId).toBe("nami");
    expect(transfer?.toCharacterId).toBe("zoro");
  });

  it("refuses to guess when the recipient is ambiguous", () => {
    const text = "娜美把藏寶圖交給索隆和魯夫看。";
    const changes = resolvePropTransfers({
      changes: parseScriptAuthorizedChanges(text),
      shotText: text,
      characters: [...characters, { id: "luffy", name: "魯夫" }],
      props,
    });
    const transfer = changes.find((row) => row.type === "prop_transfer");
    expect(transfer?.resolved).toBe(false);
    expect(unresolvedPropTransfers(changes)).toHaveLength(1);
  });

  it("resolved transfer moves heldProp in the end-state; giver lets go", () => {
    const end = deriveShotEndState({
      currentStart: {
        actors: [
          { characterId: "nami", lookId: null, heldPropId: "map" },
          { characterId: "zoro", lookId: null },
        ],
        environment: null,
      },
      authorizedChanges: [{ type: "prop_transfer", excerpt: "交給索隆", propId: "map", fromCharacterId: "nami", toCharacterId: "zoro", resolved: true }],
      environment: null,
    });
    expect(end.actors.find((a) => a.characterId === "nami")?.heldPropId).toBeNull();
    expect(end.actors.find((a) => a.characterId === "zoro")?.heldPropId).toBe("map");
  });

  it("unresolved transfer leaves state untouched (no guessing)", () => {
    const end = deriveShotEndState({
      currentStart: {
        actors: [{ characterId: "nami", lookId: null, heldPropId: "map" }],
        environment: null,
      },
      authorizedChanges: [{ type: "prop_transfer", excerpt: "交給某人", resolved: false }],
      environment: null,
    });
    expect(end.actors[0]?.heldPropId).toBe("map");
  });

  it("resolved prop_loss clears the holder", () => {
    const end = deriveShotEndState({
      currentStart: {
        actors: [{ characterId: "nami", lookId: null, heldPropId: "map" }],
        environment: null,
      },
      authorizedChanges: [{ type: "prop_loss", excerpt: "藏寶圖掉了", propId: "map", resolved: true }],
      environment: null,
    });
    expect(end.actors[0]?.heldPropId).toBeNull();
  });
});
