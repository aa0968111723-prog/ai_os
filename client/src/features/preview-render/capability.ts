/**
 * 瀏覽器能不能在本機輸出 MP4，以及該用哪組編碼器。
 *
 * WebCodecs 到 2026 年覆蓋約 95%，但缺口是**具體的**、不是四捨五入掉的零頭：
 * Safari 要 26 以上才完整、Firefox on Android 完全沒有。這些人按下「輸出 MP4」不能
 * 得到一個沉默失敗的轉圈圈——要明確說不支援，並把替代路徑（交付包）指出來。
 *
 * **為什麼要協商編碼器而不是直接用 H.264**：實測 Playwright 附的 Chromium
 * （＝不含專有編碼器的 Chromium build，Linux 發行版也常見）`canEncodeVideo("avc")`
 * 回 false、AAC 也不支援，能用的只有 vp9／av1／vp8 ＋ opus。硬押 avc 的話這些瀏覽器
 * 會整個功能不可用，而 MP4 容器其實這些編碼器全吃得下（mediabunny 的
 * `Mp4OutputFormat.getSupportedCodecs()` 明列）。
 *
 * 這件事順帶解決了 Firefox：它不支援 AAC 編碼，先前的設計會讓 Firefox 使用者拿到
 * 一支無聲的片；改成協商之後它會拿到 Opus，有聲音。
 */
// mediabunny 只用 type import：它是整包最大的相依之一（約 400kB），
// 而大多數人開預覽台只是想看節奏。實際的能力查詢在 detectRenderSupport() 裡動態載入，
// 與 renderTimeline 落在同一個延遲 chunk——按下「輸出 MP4」才付這個代價。
import type { AudioCodec, VideoCodec } from "mediabunny";

/**
 * 影像編碼器偏好順序＝**可分享性**由高到低。
 * H.264 什麼都播得動，是首選；沒有才退到 AV1／VP9（現代播放器與瀏覽器都吃，
 * 但舊版 QuickTime 之類可能不行）。這支片是要傳給夥伴的，相容性優先於檔案大小。
 */
export const VIDEO_CODEC_PREFERENCE: VideoCodec[] = ["avc", "av1", "vp9", "vp8"];

/** 音訊同理：AAC 相容性最好，Opus 是次選（Firefox 唯一能編的） */
export const AUDIO_CODEC_PREFERENCE: AudioCodec[] = ["aac", "opus"];

/** 輸出音訊的取樣率／聲道 */
export const RENDER_SAMPLE_RATE = 48_000;
export const RENDER_CHANNELS = 2;

export type RenderCodecs = {
  video: VideoCodec;
  /** null＝這個瀏覽器編不動任何一種音訊，輸出無聲片 */
  audio: AudioCodec | null;
};

export type RenderSupport = { ok: true; codecs: RenderCodecs } | { ok: false; reason: string };

/**
 * 偵測這台瀏覽器能不能輸出，並選出實際要用的編碼器。
 *
 * 問的是**真正要用的設定**（解析度、聲道、取樣率），不是 `typeof VideoEncoder`——
 * 有 VideoEncoder 不代表這台機器編得動 1080p。
 */
export async function detectRenderSupport(width: number, height: number): Promise<RenderSupport> {
  if (typeof window === "undefined") return { ok: false, reason: "非瀏覽器環境" };
  if (typeof VideoEncoder === "undefined") {
    return {
      ok: false,
      reason: "這個瀏覽器沒有 WebCodecs（Safari 需 26 以上、Firefox on Android 不支援）——請改用交付包在剪輯軟體輸出。",
    };
  }
  if (typeof OfflineAudioContext === "undefined") {
    return { ok: false, reason: "這個瀏覽器沒有 Web Audio，無法混音——請改用交付包。" };
  }

  const { getFirstEncodableAudioCodec, getFirstEncodableVideoCodec } = await import("mediabunny");

  let video: VideoCodec | null = null;
  try {
    video = await getFirstEncodableVideoCodec(VIDEO_CODEC_PREFERENCE, { width, height });
  } catch {
    video = null;
  }
  if (!video) {
    return { ok: false, reason: `這個瀏覽器編不動 ${width}×${height} 的影片——請改用交付包在剪輯軟體輸出。` };
  }

  let audio: AudioCodec | null = null;
  try {
    audio = await getFirstEncodableAudioCodec(AUDIO_CODEC_PREFERENCE, {
      numberOfChannels: RENDER_CHANNELS,
      sampleRate: RENDER_SAMPLE_RATE,
    });
  } catch {
    audio = null;
  }

  return { ok: true, codecs: { video, audio } };
}
