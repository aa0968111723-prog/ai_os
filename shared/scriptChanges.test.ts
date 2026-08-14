import { describe, expect, it } from "vitest";
import {
  classifyCostumeChange,
  deriveShotEndState,
  detectTransitionType,
  parseScriptAuthorizedChanges,
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
