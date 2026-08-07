/**
 * 匯出 MP4 的「渲染計畫」——純函式，不碰瀏覽器 API。
 *
 * 把分鏡列換算成「第幾影格要畫哪個素材的第幾秒、疊什麼字、什麼時候放哪段聲音」。
 * 這一層與 `renderTimeline.ts`（真的去解碼／編碼）分開，是因為換算錯了輸出的片子就錯了，
 * 而換算是唯一能在 CI 裡完整驗證的部分——編碼那段要真的瀏覽器才跑得起來。
 *
 * 時間一律走 `shared/timeline.ts` 的影格排版：匯出的 MP4 與交付包的 fcpxml／srt 切在同一格。
 */
import { TIMELINE_FPS, framesToSec, layoutTimeline, sourceInFrames, type Frames } from "@shared/timeline";
import { resolutionForFormat } from "@shared/options";

/** 渲染計畫吃的最小分鏡形狀（與 StoryboardPlayerScene 相容） */
export type RenderScene = {
  id: string;
  title: string;
  durationSec: number;
  voiceover: string | null;
  assetUrl: string | null;
  assetKind: string | null;
  narrationUrl?: string | null;
  ambienceUrl?: string | null;
  trimStartMs?: number | null;
  trimEndMs?: number | null;
};

export type RenderVisual = { kind: "video" | "image"; url: string };

export type RenderShotPlan = {
  index: number;
  sceneId: string;
  title: string;
  startFrames: Frames;
  endFrames: Frames;
  durationFrames: Frames;
  /** 素材上的入點（影格）——修剪後從這裡開始取 */
  sourceInFrames: Frames;
  /** 這一鏡要畫什麼；null＝無畫面素材（渲染成黑底＋標題卡） */
  visual: RenderVisual | null;
  /** 疊在畫面上的字幕；null＝這鏡沒配音詞 */
  subtitle: string | null;
};

export type AudioRole = "narration" | "ambience" | "asset";

export type AudioClipPlan = {
  url: string;
  startSec: number;
  durationSec: number;
  role: AudioRole;
};

export type RenderPlan = {
  fps: typeof TIMELINE_FPS;
  width: number;
  height: number;
  totalFrames: Frames;
  totalSec: number;
  shots: RenderShotPlan[];
  audio: AudioClipPlan[];
};

/**
 * 環境音相對旁白的音量。
 *
 * 這是「旁白閃避」的最簡形式：環境音固定壓低，而不是偵測旁白包絡動態閃避。
 * 本站的片子旁白幾乎全程都在，動態閃避的結果會非常接近固定壓低，
 * 卻要多背一套包絡分析——先給固定值，真的不夠再談。
 */
export const AMBIENCE_GAIN = 0.35;

/** 匯出片長上限（秒）。整支片會編在記憶體裡（mediabunny 的 BufferTarget），不設限會直接把分頁吃掉。 */
export const MAX_RENDER_SEC = 10 * 60;

/** 這一鏡要畫什麼：只有圖片與影片能入畫；音訊鏡與無素材鏡走標題卡 */
function visualOf(scene: RenderScene): RenderVisual | null {
  if (!scene.assetUrl) return null;
  if (scene.assetKind === "video") return { kind: "video", url: scene.assetUrl };
  if (scene.assetKind === "image") return { kind: "image", url: scene.assetUrl };
  return null;
}

/**
 * 組出渲染計畫。
 *
 * 聲音的來源有三種，全部掛在同一條混音上（與交付包的 lane -1／-2／-3 對應）：
 * 旁白、環境音、以及「素材本身就是音檔」的鏡。三者可以同時存在。
 */
