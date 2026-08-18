/**
 * 完成度模型（§15）與缺漏清單（§12）。
 *
 * 這份數字是使用者判斷「還差多少」的唯一依據，也是成片頁問題清單的來源。
 * 算錯的兩個方向都很糟：高估＝以為做完了、交付才發現缺件；
 * 低估＝永遠看不到 100%，進度條失去意義。逐項釘住。
 */
import { describe, it, expect } from "vitest";
import {
  computeShotCompletion,
  computeProjectCompletion,
  listDeliveryIssues,
  isBatchGenerateEligibleShot,
  listPickedBatchGenerateIds,
  COMPLETION_TRACKS,
  type ShotCompletionInput,
} from "./shotCompletion";

const base: ShotCompletionInput = {
  id: "s1",
  title: "SHOT 01",
  orderIndex: 1,
  assetId: null,
  assetKind: null,
  narrationUrl: null,
  ambienceUrl: null,
};

const shot = (over: Partial<ShotCompletionInput> = {}) => computeShotCompletion({ ...base, ...over });

describe("computeShotCompletion", () => {
  it("全空＝五軌皆缺、0%、todo", () => {
    const c = shot();
    expect(c.tracks).toEqual({ image: "missing", video: "missing", voice: "missing", audio: "missing", review: "missing" });
    expect(c.percent).toBe(0);
    expect(c.state).toBe("todo");
  });

  it("有圖＝畫面完成，但影片仍缺（圖不等於動態）", () => {
    const c = shot({ assetId: "a1", assetKind: "image" });
    expect(c.tracks.image).toBe("done");
    expect(c.tracks.video).toBe("missing");
    expect(c.percent).toBe(20);
  });

  it("現用畫面是影片＝畫面與影片都算完成（別逼使用者再生一支）", () => {
    const c = shot({ assetId: "a1", assetKind: "video" });
    expect(c.tracks.image).toBe("done");
    expect(c.tracks.video).toBe("done");
    expect(c.percent).toBe(40);
  });

  it("配音與環境音各自認列", () => {
    const c = shot({ narrationUrl: "n.mp3", ambienceUrl: "a.mp3" });
    expect(c.tracks.voice).toBe("done");
    expect(c.tracks.audio).toBe("done");
  });

  it("只有 approved 才算審核完成——ready/待審不算", () => {
    expect(shot({ reviewStatus: "ready" }).tracks.review).toBe("missing");
    expect(shot({ reviewStatus: "in_progress" }).tracks.review).toBe("missing");
    expect(shot({ reviewStatus: "approved" }).tracks.review).toBe("done");
  });

  it("生成中顯示 running，不算完成也不算缺（正在解決的事不該進問題清單）", () => {
    const c = shot({ pendingGenStatus: "running", pendingNarrationStatus: "queued" });
    expect(c.tracks.image).toBe("running");
    expect(c.tracks.voice).toBe("running");
    expect(c.state).toBe("running");
    expect(c.percent).toBe(0);
  });

  it("被要求修改＝blocked，優先於「還在生成」（有人說要改，那才是現在的重點）", () => {
    const c = shot({ reviewStatus: "changes", pendingGenStatus: "running" });
    expect(c.state).toBe("blocked");
  });

  it("五軌齊＝done、100%", () => {
    const c = shot({ assetId: "a1", assetKind: "video", narrationUrl: "n", ambienceUrl: "a", reviewStatus: "approved" });
    expect(c.doneCount).toBe(COMPLETION_TRACKS.length);
    expect(c.percent).toBe(100);
    expect(c.state).toBe("done");
  });
});

