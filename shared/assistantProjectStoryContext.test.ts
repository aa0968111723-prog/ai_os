import { describe, expect, it } from "vitest";
import {
  ASSISTANT_STORY_CONTEXT_BUDGET,
  buildAssistantProjectStatusContext,
  formatPersistedStoryForAssistant,
  formatTeamInventoryStoryFlag,
  isAssistantStoryReadIntent,
  lockAssistantStoryAnswer,
  slicePersistedStoryContent,
} from "./assistantProjectStoryContext";
import { XIAOHUA_SEVEN_ACT_SCRIPT } from "./fixtures/xiaohuaSevenAct";

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
    expect(isAssistantStoryReadIntent("現在有幾鏡？")).toBe(false);
    const locked = lockAssistantStoryAnswer({
      answer: "已完成盤點。小華在講述他的故事，提到他如何從疲憊中找到力量。角色名有小華和禪定龜龜。",
      storyContent: XIAOHUA_SEVEN_ACT_SCRIPT,
      characterNames: ["小華", "禪定龜龜"],
    });
    expect(locked).not.toContain("已完成盤點");
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

  it("slicePersistedStoryContent uses the same 4k budget as the prompt block", () => {
    const long = "華".repeat(ASSISTANT_STORY_CONTEXT_BUDGET + 20);
    const sliced = slicePersistedStoryContent(long);
    expect(sliced?.endsWith("…[truncated]")).toBe(true);
    expect(sliced?.startsWith("華")).toBe(true);
    expect(formatPersistedStoryForAssistant({ content: long })).toContain("…[truncated]");
  });
});