export function buildRenderPlan(scenes: ReadonlyArray<RenderScene>, format?: string | null): RenderPlan {
  const layout = layoutTimeline(scenes);
  const res = resolutionForFormat(format);

  const shots: RenderShotPlan[] = layout.shots.map((t, i) => {
    const sc = scenes[i];
    return {
      index: i,
      sceneId: sc.id,
      title: sc.title,
      startFrames: t.startFrames,
      endFrames: t.endFrames,
      durationFrames: t.durationFrames,
      sourceInFrames: t.sourceInFrames,
      visual: visualOf(sc),
      subtitle: (sc.voiceover ?? "").trim() || null,
    };
  });

  const audio: AudioClipPlan[] = [];
  for (const [i, sc] of scenes.entries()) {
    const t = layout.shots[i];
    const startSec = t.startSec;
    const durationSec = framesToSec(t.durationFrames);
    if (sc.narrationUrl) audio.push({ url: sc.narrationUrl, startSec, durationSec, role: "narration" });
    if (sc.ambienceUrl) audio.push({ url: sc.ambienceUrl, startSec, durationSec, role: "ambience" });
    // 素材本身是音檔的鏡（配樂／原音）：畫面走標題卡，聲音照放
    if (sc.assetKind === "audio" && sc.assetUrl) {
      audio.push({ url: sc.assetUrl, startSec, durationSec, role: "asset" });
    }
  }

  return {
    fps: TIMELINE_FPS,
    width: res.width,
    height: res.height,
    totalFrames: layout.totalFrames,
    totalSec: layout.totalSec,
    shots,
    audio,
  };
}

/** 第 n 影格落在第幾鏡；超出片尾回最後一鏡（-1＝沒有任何鏡） */
export function shotIndexAtFrame(plan: RenderPlan, frame: Frames): number {
  if (plan.shots.length === 0) return -1;
  const found = plan.shots.findIndex((s) => frame >= s.startFrames && frame < s.endFrames);
  return found >= 0 ? found : plan.shots.length - 1;
}

/**
 * 第 n 影格要取素材的第幾秒。
 * 播放頭在時間軸上、取用點在素材上，差一個「該鏡起點」的位移——這個換算錯了，
 * 輸出的片子會播到素材的別處，而且錯得很安靜（畫面照常有東西，只是不對）。
 */
export function sourceTimeSecAtFrame(shot: RenderShotPlan, frame: Frames): number {
  const local = Math.max(0, Math.min(frame - shot.startFrames, shot.durationFrames - 1));
  return framesToSec(shot.sourceInFrames + local);
}

/** 這一鏡要送進解碼器的時間戳序列（秒），單調遞增——mediabunny 的批次取樣要求排序過 */
export function sourceTimestamps(shot: RenderShotPlan): number[] {
  const out: number[] = [];
  for (let k = 0; k < shot.durationFrames; k += 1) {
    out.push(framesToSec(shot.sourceInFrames + k));
  }
  return out;
}

/**
 * letterbox：把來源畫面等比縮放塞進輸出畫布，置中留黑邊。
 * 與預覽台的 `object-fit: contain` 同一套規則——預覽看到的構圖就是輸出的構圖。
 */
export function fitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { x: number; y: number; w: number; h: number } {
  if (!(srcW > 0) || !(srcH > 0) || !(dstW > 0) || !(dstH > 0)) return { x: 0, y: 0, w: 0, h: 0 };
  const scale = Math.min(dstW / srcW, dstH / srcH);
  const w = srcW * scale;
  const h = srcH * scale;
  return { x: (dstW - w) / 2, y: (dstH - h) / 2, w, h };
}

/** 匯出前的守門：太長就別開始，免得跑了十分鐘才把分頁撐爆 */
export function renderPlanBlocker(plan: RenderPlan): string | null {
  if (plan.shots.length === 0) return "還沒有分鏡可以輸出。";
  if (plan.totalSec > MAX_RENDER_SEC) {
    return `這支片 ${Math.round(plan.totalSec)} 秒，超過瀏覽器輸出上限 ${MAX_RENDER_SEC / 60} 分鐘——請改用交付包在剪輯軟體輸出。`;
  }
  return null;
}
