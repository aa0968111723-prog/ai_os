/**
 * 編碼器協商：偏好順序與「MP4 容器吃不吃得下」的一致性。
 *
 * 為什麼有這條測試——實測 Playwright 附的 Chromium（＝不含專有編碼器的 build，
 * Linux 發行版也常見）`canEncodeVideo("avc")` 回 false、AAC 也不支援，能用的只有
 * vp9／av1／vp8 ＋ opus。硬押 avc 會讓那些瀏覽器整個功能不可用。
 * 偏好清單裡若有 MP4 容器裝不下的編碼器，錯誤要在 CI 就被抓到，不是等到使用者按下輸出。
 */
import { describe, expect, it } from "vitest";
import { Mp4OutputFormat } from "mediabunny";
import { AUDIO_CODEC_PREFERENCE, RENDER_CHANNELS, RENDER_SAMPLE_RATE, VIDEO_CODEC_PREFERENCE } from "./capability";

describe("編碼器偏好清單", () => {
  const supported = new Set(new Mp4OutputFormat().getSupportedCodecs());

  it("每一個偏好編碼器 MP4 容器都裝得下", () => {
    for (const codec of [...VIDEO_CODEC_PREFERENCE, ...AUDIO_CODEC_PREFERENCE]) {
      expect(supported.has(codec)).toBe(true);
    }
  });

  it("首選是相容性最好的 H.264／AAC——這支片是要傳給夥伴的", () => {
    expect(VIDEO_CODEC_PREFERENCE[0]).toBe("avc");
    expect(AUDIO_CODEC_PREFERENCE[0]).toBe("aac");
  });

  it("備援涵蓋沒有專有編碼器的瀏覽器（實測 Chromium 只有這些）", () => {
    expect(VIDEO_CODEC_PREFERENCE).toContain("av1");
    expect(VIDEO_CODEC_PREFERENCE).toContain("vp9");
    // Firefox 編不動 AAC，Opus 是它唯一的路——沒有這一項 Firefox 會拿到無聲片
    expect(AUDIO_CODEC_PREFERENCE).toContain("opus");
  });

  it("沒有重複項（重複只會讓偵測多問一次，是清單維護失誤的徵兆）", () => {
    expect(new Set(VIDEO_CODEC_PREFERENCE).size).toBe(VIDEO_CODEC_PREFERENCE.length);
    expect(new Set(AUDIO_CODEC_PREFERENCE).size).toBe(AUDIO_CODEC_PREFERENCE.length);
  });

  it("輸出音訊規格是常規值", () => {
    expect(RENDER_SAMPLE_RATE).toBe(48_000);
    expect(RENDER_CHANNELS).toBe(2);
  });
});
