import { describe, expect, it } from "vitest";
import {
  PROJECT_AREA_IDS,
  PROJECT_AREAS,
  SETTINGS_LOW_FREQ,
  WORK_STAGES,
  areaFromContextTarget,
  areaFromHash,
  areaFromStorySection,
  defForArea,
  defForWorkStage,
  settingsLowFreqForTarget,
  workStageFromHash,
  workStageFromSection,
} from "./projectAreaNav";

describe("projectAreaNav — top-level areas", () => {
  it("exposes at most 5 primary areas with expected labels", () => {
    expect(PROJECT_AREA_IDS).toHaveLength(5);
    expect(PROJECT_AREAS.map((a) => a.id)).toEqual([
      "work",
      "materials",
      "progress",
      "review",
      "settings",
    ]);
    expect(PROJECT_AREAS.map((a) => a.label)).toEqual([
      "工作",
      "素材",
      "進度",
      "審核",
      "設定",
    ]);
  });

  it("defForArea returns the matching def", () => {
    expect(defForArea("work").label).toBe("工作");
    expect(defForArea("materials").label).toBe("素材");
  });
});

describe("projectAreaNav — work stages (故事/製作/成片)", () => {
  it("defines three animation stages under 工作", () => {
    expect(WORK_STAGES.map((s) => s.id)).toEqual(["story", "production", "film"]);
    expect(WORK_STAGES.map((s) => s.label)).toEqual(["故事", "製作", "成片"]);
  });

  it("maps story-inline sections to work stages", () => {
    expect(workStageFromSection("home")).toBe("story");
    expect(workStageFromSection("markers")).toBe("story");
    expect(workStageFromSection("storyboard")).toBe("production");
    expect(workStageFromSection("production")).toBe("production");
    expect(workStageFromSection("delivery")).toBe("film");
  });

  it("derives work stage from legacy hashes", () => {
    expect(workStageFromHash("#stage-story")).toBe("story");
    expect(workStageFromHash("#stage-board")).toBe("production");
    expect(workStageFromHash("#stage-create")).toBe("production");
    expect(workStageFromHash("#stage-deliver")).toBe("film");
    expect(workStageFromHash(null)).toBe("story");
  });

  it("defForWorkStage returns the matching def", () => {
    expect(defForWorkStage("film").label).toBe("成片");
  });
});

describe("projectAreaNav — section / context → area", () => {
  it("maps story-inline sections to areas", () => {
    expect(areaFromStorySection("home")).toBe("work");
    expect(areaFromStorySection("storyboard")).toBe("work");
    expect(areaFromStorySection("production")).toBe("work");
    expect(areaFromStorySection("delivery")).toBe("work");
    expect(areaFromStorySection("characters")).toBe("materials");
    expect(areaFromStorySection("looks")).toBe("materials");
    expect(areaFromStorySection("scenes")).toBe("materials");
    expect(areaFromStorySection("props")).toBe("materials");
  });

  it("maps project-context targets to areas", () => {
    expect(areaFromContextTarget("stage-context")).toBe("work");
    expect(areaFromContextTarget("characters")).toBe("materials");
    expect(areaFromContextTarget("scenes")).toBe("materials");
    expect(areaFromContextTarget("props")).toBe("materials");
    expect(areaFromContextTarget("knowledge")).toBe("materials");
    expect(areaFromContextTarget("databases")).toBe("materials");
    expect(areaFromContextTarget("assets")).toBe("materials");
    expect(areaFromContextTarget("worldview")).toBe("settings");
    expect(areaFromContextTarget("recycle")).toBe("settings");
  });

  it("routes recycle to settings low-freq 進階", () => {
    expect(settingsLowFreqForTarget("recycle")).toBe("advanced");
    expect(SETTINGS_LOW_FREQ.map((b) => b.label)).toEqual(["更多", "進階", "工具"]);
  });
});

describe("projectAreaNav — deep-link hash compatibility", () => {
  it("classifies legacy stage hashes without rewriting them", () => {
    expect(areaFromHash("#stage-story")).toBe("work");
    expect(areaFromHash("#stage-context")).toBe("work");
    expect(areaFromHash("#stage-board")).toBe("work");
    expect(areaFromHash("#stage-create")).toBe("work");
    expect(areaFromHash("#stage-deliver")).toBe("work");
    expect(areaFromHash("#sec-studio")).toBe("work");
    expect(areaFromHash("#sec-generations")).toBe("work");
  });

  it("classifies material anchors as 素材", () => {
    expect(areaFromHash("#sec-characters")).toBe("materials");
    expect(areaFromHash("#sec-looks")).toBe("materials");
    expect(areaFromHash("#sec-costume")).toBe("materials");
    expect(areaFromHash("#sec-scenes")).toBe("materials");
    expect(areaFromHash("#sec-props")).toBe("materials");
    expect(areaFromHash("#sec-assets")).toBe("materials");
    expect(areaFromHash("#sec-knowledge")).toBe("materials");
    expect(areaFromHash("#sec-databases")).toBe("materials");
  });

  it("classifies settings / recycle anchors as 設定", () => {
    expect(areaFromHash("#sec-recyclebin")).toBe("settings");
    expect(areaFromHash("#onboard-worldview")).toBe("settings");
    expect(areaFromHash("#area-settings")).toBe("settings");
  });

  it("classifies explicit progress / review area hashes", () => {
    expect(areaFromHash("#area-progress")).toBe("progress");
    expect(areaFromHash("#sec-progress")).toBe("progress");
    expect(areaFromHash("#area-review")).toBe("review");
    expect(areaFromHash("#sec-approvals")).toBe("review");
  });

  it("defaults unknown or empty hashes to 工作", () => {
    expect(areaFromHash(null)).toBe("work");
    expect(areaFromHash("")).toBe("work");
    expect(areaFromHash("#totally-unknown-anchor")).toBe("work");
  });
});
