/**
 * Adobe PR4：把 AdobeTimeline 轉成既有剪輯交付格式（FCPXML / Premiere xmeml / EDL）。
 *
 * 為什麼不走 Adobe 雲端算圖：Adobe 沒有穩定公開的「時間軸 → 成片」API；
 * roadmap 已定正解是產出 NLE 可匯入的時間軸檔，素材在剪輯軟體內 relink。
 *
 * 本模組只做純轉換，不碰 token、不出網、不讀資料庫——mock/real 模式都可用。
 */
import {
  timelineDurationSec,
  type AdobeTimeline,
  type AdobeTimelineClip,
} from "../../../shared/adobe";
import {
  buildEdl,
  buildFcpxml,
  buildXmeml,
  type TimelineFileOpts,
  type TimelineScene,
} from "../exporter";

/** 匯出選項：可選把 Adobe assetId 對應到交付包內相對路徑（有本機檔才會掛 media-rep） */
export type AdobeTimelineExportOpts = TimelineFileOpts & {
  /** assetId → zip 內相對路徑（如 01_視頻素材/01_開場.mp4）；未對到的片段走離線佔位 */
  mediaPathByAssetId?: Record<string, string>;
  /** assetId → 媒體類型；省略時依副檔名猜測，再不行當 video */
  mediaKindByAssetId?: Record<string, "video" | "image" | "audio">;
};

export type AdobeTimelineExportBundle = {
  fcpxml: string;
  xmeml: string;
  edl: string;
  /** 轉換後的分鏡列（含空檔佔位），方便除錯與後續剪映草稿銜接 */
  scenes: TimelineScene[];
  durationSec: number;
  sceneCount: number;
};

/** 依副檔名粗猜媒體類型（僅在呼叫端沒給 mediaKind 時使用） */
function guessKind(path: string): "video" | "image" | "audio" {
  const lower = path.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|bmp|tiff?)$/.test(lower)) return "image";
  if (/\.(mp3|wav|aac|m4a|flac|ogg)$/.test(lower)) return "audio";
  return "video";
}

/** 片段標題：短、可讀、進 XML 檔名也安全 */
function clipTitle(clip: AdobeTimelineClip, index: number): string {
  const id = clip.assetId.replace(/[^\w\u4e00-\u9fff.-]+/g, "_").slice(0, 28);
  return `Adobe_${index + 1}_${id || "clip"}`;
}

/** 備註進 note／mastercomment：資產 id + 轉場（方便在 NLE 裡對位） */
function clipNote(clip: AdobeTimelineClip): string {
  const parts = [`Adobe 資產 ${clip.assetId}`];
  if (clip.transition && clip.transition !== "none") {
    parts.push(`轉場 ${clip.transition}`);
  }
  if (clip.inSec > 0) {
    parts.push(`素材起點 ${clip.inSec.toFixed(2)}s`);
  }
  if (clip.gainDb !== 0) {
    parts.push(`音量 ${clip.gainDb > 0 ? "+" : ""}${clip.gainDb}dB`);
  }
  return parts.join("｜");
}

/**
 * AdobeTimeline → 交付用 TimelineScene[]。
 * - 依 startSec 排序（契約已擋重疊，但呼叫端可能略過 schema）
 * - 片段之間的空隙補「空檔」列，保住時間軸節奏
 * - 有 mediaPathByAssetId 才掛媒體；否則離線佔位（匯入後 relink）
 */
export function adobeTimelineToScenes(
  timeline: AdobeTimeline,
  opts: AdobeTimelineExportOpts = {},
): TimelineScene[] {
  const sorted = [...timeline.clips].sort((a, b) => a.startSec - b.startSec);
  const scenes: TimelineScene[] = [];
  let cursor = 0;
  let clipIndex = 0;

  for (const clip of sorted) {
    if (clip.startSec > cursor + 1e-6) {
      scenes.push({
        title: `空檔 ${scenes.length + 1}`,
        durationSec: clip.startSec - cursor,
        voiceover: null,
        mediaPath: null,
        mediaKind: null,
      });
    }

    const mediaPath = opts.mediaPathByAssetId?.[clip.assetId] ?? null;
    const mediaKind = mediaPath
      ? (opts.mediaKindByAssetId?.[clip.assetId] ?? guessKind(mediaPath))
      : null;

    scenes.push({
      title: clipTitle(clip, clipIndex),
      durationSec: clip.durationSec,
      voiceover: clipNote(clip),
      mediaPath,
      mediaKind,
    });
    clipIndex += 1;
    cursor = Math.max(cursor, clip.startSec + clip.durationSec);
  }

  return scenes;
}

/**
 * 產出一整包剪輯時間軸字串（FCPXML + Premiere XML + EDL）。
 * 解析度／fps 取自 timeline；pathPrefix 預設同層（單檔下載），交付包子資料夾可傳 "../"。
 */
export function exportAdobeTimelineFormats(
  timeline: AdobeTimeline,
  opts: AdobeTimelineExportOpts = {},
): AdobeTimelineExportBundle {
  const fileOpts: TimelineFileOpts = {
    pathPrefix: opts.pathPrefix,
    width: opts.width ?? timeline.width,
    height: opts.height ?? timeline.height,
  };
  const scenes = adobeTimelineToScenes(timeline, opts);
  return {
    fcpxml: buildFcpxml(scenes, timeline.name, fileOpts),
    xmeml: buildXmeml(scenes, timeline.name, fileOpts),
    edl: buildEdl(scenes, timeline.name),
    scenes,
    durationSec: timelineDurationSec(timeline),
    sceneCount: scenes.length,
  };
}
