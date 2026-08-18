import { describe, expect, it } from "vitest";
import { buildMessageAssistantPrompt } from "./messageAssistant";
import { formatPersistedStoryForAssistant } from "../../shared/assistantProjectStoryContext";
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
  });
});
