import { describe, expect, it } from "vitest";
import {
  FALLBACK_SHOT_SEC,
  LAYER_LANE,
  TIMELINE_FPS,
  fcpTimeFromFrames,
  framesToSec,
  layoutTimeline,
  secToFrames,
  shotFrames,
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
