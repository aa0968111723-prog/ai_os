/**
 * 渲染計畫：把分鏡換算成「第幾影格畫素材的第幾秒、放哪段聲音」。
 *
 * 這是輸出 MP4 唯一能在 CI 完整驗證的部分——真的編碼要瀏覽器才跑得起來。
 * 換算錯了輸出的片子會安靜地錯（畫面照常有東西，只是不對），所以邊界全部釘住。
 */
import { describe, expect, it } from "vitest";
import {
  AMBIENCE_GAIN,
  MAX_RENDER_SEC,
  buildRenderPlan,
  fitRect,
  renderPlanBlocker,
  shotIndexAtFrame,
  sourceTimeSecAtFrame,
  sourceTimestamps,
  type RenderScene,
} from "./renderPlan";

const scene = (over: Partial<RenderScene> = {}): RenderScene => ({
  id: "s1",
  title: "第一鏡",
  durationSec: 4,
  voiceover: null,
  assetUrl: "https://example.test/a.mp4",
  assetKind: "video",
  ...over,
});

describe("buildRenderPlan", () => {
  it("解析度依專案比例；片長是修剪後長度的總和", () => {
    const plan = buildRenderPlan(
      [scene({ id: "a", durationSec: 4 }), scene({ id: "b", durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 })],
      "9:16",
    );
    expect([plan.width, plan.height]).toEqual([1080, 1920]);
    expect(plan.totalFrames).toBe(120 + 90);
    expect(plan.totalSec).toBe(7);
  });

  it("鏡的來源入點帶進計畫——修剪後要從素材的那裡開始取", () => {
    const plan = buildRenderPlan([scene({ durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 })]);
    expect(plan.shots[0].sourceInFrames).toBe(60);
    expect(plan.shots[0].durationFrames).toBe(90);
  });

  it("只有圖片與影片能入畫；音訊鏡與無素材鏡走標題卡", () => {
    const plan = buildRenderPlan([
      scene({ id: "v", assetKind: "video" }),
      scene({ id: "i", assetKind: "image", assetUrl: "https://example.test/a.jpg" }),
      scene({ id: "a", assetKind: "audio", assetUrl: "https://example.test/a.mp3" }),
      scene({ id: "n", assetKind: null, assetUrl: null }),
    ]);
    expect(plan.shots.map((s) => s.visual?.kind ?? null)).toEqual(["video", "image", null, null]);
  });

  it("三種聲音都掛上同一條混音，時間對齊各自的鏡", () => {
    const plan = buildRenderPlan([
      scene({ id: "a", durationSec: 2, narrationUrl: "n1.mp3", ambienceUrl: "amb.mp3" }),
      scene({ id: "b", durationSec: 3, assetKind: "audio", assetUrl: "music.mp3" }),
    ]);
    expect(plan.audio).toEqual([
      { url: "n1.mp3", startSec: 0, durationSec: 2, role: "narration" },
      { url: "amb.mp3", startSec: 0, durationSec: 2, role: "ambience" },
      { url: "music.mp3", startSec: 2, durationSec: 3, role: "asset" },
    ]);
  });

  it("環境音固定壓低——最簡形式的旁白閃避", () => {
    expect(AMBIENCE_GAIN).toBeLessThan(1);
    expect(AMBIENCE_GAIN).toBeGreaterThan(0);
  });

  it("空白配音詞不會變成一塊空字幕", () => {
    const plan = buildRenderPlan([scene({ voiceover: "   " }), scene({ id: "s2", voiceover: "有詞" })]);
    expect(plan.shots[0].subtitle).toBeNull();
    expect(plan.shots[1].subtitle).toBe("有詞");
  });
});

