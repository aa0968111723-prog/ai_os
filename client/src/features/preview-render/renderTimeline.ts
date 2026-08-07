/**
 * 在瀏覽器裡把時間軸算成一支 MP4。
 *
 * 用途明確是「**預覽畫質**、給夥伴看節奏」，不是母帶——精修仍在 Premiere 完成（見
 * docs/product/剪輯台-最後串接研究報告.md 的定案）。這決定了很多取捨：位元率取中檔、
 * 整支片編在記憶體裡、不做轉場與特效。要那些請走交付包。
 *
 * 為什麼是瀏覽器而不是伺服器：正式站跑在 node:22-alpine，映像裡沒有 ffmpeg，
 * 加進去要背映像體積與 CPU 預算；而預覽畫質的短片在本機用 WebCodecs 編幾乎不花錢。
 * 代價是覆蓋率缺口（見 capability.ts），所以那條路必須明確擋掉而不是沉默失敗。
 */
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_MEDIUM,
  VideoSampleSink,
} from "mediabunny";
import { framesToSec } from "@shared/timeline";
import { RENDER_CHANNELS, RENDER_SAMPLE_RATE, type RenderCodecs } from "./capability";
import {
  AMBIENCE_GAIN,
  fitRect,
  sourceTimestamps,
  type RenderPlan,
  type RenderShotPlan,
} from "./renderPlan";

export type RenderPhase = "audio" | "video" | "finalize";
export type RenderProgress = { phase: RenderPhase; done: number; total: number };

export type RenderOptions = {
  onProgress?: (p: RenderProgress) => void;
  /** 取消輸出（使用者關掉面板／按取消）；中止時丟 DOMException("AbortError") */
  signal?: AbortSignal;
  /** 由 `detectRenderSupport()` 協商出來的編碼器；`audio: null`＝輸出無聲片 */
  codecs: RenderCodecs;
};

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("輸出已取消", "AbortError");
}

async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  // 素材走同源 /api/assets/:id/file，帶 cookie 才過得了登入與組隔離守衛
  const res = await fetch(url, { credentials: "same-origin", signal });
  if (!res.ok) throw new Error(`素材讀取失敗（${res.status}）：${url}`);
  return res.blob();
}

/**
 * 把所有聲音混成一條軌。
 *
 * 走 OfflineAudioContext 而不是逐段編碼再拼接：拼接要自己處理取樣率轉換與段落邊界，
 * 而混音本來就是 Web Audio 的工作，且它一次算完整條、沒有累積誤差。
 * 個別音檔比該鏡長就截斷（`start` 的第三參數），短就自然留白——與交付包的行為一致。
 */
async function renderAudioTrack(plan: RenderPlan, opts: RenderOptions): Promise<AudioBuffer | null> {
  if (plan.audio.length === 0) return null;
  const frames = Math.ceil(plan.totalSec * RENDER_SAMPLE_RATE);
  if (frames <= 0) return null;

  const ctx = new OfflineAudioContext(RENDER_CHANNELS, frames, RENDER_SAMPLE_RATE);
  let done = 0;
  for (const clip of plan.audio) {
    throwIfAborted(opts.signal);
    try {
      const blob = await fetchBlob(clip.url, opts.signal);
      const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
      const src = ctx.createBufferSource();
      src.buffer = decoded;
      const gain = ctx.createGain();
      gain.gain.value = clip.role === "ambience" ? AMBIENCE_GAIN : 1;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(clip.startSec, 0, Math.min(clip.durationSec, decoded.duration));
    } catch (err) {
      // 單一音檔壞掉不該讓整支片輸不出來——那一段靜音，其餘照常。
      // 素材遺失在這個站是會發生的（軟刪／清理），預覽台本來就有「此鏡素材遺失」的降級。
      if ((err as DOMException)?.name === "AbortError") throw err;
    }
    done += 1;
    opts.onProgress?.({ phase: "audio", done, total: plan.audio.length });
  }
  return ctx.startRendering();
}

/** 這一鏡的畫面來源：影片走解碼器逐格取樣，圖片載一次重複畫 */
type VisualSource =
  | { kind: "video"; input: Input; sink: VideoSampleSink }
  | { kind: "image"; bitmap: ImageBitmap }
  | { kind: "none" };

async function openVisual(shot: RenderShotPlan, opts: RenderOptions): Promise<VisualSource> {
  if (!shot.visual) return { kind: "none" };
  try {
    const blob = await fetchBlob(shot.visual.url, opts.signal);
    if (shot.visual.kind === "image") {
      return { kind: "image", bitmap: await createImageBitmap(blob) };
    }
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return { kind: "none" };
    return { kind: "video", input, sink: new VideoSampleSink(track) };
  } catch (err) {
    if ((err as DOMException)?.name === "AbortError") throw err;
    return { kind: "none" }; // 素材遺失／解不開：這一鏡渲染成標題卡，不中斷整支片
  }
}

