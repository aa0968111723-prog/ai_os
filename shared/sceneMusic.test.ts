/**
 * 配樂區間：存端點、算區間。
 *
 * 這支的核心主張是「會漂的東西不要存」——所以測試的重點不是「解析對不對」，
 * 而是「鏡被搬動之後，區間仍然跟著正確的鏡」。存起訖秒數或 sceneId 的做法
 * 在這幾個情境下都會錯位。
 */
import { describe, expect, it } from "vitest";
import {
  formatMusicMarker,
  musicPlayingAt,
  parseMusicMarker,
  resolveMusicSpans,
} from "./sceneMusic";

const s = (music?: string | null) => ({ music: music ?? null });

describe("parseMusicMarker", () => {
  it("起｜描述、止，全形半形分隔符都收", () => {
    expect(parseMusicMarker("起｜單音鋼琴，極簡")).toEqual({ kind: "start", description: "單音鋼琴，極簡" });
    expect(parseMusicMarker("起|單音鋼琴")).toEqual({ kind: "start", description: "單音鋼琴" });
    expect(parseMusicMarker("止")).toEqual({ kind: "stop" });
    expect(parseMusicMarker("停")).toEqual({ kind: "stop" });
  });

  it("只寫描述沒寫「起」時視為起——使用者只說了要什麼音樂", () => {
    expect(parseMusicMarker("溫暖的弦樂")).toEqual({ kind: "start", description: "溫暖的弦樂" });
  });

  it("空的回 null（不報錯——寬鬆解析是這份格式的原則）", () => {
    expect(parseMusicMarker("")).toBeNull();
    expect(parseMusicMarker("   ")).toBeNull();
    expect(parseMusicMarker(null)).toBeNull();
  });

  it("來回不失真", () => {
    for (const text of ["起｜單音鋼琴，極簡", "止"]) {
      expect(formatMusicMarker(parseMusicMarker(text))).toBe(text);
    }
  });
});

describe("resolveMusicSpans（區間是算出來的，不是存的）", () => {
  it("起到止：「止」那一鏡本身不播", () => {
    const spans = resolveMusicSpans([s("起｜鋼琴"), s(), s(), s("止"), s()]);
    expect(spans).toEqual([{ fromIndex: 0, toIndex: 2, description: "鋼琴" }]);
  });

  it("沒有止就延續到最後一鏡", () => {
    expect(resolveMusicSpans([s(), s("起｜弦樂"), s(), s()])).toEqual([
      { fromIndex: 1, toIndex: 3, description: "弦樂" },
    ]);
  });

  it("再遇到「起」＝換曲，前一段在前一鏡結束（不重疊）", () => {
    const spans = resolveMusicSpans([s("起｜A"), s(), s("起｜B"), s()]);
    expect(spans).toEqual([
      { fromIndex: 0, toIndex: 1, description: "A" },
      { fromIndex: 2, toIndex: 3, description: "B" },
    ]);
    // 同一時間只有一段——這是「不開 score_cues 表」換來的已知限制，測試把它釘住
    expect(spans.filter((x) => x.fromIndex <= 1 && x.toIndex >= 1)).toHaveLength(1);
  });

  it("完全沒有標記就沒有配樂", () => {
    expect(resolveMusicSpans([s(), s(), s()])).toEqual([]);
  });

  it("第一鏡就止（沒開過）不會產生負區間", () => {
    expect(resolveMusicSpans([s("止"), s()])).toEqual([]);
  });

  /**
   * 這一組才是重點：鏡被搬動之後區間自動跟著走。
   * 存 sceneId 會懸空、存秒數會錯位，只有「掃描相鄰鏡」能免疫。
   */
  it("鏡重排：標記跟著鏡走，區間自動重算", () => {
    const original = [s("起｜鋼琴"), s(), s("止"), s()];
    expect(resolveMusicSpans(original)).toEqual([{ fromIndex: 0, toIndex: 1, description: "鋼琴" }]);
    // 把第 0 鏡搬到第 2 個位置（使用者拖曳）
    const reordered = [original[1]!, original[2]!, original[0]!, original[3]!];
    expect(resolveMusicSpans(reordered)).toEqual([{ fromIndex: 2, toIndex: 3, description: "鋼琴" }]);
  });

  it("中間插入一鏡：區間自動變長，不必改任何標記", () => {
    expect(resolveMusicSpans([s("起｜鋼琴"), s(), s("止")])).toEqual([
      { fromIndex: 0, toIndex: 1, description: "鋼琴" },
    ]);
    expect(resolveMusicSpans([s("起｜鋼琴"), s(), s(), s("止")])).toEqual([
      { fromIndex: 0, toIndex: 2, description: "鋼琴" },
    ]);
  });

  it("刪掉起鏡：後面那段配樂自然消失，不會留下懸空引用", () => {
    expect(resolveMusicSpans([s(), s(), s("止")])).toEqual([]);
  });
});

describe("musicPlayingAt", () => {
  it("回報某一鏡當下播的是哪一段", () => {
    const spans = resolveMusicSpans([s("起｜鋼琴"), s(), s("止"), s("起｜弦樂")]);
    expect(musicPlayingAt(spans, 0)?.description).toBe("鋼琴");
    expect(musicPlayingAt(spans, 1)?.description).toBe("鋼琴");
    expect(musicPlayingAt(spans, 2)).toBeNull(); // 「止」那一鏡沒有配樂
    expect(musicPlayingAt(spans, 3)?.description).toBe("弦樂");
  });
});
