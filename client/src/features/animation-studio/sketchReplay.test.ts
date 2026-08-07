import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReplaySchedule, replaySketch, visiblePointCount, type SketchPreview } from "./sketchReplay";
import type { BoardDoc, Stroke } from "./boardDoc";

function strokeWithPoints(n: number, id = `s${n}`): Stroke {
  return {
    id,
    brush: { id: "b", name: "鉛筆", engine: "pencil", size: 3, opacity: 0.7, pressure: 0.6, speed: 0.2, grain: 0.5, taper: 0.3, color: "#2b2b30" },
    points: Array.from({ length: n }, (_, i) => ({ x: i, y: i, p: 0.5 })),
  };
}

function docWith(strokes: Stroke[]): BoardDoc {
  return { v: 1, w: 1600, h: 900, strokes };
}

describe("buildReplaySchedule", () => {
  it("時刻單調遞增、第一筆從 0 開始、下一筆接在上一筆畫完之後", () => {
    const schedule = buildReplaySchedule([strokeWithPoints(50), strokeWithPoints(200), strokeWithPoints(10)]);
    expect(schedule[0]!.atMs).toBe(0);
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i]!.atMs).toBeGreaterThan(schedule[i - 1]!.atMs);
      // 逐點動畫的前提：這一筆的時段結束才輪到下一筆，時段不能重疊
      expect(schedule[i]!.atMs).toBeGreaterThanOrEqual(schedule[i - 1]!.atMs + schedule[i - 1]!.durationMs - 1);
    }
  });

  it("點多的筆畫分到較長的時段（長線畫得久、短撇畫得快）", () => {
    const schedule = buildReplaySchedule([strokeWithPoints(400), strokeWithPoints(8), strokeWithPoints(8)]);
    expect(schedule[0]!.durationMs).toBeGreaterThan(schedule[1]!.durationMs);
  });

  it("整場重播（最後一筆畫完）不超過 6.5 秒——單筆下限不得凌駕總長承諾", () => {
    // 審查抓到的：45ms 下限 × 300 筆＝13.5 秒，「不超過 6.5 秒」曾是謊言
    for (const count of [300, 1200]) {
      const many = Array.from({ length: count }, () => strokeWithPoints(120));
      const schedule = buildReplaySchedule(many);
      const last = schedule.at(-1)!;
      expect(last.atMs + last.durationMs).toBeLessThanOrEqual(6_500);
      expect(last.atMs).toBeGreaterThan(0);
    }
  });

  it("長短懸殊（短撇被抬到下限、長線被壓到上限）時總長仍守住承諾", () => {
    const mixed = [
      ...Array.from({ length: 40 }, () => strokeWithPoints(2000)),
      ...Array.from({ length: 160 }, () => strokeWithPoints(4)),
    ];
    const schedule = buildReplaySchedule(mixed);
    const last = schedule.at(-1)!;
    expect(last.atMs + last.durationMs).toBeLessThanOrEqual(6_500);
  });

  it("空文件回空排程", () => {
    expect(buildReplaySchedule([])).toEqual([]);
  });
});

describe("visiblePointCount", () => {
  it("從至少 2 點起畫（單點畫不出線段），走完一定是全部", () => {
    expect(visiblePointCount(100, 0, 500)).toBe(2);
    expect(visiblePointCount(100, 500, 500)).toBe(100);
    expect(visiblePointCount(100, 999, 500)).toBe(100);
  });

  it("進度單調遞增——線只會長出來，不會縮回去", () => {
    let prev = 0;
    for (let t = 0; t <= 500; t += 25) {
      const cur = visiblePointCount(120, t, 500);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
    expect(prev).toBe(120);
  });

  it("時長為 0 或已超時直接給全部；0 點回 0", () => {
    expect(visiblePointCount(50, 0, 0)).toBe(50);
    expect(visiblePointCount(0, 100, 500)).toBe(0);
  });
});

describe("replaySketch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("落筆先出現預覽（逐點前綴），畫完才提交進文件", () => {
    const pushed: string[] = [];
    const previews: Array<SketchPreview | null> = [];
    const doc = docWith([strokeWithPoints(30, "a"), strokeWithPoints(30, "b")]);
    replaySketch(doc, (s) => pushed.push(s.id), { onPreview: (p) => previews.push(p) });

    vi.advanceTimersByTime(1);
    // 第 0 影格：筆尖已落，但這一筆還沒進文件
    expect(previews.length).toBeGreaterThan(0);
    expect(previews[0]!.stroke.id).toBe("a");
    expect(previews[0]!.visible).toBeLessThan(30);
    expect(pushed).toEqual([]);

    vi.runAllTimers();
    expect(pushed).toEqual(["a", "b"]);
    // 收尾要把預覽清掉，live 層不能殘留鬼影
    expect(previews.at(-1)).toBeNull();
  });

  it("同一筆的預覽逐影格變長，最後一個影格前綴接近整筆", () => {
    const previews: SketchPreview[] = [];
    const doc = docWith([strokeWithPoints(200, "a")]);
    replaySketch(doc, () => {}, { onPreview: (p) => { if (p) previews.push(p); } });
    vi.runAllTimers();

    const counts = previews.filter((p) => p.stroke.id === "a").map((p) => p.visible);
    expect(counts.length).toBeGreaterThan(3); // 真的有逐影格，不是一格跳完
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]!).toBeGreaterThanOrEqual(counts[i - 1]!);
    expect(counts[0]!).toBeLessThan(200 / 2); // 一開始只看得到一小段
  });

  it("全部畫完才叫 onDone", () => {
    const pushed: string[] = [];
    const onDone = vi.fn();
    const doc = docWith([strokeWithPoints(30, "a"), strokeWithPoints(30, "b"), strokeWithPoints(30, "c")]);
    replaySketch(doc, (s) => pushed.push(s.id), { onDone });

    vi.advanceTimersByTime(1);
    expect(onDone).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(pushed).toEqual(["a", "b", "c"]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("cancel 之後未提交的筆不再落、onDone 不觸發；已提交的保留、預覽清掉", () => {
    const pushed: string[] = [];
    const previews: Array<SketchPreview | null> = [];
    const onDone = vi.fn();
    const doc = docWith([strokeWithPoints(30, "a"), strokeWithPoints(30, "b"), strokeWithPoints(30, "c")]);
    const handle = replaySketch(doc, (s) => pushed.push(s.id), { onDone, onPreview: (p) => previews.push(p) });

    // 推進到第一筆已提交、第二筆畫到一半
    const schedule = buildReplaySchedule(doc.strokes);
    vi.advanceTimersByTime(schedule[1]!.atMs + 1);
    expect(pushed).toEqual(["a"]);
    handle.cancel();
    expect(previews.at(-1)).toBeNull(); // 畫一半的鬼影不留
    vi.runAllTimers();
    expect(pushed).toEqual(["a"]);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("reducedMotion：一次全部落完——關動畫的人拿到的結果一樣完整", () => {
    const pushed: string[] = [];
    const onDone = vi.fn();
    const doc = docWith([strokeWithPoints(30, "a"), strokeWithPoints(30, "b")]);
    replaySketch(doc, (s) => pushed.push(s.id), { reducedMotion: true, onDone });
    expect(pushed).toEqual(["a", "b"]);
    expect(onDone).toHaveBeenCalledOnce();
  });
});