/** 無畫面（或素材遺失）的鏡：黑底＋鏡頭標題，讓人看得出這裡有一鏡待補 */
function drawTitleCard(ctx: CanvasRenderingContext2D, plan: RenderPlan, shot: RenderShotPlan) {
  ctx.fillStyle = "#0d0c0b";
  ctx.fillRect(0, 0, plan.width, plan.height);
  ctx.fillStyle = "#d2cfca";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(plan.height * 0.055)}px "Noto Sans TC", sans-serif`;
  ctx.fillText(shot.title, plan.width / 2, plan.height / 2, plan.width * 0.86);
}

/**
 * 字幕：位置與樣式比照預覽台疊在畫面上的那一版——預覽看到的就是輸出的。
 * 描邊＋陰影是為了亮底畫面也讀得到；沒有換行演算法，過長的句子交給 maxWidth 壓縮。
 */
function drawSubtitle(ctx: CanvasRenderingContext2D, plan: RenderPlan, text: string) {
  const size = Math.round(plan.height * 0.045);
  ctx.font = `${size}px "Noto Sans TC", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  const x = plan.width / 2;
  const y = plan.height * 0.93;
  const maxWidth = plan.width * 0.84;
  ctx.lineWidth = Math.max(2, Math.round(size * 0.16));
  ctx.strokeStyle = "rgba(0,0,0,0.92)";
  ctx.strokeText(text, x, y, maxWidth);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x, y, maxWidth);
}

/**
 * 主流程：混音 → 逐格畫 → 收檔。
 *
 * 影格用 `samplesAtTimestamps` 批次取：時間戳在同一鏡內單調遞增，mediabunny 因此只解碼一次
 * 每個 packet；逐格呼叫 `getSample` 會讓每格都重走一次尋道，長片會慢到不能用。
 */
export async function renderTimelineToMp4(plan: RenderPlan, opts: RenderOptions): Promise<Blob> {
  throwIfAborted(opts.signal);

  // 先混音：它比逐格渲染快得多，失敗的話不必等整支片畫完才知道
  const audioBuffer = opts.codecs.audio ? await renderAudioTrack(plan, opts) : null;
  throwIfAborted(opts.signal);

  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("無法建立畫布——這個瀏覽器不支援 2D canvas。");

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: opts.codecs.video, bitrate: QUALITY_MEDIUM });
  output.addVideoTrack(videoSource, { frameRate: plan.fps });
  const audioSource =
    audioBuffer && opts.codecs.audio
      ? new AudioBufferSource({ codec: opts.codecs.audio, bitrate: QUALITY_MEDIUM })
      : null;
  if (audioSource) output.addAudioTrack(audioSource);

  await output.start();

  const frameDur = framesToSec(1);
  let framesDone = 0;

  try {
    for (const shot of plan.shots) {
      throwIfAborted(opts.signal);
      const visual = await openVisual(shot, opts);
      try {
        if (visual.kind === "video") {
          const stamps = sourceTimestamps(shot);
          let k = 0;
          for await (const sample of visual.sink.samplesAtTimestamps(stamps)) {
            throwIfAborted(opts.signal);
            if (sample) {
              ctx.fillStyle = "#000000";
              ctx.fillRect(0, 0, plan.width, plan.height);
              const box = fitRect(sample.displayWidth, sample.displayHeight, plan.width, plan.height);
              sample.draw(ctx, box.x, box.y, box.w, box.h);
              sample.close();
            }
            // sample 為 null＝該時間點沒有影格（素材比鏡短）：保留畫布上一格，形同定格
            if (shot.subtitle) drawSubtitle(ctx, plan, shot.subtitle);
            await videoSource.add(framesToSec(shot.startFrames + k), frameDur);
            k += 1;
            framesDone += 1;
            opts.onProgress?.({ phase: "video", done: framesDone, total: plan.totalFrames });
          }
          // 解碼器給的影格數可能少於需求（素材比鏡短）：用最後一格補滿，鏡長才不會縮水
          for (; k < shot.durationFrames; k += 1) {
            throwIfAborted(opts.signal);
            await videoSource.add(framesToSec(shot.startFrames + k), frameDur);
            framesDone += 1;
            opts.onProgress?.({ phase: "video", done: framesDone, total: plan.totalFrames });
          }
        } else {
          for (let k = 0; k < shot.durationFrames; k += 1) {
            throwIfAborted(opts.signal);
            if (visual.kind === "image") {
              ctx.fillStyle = "#000000";
              ctx.fillRect(0, 0, plan.width, plan.height);
              const box = fitRect(visual.bitmap.width, visual.bitmap.height, plan.width, plan.height);
              ctx.drawImage(visual.bitmap, box.x, box.y, box.w, box.h);
            } else {
              drawTitleCard(ctx, plan, shot);
            }
            if (shot.subtitle) drawSubtitle(ctx, plan, shot.subtitle);
            await videoSource.add(framesToSec(shot.startFrames + k), frameDur);
            framesDone += 1;
            opts.onProgress?.({ phase: "video", done: framesDone, total: plan.totalFrames });
          }
        }
      } finally {
        // 解碼器與 ImageBitmap 都握著原生資源，一鏡畫完就放掉——長片累積起來會吃爆記憶體
        if (visual.kind === "video") visual.input.dispose();
        else if (visual.kind === "image") visual.bitmap.close();
      }
    }

    if (audioSource && audioBuffer) await audioSource.add(audioBuffer);

    opts.onProgress?.({ phase: "finalize", done: 0, total: 1 });
    await output.finalize();
    opts.onProgress?.({ phase: "finalize", done: 1, total: 1 });
  } catch (err) {
    // 取消或失敗都要放掉編碼器，否則分頁會一直握著硬體編碼器不放
    await output.cancel().catch(() => {});
    throw err;
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error("輸出完成但沒有產生檔案內容。");
  return new Blob([buffer], { type: "video/mp4" });
}
