import { describe, expect, it } from "vitest";
import { deriveProjectStatusSummary } from "./projectStatusSummary";

const empty = {
  hasStory: false,
  characterCount: 0,
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
    expect(s.progressItems.find((p) => p.key === "film")?.label).toBe("影片 5/12");
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
    const s = deriveProjectStatusSummary({ ...empty, hasStory: true, shots: 3, shotsWithVisual: 1 });
    expect(s.progressItems.map((p) => p.anchor)).toEqual([
      "stage-story",
      "sec-characters",
      "stage-board",
      "stage-create",
    ]);
  });
});
