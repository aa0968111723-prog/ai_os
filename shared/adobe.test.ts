import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_OPERATIONS,
  adobePhotoEditRequestSchema,
  adobeTimelineSchema,
  describePhotoEdit,
  describePhotoOperation,
  isTerminalJobStatus,
  timelineDurationSec,
  toFrames,
} from "./adobe";

describe("修圖請求契約", () => {
  it("套用預設輸出格式並保留操作順序", () => {
    const parsed = adobePhotoEditRequestSchema.parse({
      assetId: "mock-photo-001",
      operations: [{ op: "remove_background" }, { op: "resize", width: 1200, height: 800 }],
    });
    expect(parsed.outputFormat).toBe("png");
    expect(parsed.operations.map((o) => o.op)).toEqual(["remove_background", "resize"]);
  });

  it("超過操作上限即拒收（避免一次串太多步驟導致難以歸因）", () => {
    const operations = Array.from({ length: MAX_PHOTO_OPERATIONS + 1 }, () => ({ op: "auto_tone" as const }));
    expect(adobePhotoEditRequestSchema.safeParse({ assetId: "a", operations }).success).toBe(false);
  });

  it("拒絕未知操作", () => {
    expect(adobePhotoEditRequestSchema.safeParse({ assetId: "a", operations: [{ op: "run_script" }] }).success).toBe(false);
  });

  it("裁切尺寸必須為正整數", () => {
    const bad = { assetId: "a", operations: [{ op: "crop", x: 0, y: 0, width: 0, height: 10 }] };
    expect(adobePhotoEditRequestSchema.safeParse(bad).success).toBe(false);
  });

  it("描述是給人看的一句話（審批說明與稽核共用）", () => {
    expect(describePhotoOperation({ op: "remove_background" })).toBe("去背");
    expect(describePhotoOperation({ op: "resize", width: 800, height: 600, fit: "cover" })).toBe("縮放至 800×600");
    expect(describePhotoOperation({ op: "adjust", brightness: 10, contrast: -5 })).toBe("影像微調（亮度 +10、對比 -5）");
    expect(describePhotoOperation({ op: "adjust" })).toBe("影像微調");
    expect(describePhotoEdit(adobePhotoEditRequestSchema.parse({
      assetId: "a",
      operations: [{ op: "auto_tone" }, { op: "crop", x: 1, y: 2, width: 30, height: 40 }],
    }))).toBe("自動調色 → 裁切（30×40）");
  });
});

describe("時間軸契約", () => {
  const clip = (startSec: number, durationSec: number) => ({ assetId: "mock-clip-001", startSec, durationSec });

  it("成品長度＝最後片段的結束時刻", () => {
    const timeline = adobeTimelineSchema.parse({ name: "片頭", clips: [clip(0, 3), clip(3, 4.5)] });
    expect(timelineDurationSec(timeline)).toBeCloseTo(7.5);
    expect(timeline.fps).toBe(30);
    expect(timeline.clips[0].transition).toBe("none");
  });

  it("重疊片段直接擋下（單軌沒有明確語意）", () => {
    const result = adobeTimelineSchema.safeParse({ name: "重疊", clips: [clip(0, 5), clip(4, 2)] });
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0].message).toContain("重疊");
  });

  it("首尾相接不算重疊", () => {
    expect(adobeTimelineSchema.safeParse({ name: "相接", clips: [clip(0, 5), clip(5, 2)] }).success).toBe(true);
  });

  it("影格換算取整（交付 FCPXML／Premiere XML 需要整數影格）", () => {
    expect(toFrames(1.5, 30)).toBe(45);
    expect(toFrames(1 / 3, 24)).toBe(8);
  });
});

describe("工作狀態", () => {
  it("只有成功與失敗是終態", () => {
    expect(isTerminalJobStatus("succeeded")).toBe(true);
    expect(isTerminalJobStatus("failed")).toBe(true);
    expect(isTerminalJobStatus("running")).toBe(false);
    expect(isTerminalJobStatus("queued")).toBe(false);
  });
});
