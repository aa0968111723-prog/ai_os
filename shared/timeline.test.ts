import { describe, expect, it } from "vitest";
import {
  FALLBACK_SHOT_SEC,
  LAYER_LANE,
  TIMELINE_FPS,
  fcpTimeFromFrames,
  framesToSec,
  isTrimmed,
  layoutTimeline,
  msToFrames,
  secToFrames,
  shotDurationFrames,
  shotFrames,
  sourceInFrames,
} from "./timeline";

describe("shotFrames — 鏡長的唯一規則", () => {
  it("正常鏡長換成影格", () => {
    expect(shotFrames(5)).toBe(150);
    expect(shotFrames(1)).toBe(30);
  });

  it("非整數鏡長四捨五入到最近影格（修剪功能的前提）", () => {
    expect(shotFrames(2.5)).toBe(75);
    expect(shotFrames(0.1)).toBe(3);
  });

  it("無效鏡長一律走退路秒數——這是預覽與交付先前唯一會分歧的地方", () => {
    const fallback = secToFrames(FALLBACK_SHOT_SEC);
    expect(shotFrames(0)).toBe(fallback);
    expect(shotFrames(-3)).toBe(fallback);
    expect(shotFrames(Number.NaN)).toBe(fallback);
    expect(shotFrames(Number.POSITIVE_INFINITY)).toBe(fallback);
  });
});

describe("layoutTimeline", () => {
  it("相鄰鏡首尾相接，不留縫也不重疊", () => {
    const { shots, totalFrames } = layoutTimeline([{ durationSec: 5 }, { durationSec: 3 }, { durationSec: 4 }]);
    expect(shots.map((s) => [s.startFrames, s.endFrames])).toEqual([
      [0, 150],
      [150, 240],
      [240, 360],
    ]);
    expect(totalFrames).toBe(360);
    for (let i = 1; i < shots.length; i += 1) expect(shots[i].startFrames).toBe(shots[i - 1].endFrames);
  });

  it("秒數由影格推回，與影格值必然同源", () => {
    const { shots } = layoutTimeline([{ durationSec: 2.5 }, { durationSec: 2.5 }]);
    expect(shots[0].endSec).toBe(2.5);
    expect(shots[1].startSec).toBe(2.5);
    expect(shots[1].endSec).toBe(5);
    for (const s of shots) {
      expect(s.startSec).toBe(framesToSec(s.startFrames));
      expect(s.durationSec).toBe(framesToSec(s.durationFrames));
    }
  });

  it("非整數鏡長不會累積浮點漂移——這是收斂時間模型的主要理由", () => {
    // 0.1 秒 × 100 鏡：浮點累加會漂到 9.99999999999998，影格累加必然落在整數影格上
    const shots = Array.from({ length: 100 }, () => ({ durationSec: 0.1 }));
    const { totalFrames, totalSec } = layoutTimeline(shots);
    expect(totalFrames).toBe(300);
    expect(totalSec).toBe(10);

    let floatDrift = 0;
    for (const s of shots) floatDrift += s.durationSec;
    expect(floatDrift).not.toBe(10); // 對照組：先前 srt/edl 走的就是這條路
  });

  it("空時間軸不炸", () => {
    expect(layoutTimeline([])).toEqual({ fps: TIMELINE_FPS, shots: [], totalFrames: 0, totalSec: 0 });
  });
});

describe("fcpTimeFromFrames", () => {
  it("整秒輸出可讀的 Ns", () => {
    expect(fcpTimeFromFrames(0)).toBe("0s");
    expect(fcpTimeFromFrames(150)).toBe("5s");
  });

  it("非整秒輸出影格有理數，不留浮點尾巴", () => {
    expect(fcpTimeFromFrames(75)).toBe("75/30s");
    expect(fcpTimeFromFrames(1)).toBe("1/30s");
  });
});

describe("LAYER_LANE", () => {
  it("軌道配置與 fcpxml 的 lane 一致：環境音不與音效共用軌", () => {
    expect(LAYER_LANE).toEqual({ visual: 0, narration: -1, sfx: -2, ambience: -3 });
    const lanes = Object.values(LAYER_LANE);
    expect(new Set(lanes).size).toBe(lanes.length);
  });
});

describe("修剪（ShotSource）", () => {
  it("未修剪的鏡行為與修剪功能上線前完全相同", () => {
    expect(shotDurationFrames({ durationSec: 5 })).toBe(150);
    expect(shotDurationFrames({ durationSec: 5, trimStartMs: 0, trimEndMs: null })).toBe(150);
    expect(sourceInFrames({ durationSec: 5 })).toBe(0);
    expect(isTrimmed({ durationSec: 5, trimStartMs: 0, trimEndMs: null })).toBe(false);
  });

  it("修剪過就用修剪區間，durationSec 不再決定鏡長", () => {
    // 8 秒素材取 2.0s–5.0s＝3 秒，即使 durationSec 還寫著 8
    const shot = { durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 };
    expect(sourceInFrames(shot)).toBe(60);
    expect(shotDurationFrames(shot)).toBe(90);
    expect(isTrimmed(shot)).toBe(true);
  });

  it("只給入點、沒給出點時鏡長仍走 durationSec", () => {
    const shot = { durationSec: 4, trimStartMs: 1500, trimEndMs: null };
    expect(sourceInFrames(shot)).toBe(45);
    expect(shotDurationFrames(shot)).toBe(120);
    expect(isTrimmed(shot)).toBe(true);
  });

  it("出點不大於入點時給 1 影格——零長度剪輯會讓 NLE 匯入整條軌報錯", () => {
    expect(shotDurationFrames({ durationSec: 5, trimStartMs: 3000, trimEndMs: 3000 })).toBe(1);
    // 出點早於入點是壞資料（router 會擋），這裡退回 durationSec 而不是產生負長度
    expect(shotDurationFrames({ durationSec: 5, trimStartMs: 3000, trimEndMs: 1000 })).toBe(150);
  });

  it("修剪點吸到影格，且不吃非有限值", () => {
    // 100ms = 3 影格；2050ms = 61.5 → 62 影格
    expect(msToFrames(100)).toBe(3);
    expect(msToFrames(2050)).toBe(62);
    expect(msToFrames(Number.NaN)).toBe(0);
    expect(sourceInFrames({ durationSec: 5, trimStartMs: Number.NaN })).toBe(0);
    expect(shotDurationFrames({ durationSec: 5, trimEndMs: Number.NaN })).toBe(150);
  });

  it("排版把修剪後的鏡長接起來：來源入點不影響時間軸位置", () => {
    const { shots, totalFrames } = layoutTimeline([
      { durationSec: 8, trimStartMs: 2000, trimEndMs: 5000 }, // 3 秒
      { durationSec: 2 }, // 2 秒
    ]);
    expect(shots[0].startFrames).toBe(0);
    expect(shots[0].durationFrames).toBe(90);
    expect(shots[0].sourceInFrames).toBe(60);
    expect(shots[0].sourceOutFrames).toBe(150);
    // 第二鏡緊接第一鏡的「時間軸」結束點，與素材上的出點無關
    expect(shots[1].startFrames).toBe(90);
    expect(totalFrames).toBe(150);
  });
});
