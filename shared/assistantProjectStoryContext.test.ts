import { describe, expect, it } from "vitest";
import {
  buildAssistantProjectStatusContext,
  formatPersistedStoryForAssistant,
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
    expect(block).toContain("第七幕");
    expect(block).toContain("已儲存");

    const context = buildAssistantProjectStatusContext({
      title: "overnight-test-xiaohua-20260818",
      kind: "療癒動畫",
      format: "9:16",
      worldviewBlock: "療癒、校園",
      storyBlock: block,
      sceneCount: 0,
      sceneLines: "（尚無分鏡）",
      genDone: 0,
      genRunning: 0,
      genFailed: 0,
    });
    expect(context).toContain("overnight-test-xiaohua-20260818");
    expect(context).toContain("我是大二化工系的小華");
    expect(context).toContain("世界觀｜療癒、校園");
    expect(context).toContain("分鏡（共 0）");
  });

  it("empty story is explicit — still not 'please paste'", () => {
    const block = formatPersistedStoryForAssistant({ content: "   " });
    expect(block).toContain("尚未儲存稿");
    expect(block).not.toContain("請貼上");
  });
});
