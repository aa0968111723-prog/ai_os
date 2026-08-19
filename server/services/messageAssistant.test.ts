import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildMessageAssistantPrompt } from "./messageAssistant";
import { formatPersistedStoryForAssistant, lockAssistantStoryAnswer } from "../../shared/assistantProjectStoryContext";
import { XIAOHUA_SEVEN_ACT_SCRIPT } from "../../shared/fixtures/xiaohuaSevenAct";

describe("messageAssistant saved story", () => {
  it("injects persisted 故事全文 so @助手 can answer without asking to paste", () => {
    const prompt = buildMessageAssistantPrompt({
      title: "overnight-test-xiaohua-20260818",
      worldviewBlock: "療癒、校園",
      storyBlock: formatPersistedStoryForAssistant({ content: XIAOHUA_SEVEN_ACT_SCRIPT }),
      convo: "夥伴：依儲存的故事拆分鏡",
      collab: "",
      knowledge: "",
      question: "依儲存的故事拆分鏡",
    });
    expect(prompt).toContain("我是大二化工系的小華");
    expect(prompt).toContain("校門口");
    expect(prompt).toContain("不要說看不到");
    expect(prompt).not.toContain("從疲憊中找到力量");
  });

  it("story-read skips knowledge / convo bleed and locks 她 / 粉橘短髮女孩", () => {
    const prompt = buildMessageAssistantPrompt({
      title: "動畫組 小華",
      worldviewBlock: "療癒、校園",
      storyBlock: formatPersistedStoryForAssistant({ content: XIAOHUA_SEVEN_ACT_SCRIPT }),
      convo: "夥伴：從疲憊中找到力量",
      collab: "決策：躺在床上",
      knowledge: "知識庫：從疲憊中找到力量",
      question: "A–D summarize once short-100w",
      storyReadAsk: true,
    });
    expect(prompt).toContain("我是大二化工系的小華");
    expect(prompt).toContain("粉橘短髮女孩");
    expect(prompt).toContain("stories.content");
    expect(prompt).not.toContain("知識庫：從疲憊中找到力量");
    expect(prompt).not.toContain("夥伴：從疲憊中找到力量");
    expect(prompt).not.toContain("決策：躺在床上");
    const locked = lockAssistantStoryAnswer({
      answer: "已完成盤點。小華講述他如何從疲憊中找到力量。",
      storyContent: XIAOHUA_SEVEN_ACT_SCRIPT,
      characterNames: ["小華"],
    });
    expect(locked).not.toContain("已完成盤點");
    expect(locked).not.toContain("從疲憊中找到力量");
    expect(locked).not.toMatch(/講述他/);
    const src = readFileSync(new URL("./messageAssistant.ts", import.meta.url), "utf8");
    expect(src).toContain("isAssistantStoryReadIntent");
    expect(src).toContain("lockAssistantStoryAnswer");
    expect(src).toContain("storyReadAsk ? Promise.resolve(\"\") : buildKnowledgeContext");
  });
});
