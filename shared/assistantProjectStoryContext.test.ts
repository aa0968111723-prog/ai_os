import { describe, expect, it } from "vitest";
import {
  ASSISTANT_STORY_CONTEXT_BUDGET,
  answerAfterFreeOnlyTimeout,
  replaceEmptyFreeTimeoutAfterTools,
  buildAssistantProjectStatusContext,
  fallbackReadOnlyStorySummary,
  formatPersistedStoryForAssistant,
  formatTeamInventoryStoryFlag,
  isAssistantStoryReadIntent,
  lockAssistantStoryAnswer,
  namesFromPersistedStory,
  slicePersistedStoryContent,
} from "./assistantProjectStoryContext";
import { XIAOHUA_SEVEN_ACT_SCRIPT } from "./fixtures/xiaohuaSevenAct";
import { TKU_ZEN_SHOTLIST_FIRST_PARSE } from "./fixtures/tkuZenPromo";

describe("assistant persisted story context", () => {
  it("injects the saved 故事全文 so the model cannot claim it cannot see 你的故事", () => {
    const block = formatPersistedStoryForAssistant({
      content: XIAOHUA_SEVEN_ACT_SCRIPT,
      lastParsedAt: null,
    });
    expect(block).toContain("故事全文");
    expect(block).toContain("我是大二化工系的小華");
    expect(block).toContain("校門口");
    expect(block).toContain("已儲存");
    expect(block).toContain("僅本專案 stories.content");
    expect(block).toContain("宇宙呀");
    expect(block).not.toContain("從疲憊中找到力量");
    expect(block).not.toContain("躺在床上");

    const context = buildAssistantProjectStatusContext({
      title: "overnight-test-xiaohua-20260818",
      kind: "療癒動畫",
      format: "9:16",
      worldviewBlock: "療癒、校園",
      storyBlock: block,
      sceneCount: 0,
      sceneLines: "（尚無分鏡）",
      characterLine: "角色定裝（0）：尚無——編輯者可用 add_character 建立（確認卡；只給名字亦可）",
      genDone: 0,
      genRunning: 0,
      genFailed: 0,
    });
    expect(context).toContain("overnight-test-xiaohua-20260818");
    expect(context).toContain("我是大二化工系的小華");
    expect(context).toContain("世界觀｜療癒、校園");
    expect(context).toContain("分鏡（共 0）");
    expect(context).toContain("add_character");
  });

  it("team inventory only flags presence — never injects the 4k body", () => {
    expect(formatTeamInventoryStoryFlag(XIAOHUA_SEVEN_ACT_SCRIPT)).toBe("有故事稿");
    expect(formatTeamInventoryStoryFlag("   ")).toBe("尚未儲存稿");
    expect(formatTeamInventoryStoryFlag(null)).toBe("尚未儲存稿");
    expect(formatTeamInventoryStoryFlag(XIAOHUA_SEVEN_ACT_SCRIPT)).not.toContain("我是大二化工系的小華");
  });

  it("empty story is explicit — still not 'please paste'", () => {
    const block = formatPersistedStoryForAssistant({ content: "   " });
    expect(block).toContain("尚未儲存稿");
    expect(block).not.toContain("請貼上");
    expect(slicePersistedStoryContent("   ")).toBeNull();
  });

  it("story-read intent matches the live 05:15 ask and locks 她 / no 已完成盤點", () => {
    const live = "請讀已存故事，兩句摘要小華在講什麼並列出角色名";
    expect(isAssistantStoryReadIntent(live)).toBe(true);
    expect(isAssistantStoryReadIntent("兩句話摘要已存故事並列角色名，不要寫入.")).toBe(true);
    expect(isAssistantStoryReadIntent("A–D summarize 100w")).toBe(true);
    expect(isAssistantStoryReadIntent("請摘要 A-D，短摘 100 字")).toBe(true);
    expect(isAssistantStoryReadIntent("現在有幾鏡？")).toBe(false);
    const locked = lockAssistantStoryAnswer({
      answer: "已完成盤點。小華在講述他的故事，提到他如何從疲憊中找到力量。角色名有小華和禪定龜龜。",
      storyContent: XIAOHUA_SEVEN_ACT_SCRIPT,
      characterNames: ["小華", "禪定龜龜"],
    });
    expect(locked).not.toContain("已完成盤點");
    expect(locked).not.toContain("已讀取本專案故事");
    expect(locked).toContain("她的故事");
    expect(locked).not.toMatch(/講述他的故事/);
    expect(locked).not.toContain("疲憊");
    expect(locked).not.toContain("從疲憊中找到力量");
    expect(locked).not.toContain("躺在床上");
    expect(locked).toContain("角色名有小華和禪定龜龜");
  });

  it("keeps 疲憊 only when this project's stories.content actually says it", () => {
    const story = "小華躺在床上，從疲憊中找到力量。";
    const locked = lockAssistantStoryAnswer({
      answer: "小華躺在床上，從疲憊中找到力量。",
      storyContent: story,
      characterNames: ["小華"],
    });
    expect(locked).toContain("躺在床上");
    expect(locked).toContain("從疲憊中找到力量");
  });

  it("read-only summarize fallback uses fetched SHOTLIST A–F, never empty 免費模型逾時", () => {
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.split(/\n\n/).length).toBe(6);
    expect(namesFromPersistedStory(TKU_ZEN_SHOTLIST_FIRST_PARSE, [])).toEqual(["小華", "禪定龜龜"]);
    const answer = fallbackReadOnlyStorySummary({
      storyContent: TKU_ZEN_SHOTLIST_FIRST_PARSE,
      characterNames: [],
    });
    expect(answer.length).toBeGreaterThan(12);
    expect(answer).toContain("小華");
    expect(answer).toContain("禪定龜龜");
    expect(answer).toMatch(/校門口|大二化工|白帽T/);
    expect(answer).not.toBe("");
    expect(answer).not.toContain("免費模型逾時");
    expect(answer).not.toContain("執行未完成");
    expect(answer).not.toContain("安倢");
    expect(answer).not.toContain("慕恩");
    expect(answer).not.toMatch(/年輕男性|他的故事/);
    expect(answerAfterFreeOnlyTimeout({
      storyReadAsk: true,
      fetchedOk: true,
      storyContent: TKU_ZEN_SHOTLIST_FIRST_PARSE,
      characterNames: [],
    })).toBe(answer);
    expect(answerAfterFreeOnlyTimeout({
      storyReadAsk: false,
      fetchedOk: false,
      storyContent: TKU_ZEN_SHOTLIST_FIRST_PARSE,
    })).toBeNull();
    expect(replaceEmptyFreeTimeoutAfterTools({
      answer: "免費模型逾時",
      fetchedOk: true,
      storyContent: TKU_ZEN_SHOTLIST_FIRST_PARSE,
    })).toBe(answer);
    expect(replaceEmptyFreeTimeoutAfterTools({
      answer: "",
      fetchedOk: true,
      storyContent: TKU_ZEN_SHOTLIST_FIRST_PARSE,
    })).toContain("小華");
    expect(replaceEmptyFreeTimeoutAfterTools({
      answer: "免費模型逾時",
      fetchedOk: false,
    })).toBeNull();
    expect((answer.match(/[。！？]/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("slicePersistedStoryContent uses the same 4k budget as the prompt block", () => {
    const long = "華".repeat(ASSISTANT_STORY_CONTEXT_BUDGET + 20);
    const sliced = slicePersistedStoryContent(long);
    expect(sliced?.endsWith("…[truncated]")).toBe(true);
    expect(sliced?.startsWith("華")).toBe(true);
    expect(formatPersistedStoryForAssistant({ content: long })).toContain("…[truncated]");
  });
});
