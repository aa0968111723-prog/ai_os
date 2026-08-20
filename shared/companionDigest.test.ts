import { describe, expect, it } from "vitest";
import {
  MAX_COMPANION_CARDS,
  companionDigest,
  companionGreeting,
  type CompanionProjectSnapshot,
} from "./companionDigest";

const base: CompanionProjectSnapshot = {
  id: "11111111-2222-4333-8444-555555555555",
  title: "淡江動畫",
  stage: "generate",
  shots: 12,
  shotsWithVisual: 8,
  awaitingGenerations: 0,
  runningGenerations: 0,
  failedGenerations: 0,
  freshResults: 0,
  updatedAt: "2026-08-19T10:00:00.000Z",
};

describe("companionGreeting", () => {
  it("依本地時給問候語", () => {
    expect(companionGreeting(8)).toBe("早安");
    expect(companionGreeting(14)).toBe("午安");
    expect(companionGreeting(21)).toBe("晚安");
    expect(companionGreeting(2)).toBe("夜深了");
  });

  it("有名字就帶名字", () => {
    expect(companionGreeting(8, "小明")).toBe("早安，小明");
    expect(companionGreeting(8, "   ")).toBe("早安");
  });

  it("超出範圍的時數不會炸，也不會出現「早安 NaN」", () => {
    expect(companionGreeting(Number.NaN)).toBe("早安");
    // 25 時＝隔天 1 時，環繞後仍是夜裡
    expect(companionGreeting(25)).toBe("夜深了");
    expect(companionGreeting(-1)).toBe("晚安");
  });
});

describe("companionDigest", () => {
  it("沒有專案時不硬擠主動提示", () => {
    const digest = companionDigest({ nowHour: 9, projects: [] });
    expect(digest.cards).toEqual([]);
    expect(digest.nudge).toBeUndefined();
  });

  it("首頁最多三張卡——第四張開始就是在堆功能", () => {
    const digest = companionDigest({
      nowHour: 9,
      projects: [{
        ...base,
        awaitingGenerations: 2,
        failedGenerations: 3,
        runningGenerations: 1,
        freshResults: 4,
      }],
    });
    expect(digest.cards.length).toBeLessThanOrEqual(MAX_COMPANION_CARDS);
  });

  it("resume 卡在生成階段帶進度百分比——「做到哪」要一眼可讀", () => {
    const digest = companionDigest({ nowHour: 9, projects: [base] });
    const resume = digest.cards.find((card) => card.kind === "resume");
    expect(resume?.line).toBe("畫面 8／12 鏡（67%）");
  });

  it("failure 卡的「全部重跑」掛 actionId=retry_generation——UI 走確定性路徑靠 id，不靠比對文案", () => {
    const digest = companionDigest({
      nowHour: 9,
      projects: [{ ...base, failedGenerations: 2 }],
    });
    const failure = digest.cards.find((card) => card.kind === "failure");
    const retry = failure?.actions.find((action) => action.actionId === "retry_generation");
    expect(retry?.label).toBe("全部重跑");
    // 「先看原因」沒有 actionId：那句話仍走助手
    expect(failure?.actions.filter((action) => action.actionId).length).toBe(1);
  });

  it("待確認排第一：人被擋住最貴", () => {
    const digest = companionDigest({
      nowHour: 9,
      projects: [{ ...base, awaitingGenerations: 2, failedGenerations: 1, runningGenerations: 1 }],
    });
    expect(digest.cards[0].kind).toBe("approval");
    expect(digest.cards[1].kind).toBe("failure");
    expect(digest.cards[2].kind).toBe("running");
  });

  it("同一類只出一張，跨專案聚合成總數", () => {
    const digest = companionDigest({
      nowHour: 9,
      projects: [
        { ...base, id: "a1111111-2222-4333-8444-555555555555", failedGenerations: 2 },
        { ...base, id: "b1111111-2222-4333-8444-555555555555", failedGenerations: 1, title: "另一案" },
      ],
    });
    const failures = digest.cards.filter((c) => c.kind === "failure");
    expect(failures).toHaveLength(1);
    expect(failures[0].line).toContain("3");
    expect(failures[0].title).toBe("2 個專案");
    expect(failures[0].projectId).toBeUndefined();
  });

  it("單一專案的卡帶得出 projectId（深連結才組得起來）", () => {
    const digest = companionDigest({ nowHour: 9, projects: [{ ...base, awaitingGenerations: 1 }] });
    expect(digest.cards[0].projectId).toBe(base.id);
    expect(digest.cards[0].actions.some((a) => a.kind === "open_web")).toBe(true);
  });

  it("沒有待辦時給「繼續昨天那個」的續作卡", () => {
    const digest = companionDigest({ nowHour: 9, projects: [base] });
    expect(digest.cards).toHaveLength(1);
    expect(digest.cards[0].kind).toBe("resume");
    expect(digest.nudge).toContain("淡江動畫");
  });

  it("續作卡取最近更新的那一案", () => {
    const digest = companionDigest({
      nowHour: 9,
      projects: [
        { ...base, id: "a1111111-2222-4333-8444-555555555555", title: "舊案", updatedAt: "2026-01-01T00:00:00.000Z" },
        { ...base, id: "b1111111-2222-4333-8444-555555555555", title: "新案", updatedAt: "2026-08-19T00:00:00.000Z" },
      ],
    });
    expect(digest.cards[0].title).toBe("新案");
  });

  it("主動提示照優先序講一件事，不是把所有事唸完", () => {
    const digest = companionDigest({
      nowHour: 9,
      projects: [{ ...base, awaitingGenerations: 2, failedGenerations: 3 }],
    });
    expect(digest.nudge).toContain("2 筆");
    expect(digest.nudge).not.toContain("失敗");
  });

  it("每張卡都至少一個動作，且 compose 一定帶 prompt", () => {
    const digest = companionDigest({
      nowHour: 9,
      projects: [{ ...base, awaitingGenerations: 1, failedGenerations: 1, runningGenerations: 1 }],
    });
    for (const card of digest.cards) {
      expect(card.actions.length).toBeGreaterThan(0);
      for (const action of card.actions) {
        if (action.kind === "compose") expect(action.prompt?.length).toBeGreaterThan(0);
        if (action.kind === "open_web") expect(action.projectId).toBeTruthy();
      }
    }
  });

  it("階段句子跟著階段換，不會永遠是同一句", () => {
    const story = companionDigest({ nowHour: 9, projects: [{ ...base, stage: "story" }] });
    const deliver = companionDigest({ nowHour: 9, projects: [{ ...base, stage: "deliver" }] });
    expect(story.cards[0].line).not.toBe(deliver.cards[0].line);
  });
});
