import { describe, expect, it } from "vitest";
import { buildProgressItems, deriveProjectStatusSummary } from "./projectStatusSummary";

const empty = {
  hasStory: false,
  characterCount: 0,
  scenePresetCount: 0,
  shots: 0,
  shotsWithVisual: 0,
  generationsDone: 0,
  runningGenerations: 0,
  awaitingGenerations: 0,
  playableResultCount: 0,
};

describe("deriveProjectStatusSummary", () => {
  it("空專案 → 故事階段／開始寫故事", () => {
    const s = deriveProjectStatusSummary(empty);
    expect(s.stageId).toBe("story");
    expect(s.stageLabel).toBe("故事階段");
    expect(s.nextLabel).toBe("開始寫故事");
    expect(s.nextAnchor).toBe("stage-story");
    expect(s.statusLine).toContain("還沒有故事");
    expect(s.progressItems.find((p) => p.key === "story")?.done).toBe(false);
    expect(s.runningItems).toEqual([]);
    expect(s.attentionItems).toEqual([]);
  });

  it("有故事無分鏡 → 分鏡階段", () => {
    const s = deriveProjectStatusSummary({ ...empty, hasStory: true, characterCount: 2 });
    expect(s.stageId).toBe("storyboard");
    expect(s.stageLabel).toBe("分鏡階段");
    expect(s.nextLabel).toBe("繼續排分鏡");
    expect(s.progressItems.find((p) => p.key === "story")?.label).toBe("故事 ✓");
    expect(s.progressItems.find((p) => p.key === "characters")?.done).toBe(true);
  });

  it("有分鏡無畫面 → 視覺階段", () => {
    const s = deriveProjectStatusSummary({
      ...empty,
      hasStory: true,
      shots: 12,
      shotsWithVisual: 0,
      scenePresetCount: 4,
    });
    expect(s.stageId).toBe("visual");
    expect(s.stageLabel).toBe("視覺階段");
    expect(s.nextLabel).toBe("開始做畫面");
    expect(s.progressItems.find((p) => p.key === "shots")?.label).toBe("分鏡 0/12");
  });

  it("部分畫面 → 生成階段", () => {
    const s = deriveProjectStatusSummary({
      ...empty,
      hasStory: true,
      shots: 12,
      shotsWithVisual: 5,
      playableResultCount: 5,
    });
    expect(s.stageId).toBe("generate");
    expect(s.progressItems.find((p) => p.key === "video")?.label).toBe("影片 5/12");
  });

  it("running → 正在執行列", () => {
    const s = deriveProjectStatusSummary({
      ...empty,
      hasStory: true,
      shots: 8,
      shotsWithVisual: 3,
      runningGenerations: 2,
      runningLabels: [
        { key: "s8", label: "Shot 08 影片生成中", anchor: "stage-create" },
      ],
    });
    expect(s.runningItems).toHaveLength(1);
    expect(s.runningItems[0].label).toBe("Shot 08 影片生成中");
  });

  it("awaiting → 需要處理 + statusLine 含裁決", () => {
    const s = deriveProjectStatusSummary({
      ...empty,
      hasStory: true,
      shots: 8,
      shotsWithVisual: 4,
      awaitingGenerations: 2,
    });
    expect(s.stageId).toBe("generate");
    expect(s.statusLine).toContain("等你裁決");
    expect(s.attentionItems[0]?.label).toBe("2 筆等待審核");
  });

  it("nextShotLabel 覆寫下一步", () => {
    const s = deriveProjectStatusSummary({
      ...empty,
      hasStory: true,
      shots: 12,
      shotsWithVisual: 8,
      nextShotLabel: "完成 Shot 09",
    });
    expect(s.nextLabel).toBe("完成 Shot 09");
  });

  it("archived → 交付", () => {
    const s = deriveProjectStatusSummary({
      ...empty,
      hasStory: true,
      shots: 6,
      shotsWithVisual: 6,
      generationsDone: 3,
      playableResultCount: 6,
      archived: true,
    });
    expect(s.stageId).toBe("deliver");
    expect(s.stageLabel).toBe("交付階段");
  });

  it("progress anchors 可點進對應區域", () => {
    const s = deriveProjectStatusSummary({
      ...empty,
      hasStory: true,
      shots: 3,
      shotsWithVisual: 1,
      scenePresetCount: 1,
    });
    expect(s.progressItems.map((p) => p.anchor)).toEqual([
      "stage-story",
      "sec-characters",
      "sec-scenes",
      "stage-board",
      "stage-create",
      "stage-create",
      "stage-create",
      "stage-deliver",
    ]);
  });
});

describe("buildProgressItems — 真實工作流", () => {
  it("完整動畫專案範例：故事✓ 角色3/3 場景4/5 分鏡8/12 圖片7/12 影片5/12 聲音3/12 審核4/12", () => {
    const items = buildProgressItems({
      hasStory: true,
      characterCount: 3,
      peopleCount: 3,
      scenePresetCount: 4,
      storySceneCount: 5,
      shots: 12,
      shotsWithVisual: 7,
      shotsReady: 8,
      generationsDone: 10,
      runningGenerations: 0,
      awaitingGenerations: 0,
      playableResultCount: 5,
      perTrack: {
        image: 7,
        video: 5,
        voice: 3,
        audio: 2,
        review: 4,
      },
    });

    const byKey = Object.fromEntries(items.map((i) => [i.key, i]));
    expect(byKey.story.label).toBe("故事 ✓");
    expect(byKey.story.done).toBe(true);
    expect(byKey.characters.label).toBe("角色 3/3");
    expect(byKey.characters.done).toBe(true);
    expect(byKey.scenes.label).toBe("場景 4/5");
    expect(byKey.scenes.done).toBe(false);
    expect(byKey.shots.label).toBe("分鏡 8/12");
    expect(byKey.image.label).toBe("圖片 7/12");
    expect(byKey.video.label).toBe("影片 5/12");
    expect(byKey.sound.label).toBe("聲音 3/12");
    expect(byKey.review.label).toBe("審核 4/12");
  });

  it("聲音以配音 voice 計數", () => {
    const items = buildProgressItems({
      ...empty,
      hasStory: true,
      shots: 10,
      shotsWithVisual: 4,
      scenePresetCount: 0,
      perTrack: { image: 4, video: 2, voice: 3, audio: 0, review: 1 },
    });
    expect(items.find((i) => i.key === "sound")?.label).toBe("聲音 3/10");
  });

  it("無分鏡時各軌不顯示 0/0 比率", () => {
    const items = buildProgressItems({ ...empty, hasStory: true, characterCount: 1 });
    expect(items.find((i) => i.key === "shots")?.label).toBe("分鏡");
    expect(items.find((i) => i.key === "image")?.label).toBe("圖片");
    expect(items.find((i) => i.key === "review")?.label).toBe("審核");
  });
});