describe("computeProjectCompletion", () => {
  it("逐軌統計＋整體百分比（用格子數算，不是「全滿的鏡數」）", () => {
    const list = [
      shot({ id: "a", assetId: "x", assetKind: "image" }),
      shot({ id: "b", assetId: "y", assetKind: "video", narrationUrl: "n" }),
    ];
    const p = computeProjectCompletion(list);
    expect(p.shots).toBe(2);
    expect(p.perTrack).toEqual({ image: 2, video: 1, voice: 1, audio: 0, review: 0 });
    // 完成格子 1 + 3 = 4，總格子 2×5 = 10
    expect(p.percent).toBe(40);
    expect(p.completeShots).toBe(0);
  });

  it("空專案不除以零", () => {
    expect(computeProjectCompletion([])).toEqual({
      shots: 0,
      perTrack: { image: 0, video: 0, voice: 0, audio: 0, review: 0 },
      percent: 0,
      completeShots: 0,
    });
  });

  it("進度不會長期卡在 0%——做了一半就看得到動（這是用格子數而非全滿鏡數的理由）", () => {
    const half = [shot({ id: "a", assetId: "x", assetKind: "image", narrationUrl: "n" })];
    expect(computeProjectCompletion(half).percent).toBeGreaterThan(0);
    expect(computeProjectCompletion(half).completeShots).toBe(0);
  });
});

describe("listDeliveryIssues", () => {
  it("依鏡次排序，不依嚴重度（使用者是照鏡次補件的）", () => {
    const list = [
      shot({ id: "b", title: "SHOT 02", orderIndex: 2, assetId: "y", assetKind: "video", narrationUrl: "n", ambienceUrl: "a", reviewStatus: "approved" }),
      shot({ id: "a", title: "SHOT 01", orderIndex: 1, assetId: "x", assetKind: "video", narrationUrl: "n", ambienceUrl: "a" }),
    ];
    const issues = listDeliveryIssues(list);
    expect(issues).toEqual([{ shotId: "a", shotTitle: "SHOT 01", orderIndex: 1, track: "review", label: "尚未審核" }]);
  });

  it("生成中不算問題（問題數字不該上下跳）", () => {
    const list = [shot({ id: "a", pendingGenStatus: "running", assetKind: null })];
    const tracks = listDeliveryIssues(list).map((i) => i.track);
    expect(tracks).not.toContain("image");
  });

  it("缺漏用人話標示，且每一筆都帶得回 shotId（點得進去處理）", () => {
    const issues = listDeliveryIssues([shot({ id: "a", assetId: "x", assetKind: "image", ambienceUrl: "a" })]);
    expect(issues.map((i) => i.label)).toEqual(["缺少影片", "缺少配音", "尚未審核"]);
    expect(issues.every((i) => i.shotId === "a")).toBe(true);
  });

  it("全部做完就沒有問題", () => {
    const done = shot({ assetId: "x", assetKind: "video", narrationUrl: "n", ambienceUrl: "a", reviewStatus: "approved" });
    expect(listDeliveryIssues([done])).toEqual([]);
  });
});

describe("isBatchGenerateEligibleShot", () => {
  it("skips current visuals, approved shots, and empty-prompt shots", () => {
    expect(isBatchGenerateEligibleShot({ assetId: null, prompt: "海邊" })).toBe(true);
    expect(isBatchGenerateEligibleShot({ assetId: null, action: "走進禪堂" })).toBe(true);
    expect(isBatchGenerateEligibleShot({ assetId: "a1", prompt: "海邊" })).toBe(false);
    expect(isBatchGenerateEligibleShot({ assetId: null, reviewStatus: "approved", prompt: "海邊" })).toBe(false);
    expect(isBatchGenerateEligibleShot({ assetId: null, prompt: "  ", action: "" })).toBe(false);
  });
});

describe("listPickedBatchGenerateIds", () => {
  it("drops picked shots that already have a visual, are approved, or have no prompt", () => {
    const rows = [
      { id: "s1", assetId: null, prompt: "海邊" },
      { id: "s2", assetId: "a1", prompt: "已經有圖" },
      { id: "s3", assetId: null, reviewStatus: "approved", prompt: "已審" },
      { id: "s4", assetId: null, prompt: "  " },
    ];
    expect(listPickedBatchGenerateIds(rows, ["s1", "s2", "s3", "s4"])).toEqual(["s1"]);
    expect(listPickedBatchGenerateIds(rows, new Set(["s2", "s3"]))).toEqual([]);
  });
});
