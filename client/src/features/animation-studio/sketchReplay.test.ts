import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReplaySchedule, replaySketch } from "./sketchReplay";
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
  it("時刻單調遞增、第一筆從 0 開始", () => {
    const schedule = buildReplaySchedule([strokeWithPoints(50), strokeWithPoints(200), strokeWithPoints(10)]);
    expect(schedule[0]!.atMs).toBe(0);
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i]!.atMs).toBeGreaterThan(schedule[i - 1]!.atMs);
    }
  });

  it("點多的筆畫分到較長的時段（長線畫得久、短撇畫得快）", () => {
    const schedule = buildReplaySchedule([strokeWithPoints(400), strokeWithPoints(8), strokeWithPoints(8)]);
    const longGap = schedule[1]!.atMs - schedule[0]!.atMs;
    const shortGap = schedule[2]!.atMs - schedule[1]!.atMs;
    expect(longGap).toBeGreaterThan(shortGap);
  });

  it("整場重播的收尾不超過上限——300 筆的畫也不該讓人等太久", () => {
    const many = Array.from({ length: 300 }, () => strokeWithPoints(120));
    const schedule = buildReplaySchedule(many);
    // 最後一筆的落點 ≤ 總長上限 6.5s（間隔各自有下限，但總量受 totalMs 分配約束）
    expect(schedule.at(-1)!.atMs).toBeLessThanOrEqual(300 * 550);
    expect(schedule.at(-1)!.atMs).toBeGreaterThan(0);
  });

  it("空文件回空排程", () => {
    expect(buildReplaySchedule([])).toEqual([]);
  });
});

describe("replaySketch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("照排程逐筆落下，全部落完才叫 onDone", () => {
    const pushed: string[] = [];
    const onDone = vi.fn();
    const doc = docWith([strokeWithPoints(30, "a"), strokeWithPoints(30, "b"), strokeWithPoints(30, "c")]);
    replaySketch(doc, (s) => pushed.push(s.id), { onDone });

    expect(pushed).toEqual([]); // 尚未推進時間，一筆都還沒落
    vi.advanceTimersByTime(1);
    expect(pushed).toEqual(["a"]); // 第一筆在 0ms
    expect(onDone).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(pushed).toEqual(["a", "b", "c"]);
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("cancel 之後未落的筆不再落、onDone 不觸發；已落的保留", () => {
    const pushed: string[] = [];
    const onDone = vi.fn();
    const doc = docWith([strokeWithPoints(30, "a"), strokeWithPoints(30, "b"), strokeWithPoints(30, "c")]);
    const handle = replaySketch(doc, (s) => pushed.push(s.id), { onDone });

    vi.advanceTimersByTime(1); // 只落第一筆
    handle.cancel();
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
