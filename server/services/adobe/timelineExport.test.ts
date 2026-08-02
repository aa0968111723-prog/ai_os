/**
 * Adobe PR4：時間軸 → NLE 交付格式單元測試。
 */
import { describe, expect, it } from "vitest";
import { adobeTimelineSchema } from "../../../shared/adobe";
import { adobeTimelineToScenes, exportAdobeTimelineFormats } from "./timelineExport";

const base = {
  name: "測試時間軸",
  fps: 30 as const,
  width: 1920,
  height: 1080,
};

describe("adobeTimelineToScenes", () => {
  it("首尾相接的片段不插入空檔", () => {
    const timeline = adobeTimelineSchema.parse({
      ...base,
      clips: [
        { assetId: "a1", startSec: 0, durationSec: 3 },
        { assetId: "a2", startSec: 3, durationSec: 2 },
      ],
    });
    const scenes = adobeTimelineToScenes(timeline);
    expect(scenes).toHaveLength(2);
    expect(scenes[0].durationSec).toBe(3);
    expect(scenes[1].durationSec).toBe(2);
    expect(scenes[0].voiceover).toContain("Adobe 資產 a1");
  });

  it("片段之間的空隙補空檔列，保住節奏", () => {
    const timeline = adobeTimelineSchema.parse({
      ...base,
      clips: [
        { assetId: "a1", startSec: 0, durationSec: 2 },
        { assetId: "a2", startSec: 5, durationSec: 1 },
      ],
    });
    const scenes = adobeTimelineToScenes(timeline);
    expect(scenes).toHaveLength(3);
    expect(scenes[1].title).toMatch(/^空檔/);
    expect(scenes[1].durationSec).toBeCloseTo(3);
    expect(scenes[1].mediaPath).toBeNull();
  });

  it("有 mediaPathByAssetId 時掛媒體路徑與類型", () => {
    const timeline = adobeTimelineSchema.parse({
      ...base,
      clips: [{ assetId: "photo-1", startSec: 0, durationSec: 4 }],
    });
    const scenes = adobeTimelineToScenes(timeline, {
      mediaPathByAssetId: { "photo-1": "03_圖像/01_封面.jpg" },
    });
    expect(scenes[0].mediaPath).toBe("03_圖像/01_封面.jpg");
    expect(scenes[0].mediaKind).toBe("image");
  });

  it("轉場／素材起點／音量寫進備註", () => {
    const timeline = adobeTimelineSchema.parse({
      ...base,
      clips: [
        {
          assetId: "v1",
          startSec: 0,
          durationSec: 2,
          inSec: 1.25,
          transition: "cross_dissolve",
          gainDb: -3,
        },
      ],
    });
    const note = adobeTimelineToScenes(timeline)[0].voiceover ?? "";
    expect(note).toContain("轉場 cross_dissolve");
    expect(note).toContain("素材起點 1.25s");
    expect(note).toContain("音量 -3dB");
  });
});

describe("exportAdobeTimelineFormats", () => {
  it("產出合法 FCPXML／xmeml／EDL，長度與片段一致", () => {
    const timeline = adobeTimelineSchema.parse({
      ...base,
      name: "片頭組",
      clips: [
        { assetId: "c1", startSec: 0, durationSec: 5 },
        { assetId: "c2", startSec: 5, durationSec: 4.5 },
      ],
    });
    const bundle = exportAdobeTimelineFormats(timeline);
    expect(bundle.durationSec).toBeCloseTo(9.5);
    expect(bundle.sceneCount).toBe(2);
    expect(bundle.fcpxml).toContain(`<fcpxml version="1.9">`);
    expect(bundle.fcpxml).toContain(`<project name="片頭組">`);
    // 5 + 4.5 = 9.5s → 285/30s
    expect(bundle.fcpxml).toContain(`duration="285/30s"`);
    expect(bundle.xmeml).toContain(`<xmeml version="4">`);
    expect(bundle.xmeml).toContain(`<name>片頭組</name>`);
    // 9.5 * 30 = 285 影格
    expect(bundle.xmeml).toContain(`<duration>285</duration>`);
    expect(bundle.edl).toContain("TITLE: 片頭組");
    expect(bundle.edl).toContain("001  AX");
  });

  it("直式解析度帶入 FCPXML format", () => {
    const timeline = adobeTimelineSchema.parse({
      name: "直式",
      fps: 30,
      width: 1080,
      height: 1920,
      clips: [{ assetId: "v", startSec: 0, durationSec: 2 }],
    });
    const { fcpxml } = exportAdobeTimelineFormats(timeline);
    expect(fcpxml).toContain(`width="1080" height="1920"`);
    expect(fcpxml).not.toContain(`name="FFVideoFormat1080p30"`);
  });

  it("掛上媒體路徑時 FCPXML 產出 media-rep", () => {
    const timeline = adobeTimelineSchema.parse({
      ...base,
      clips: [{ assetId: "vid", startSec: 0, durationSec: 3 }],
    });
    const { fcpxml } = exportAdobeTimelineFormats(timeline, {
      pathPrefix: "../",
      mediaPathByAssetId: { vid: "01_視頻素材/01_開場.mp4" },
    });
    expect(fcpxml).toContain("<media-rep");
    expect(fcpxml).toContain(encodeURIComponent("01_視頻素材"));
  });
});