describe("影格 → 素材位置", () => {
  it("未修剪：時間軸第 n 格就是素材第 n 格", () => {
    const plan = buildRenderPlan([scene({ durationSec: 2 })]);
    expect(sourceTimeSecAtFrame(plan.shots[0], 0)).toBe(0);
    expect(sourceTimeSecAtFrame(plan.shots[0], 30)).toBe(1);
  });

  it("已修剪：時間軸第 0 格對應素材的入點，不是素材開頭", () => {
    const plan = buildRenderPlan([scene({ durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 })]);
    expect(sourceTimeSecAtFrame(plan.shots[0], 0)).toBe(2);
    expect(sourceTimeSecAtFrame(plan.shots[0], 30)).toBe(3);
  });

  it("第二鏡的素材位置從自己的入點算，不受前面鏡的時間軸位移影響", () => {
    const plan = buildRenderPlan([
      scene({ id: "a", durationSec: 2 }),
      scene({ id: "b", durationSec: 8, trimStartMs: 1000, trimEndMs: 3000 }),
    ]);
    // 第二鏡在時間軸上從第 60 格開始，素材則從第 1 秒開始
    expect(plan.shots[1].startFrames).toBe(60);
    expect(sourceTimeSecAtFrame(plan.shots[1], 60)).toBe(1);
    expect(sourceTimeSecAtFrame(plan.shots[1], 90)).toBe(2);
  });

  it("超出鏡尾的影格夾在最後一格，不會取到修剪範圍外", () => {
    const plan = buildRenderPlan([scene({ durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 })]);
    // 這一鏡只有 90 格（0..89）；要第 200 格時應夾到第 89 格＝素材 2 + 89/30 秒
    expect(sourceTimeSecAtFrame(plan.shots[0], 200)).toBeCloseTo(2 + 89 / 30, 6);
  });

  it("送進解碼器的時間戳單調遞增且數量等於鏡長", () => {
    const plan = buildRenderPlan([scene({ durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 })]);
    const stamps = sourceTimestamps(plan.shots[0]);
    expect(stamps).toHaveLength(90);
    expect(stamps[0]).toBe(2);
    for (let i = 1; i < stamps.length; i += 1) expect(stamps[i]).toBeGreaterThan(stamps[i - 1]);
  });
});

describe("shotIndexAtFrame", () => {
  it("找出影格落在第幾鏡；超出片尾回最後一鏡", () => {
    const plan = buildRenderPlan([scene({ id: "a", durationSec: 1 }), scene({ id: "b", durationSec: 1 })]);
    expect(shotIndexAtFrame(plan, 0)).toBe(0);
    expect(shotIndexAtFrame(plan, 29)).toBe(0);
    expect(shotIndexAtFrame(plan, 30)).toBe(1);
    expect(shotIndexAtFrame(plan, 999)).toBe(1);
  });

  it("空計畫回 -1，不是假裝有第 0 鏡", () => {
    expect(shotIndexAtFrame(buildRenderPlan([]), 0)).toBe(-1);
  });
});

describe("fitRect（letterbox）", () => {
  it("來源比輸出寬：上下留黑邊，水平填滿", () => {
    expect(fitRect(1920, 1080, 1080, 1920)).toEqual({ x: 0, y: 656.25, w: 1080, h: 607.5 });
  });

  it("來源比輸出窄：左右留黑邊", () => {
    const r = fitRect(1080, 1920, 1920, 1080);
    expect(r.h).toBe(1080);
    expect(r.w).toBeCloseTo(607.5, 6);
    expect(r.y).toBe(0);
    expect(r.x).toBeCloseTo((1920 - 607.5) / 2, 6);
  });

  it("比例相同就完全填滿，不留邊", () => {
    expect(fitRect(1920, 1080, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it("尺寸為 0／負值不炸，回退成空矩形", () => {
    expect(fitRect(0, 1080, 1920, 1080)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(fitRect(1920, 1080, -1, 1080)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe("renderPlanBlocker", () => {
  it("沒有分鏡就別開始", () => {
    expect(renderPlanBlocker(buildRenderPlan([]))).toMatch(/還沒有分鏡/);
  });

  it("超過片長上限時明確擋下並指向交付包——不要跑十分鐘才把分頁撐爆", () => {
    const long = buildRenderPlan([scene({ durationSec: MAX_RENDER_SEC + 1 })]);
    expect(renderPlanBlocker(long)).toMatch(/交付包/);
  });

  it("正常片長放行", () => {
    expect(renderPlanBlocker(buildRenderPlan([scene({ durationSec: 5 })]))).toBeNull();
  });
});
