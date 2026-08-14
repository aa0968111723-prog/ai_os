import { describe, expect, it } from "vitest";
import {
  SCENE_PACKAGE_SCHEMA_VERSION,
  canonicalScenePackageMaterial,
  scenePackageDependencies,
  type ScenePackagePayload,
} from "./scenePackage";

function payload(over: Partial<ScenePackagePayload> = {}): ScenePackagePayload {
  return {
    schemaVersion: SCENE_PACKAGE_SCHEMA_VERSION,
    projectId: "p1",
    storySceneId: "sc1",
    storySceneRev: 2,
    location: { kind: "scene_preset", id: "beach", rev: 3, name: "淺水灣" },
    sceneCanon: { canonId: "canon-beach", versionId: "v3" },
    environment: { weather: "雨", time: "黃昏" },
    activeCharacters: [
      { kind: "character", id: "luffy", rev: 3, name: "魯夫" },
      { kind: "character", id: "nami", rev: 1, name: "娜美" },
    ],
    activeLooks: [{ kind: "character_look", id: "look-red", rev: 2, name: "紅外套" }],
    props: [{ kind: "prop", id: "map", rev: 5, name: "藏寶圖", ownerKind: "character", ownerId: "nami" }],
    style: ["寫實", "冒險"],
    soundWorld: { ambience: "海浪聲" },
    cameraLanguage: ["中景", "手持"],
    narrativeGoal: "團隊抵達淺水灣",
    entryContinuity: null,
    exitConstraints: [],
    ...over,
  };
}

describe("scene package material", () => {
  it("is stable across set ordering", () => {
    const a = canonicalScenePackageMaterial(payload());
    const b = canonicalScenePackageMaterial(payload({
      activeCharacters: [...payload().activeCharacters].reverse(),
      style: ["冒險", "寫實"],
      cameraLanguage: ["手持", "中景"],
    }));
    expect(a).toBe(b);
  });

  it("changes when environment, canon version, or a member rev changes", () => {
    const base = canonicalScenePackageMaterial(payload());
    expect(canonicalScenePackageMaterial(payload({ environment: { weather: "晴", time: "黃昏" } }))).not.toBe(base);
    expect(canonicalScenePackageMaterial(payload({ sceneCanon: { canonId: "canon-beach", versionId: "v4" } }))).not.toBe(base);
    expect(canonicalScenePackageMaterial(payload({
      activeCharacters: [
        { kind: "character", id: "luffy", rev: 4, name: "魯夫" },
        { kind: "character", id: "nami", rev: 1, name: "娜美" },
      ],
    }))).not.toBe(base);
  });
});

describe("scene package dependencies", () => {
  it("lists location, characters, looks, and props exactly once", () => {
    const deps = scenePackageDependencies(payload());
    expect(deps.storySceneId).toBe("sc1");
    expect(deps.entityKeys).toEqual([
      "character:luffy",
      "character:nami",
      "character_look:look-red",
      "prop:map",
      "scene_preset:beach",
    ]);
  });
});
