import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pickSplitScriptSource } from "./director";
import { XIAOHUA_SEVEN_ACT_SCRIPT } from "../../shared/fixtures/xiaohuaSevenAct";

describe("pickSplitScriptSource", () => {
  it("omitted script uses saved 故事, not knowledge", () => {
    const picked = pickSplitScriptSource({
      storyContent: XIAOHUA_SEVEN_ACT_SCRIPT,
      knowledgeText: "知識庫裡的另一份開示稿，不該被拆。",
    });
    expect(picked.source).toBe("story");
    expect(picked.script).toContain("校門口");
    expect(picked.script).not.toContain("開示稿");
  });

  it("paste wins over story and knowledge", () => {
    const picked = pickSplitScriptSource({
      pasted: "貼上的兩段。\n\n第二段。",
      storyContent: XIAOHUA_SEVEN_ACT_SCRIPT,
      knowledgeText: "知識庫",
    });
    expect(picked).toEqual({ script: "貼上的兩段。\n\n第二段。", source: "paste" });
  });

  it("fromOutline never silently falls back to knowledge", () => {
    expect(pickSplitScriptSource({
      fromOutline: true,
      outlineText: "",
      knowledgeText: "不該用這份",
    })).toEqual({ script: "", source: null });
    expect(pickSplitScriptSource({
      fromOutline: true,
      outlineText: "鉤子\n\n轉折\n\n行動",
      knowledgeText: "不該用這份",
    }).source).toBe("outline");
  });

  it("empty story falls back to knowledge, then fails closed", () => {
    expect(pickSplitScriptSource({
      storyContent: "   ",
      knowledgeText: "知識庫第一段。",
    })).toEqual({ script: "知識庫第一段。", source: "knowledge" });
    expect(pickSplitScriptSource({})).toEqual({ script: "", source: null });
  });
});

describe("mockSuggestions empty-hook fallback is A–F, not 七幕", () => {
  it("開場 fallback teaches 校門口 白帽T 小華, not 清晨禪堂空景", () => {
    const source = readFileSync(new URL("./director.ts", import.meta.url), "utf8");
    const body = source.slice(source.indexOf("function mockSuggestions"), source.indexOf("export interface SplitScriptCoreInput"));
    expect(body).toContain("淡大校門口校名牌前，粉橘短髮女孩、白帽T的小華");
    expect(body).not.toContain("清晨禪堂空景");
    expect(body).not.toContain("安倢");
    expect(body).not.toContain("慕恩");
    expect(body).not.toContain("紅傘");
  });
});
