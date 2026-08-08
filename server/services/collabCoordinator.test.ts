/**
 * AI 協作統籌的格式化規則。
 *
 * 這些規則錯了，AI 的整理就會**把責任指錯人**（「等待你」指到別人頭上）
 * 或把已撤銷的決策當成現行定案講出來——而那看起來就像模型幻覺，
 * 沒有人會想到是餵進去的上下文本身分錯了類。
 */
import { describe, expect, it } from "vitest";
import { formatCollaborationContext, type CollabContextData } from "./collabCoordinator";

const base = (over: Partial<CollabContextData> = {}): CollabContextData => ({
  askerId: "u-bruce",
  openAnnotations: [],
  tasks: [],
  decisions: [],
  ...over,
});

describe("formatCollaborationContext", () => {
  it("已決定＝未撤銷的決策；已撤銷的**不注入**——把推翻的定案當現行講是最糟的幻覺來源", () => {
    const out = formatCollaborationContext(base({
      decisions: [
        { title: "開場維持雨聲", decidedByName: "Bruce", revoked: false },
        { title: "結尾用 A 版", decidedByName: "Bruce", revoked: true },
      ],
    }));
    expect(out).toContain("<已決定>");
    expect(out).toContain("• 開場維持雨聲（Bruce 定案）");
    expect(out).not.toContain("結尾用 A 版");
  });

  it("等待你＝指派給**問話者本人**的任務；別人的任務進「待處理」", () => {
    const out = formatCollaborationContext(base({
      tasks: [
        { title: "確認 V4", status: "review", taskType: "approval", assigneeId: "u-bruce", assigneeName: "Bruce", createdByName: "敏豐" },
        { title: "重做 Shot 08", status: "doing", taskType: "task", assigneeId: "u-wei", assigneeName: "韋澔", createdByName: "Bruce" },
      ],
    }));
    // 我的核准在「等待你」
    expect(out).toContain("<等待你>");
    expect(out).toContain("待你核准：「確認 V4」（敏豐 建立）");
    // 韋澔的任務在「待處理」，不在「等待你」
    expect(out).toContain("<待處理>");
    expect(out).toContain("任務「重做 Shot 08」（韋澔 負責，doing）");
    const waitBlock = out.slice(out.indexOf("<等待你>"));
    expect(waitBlock).not.toContain("重做 Shot 08");
  });

  it("未解決標注帶鏡標題與提出者——AI 才講得出「Shot 08 的眼神問題是敏豐提的」", () => {
    const out = formatCollaborationContext(base({
      openAnnotations: [{ body: "這裡人物眼神不自然", userName: "敏豐", sceneTitle: "SHOT 08" }],
    }));
    expect(out).toContain("• 未解決標注（SHOT 08）：這裡人物眼神不自然——敏豐 提出");
  });

  it("空區塊直接省略——「待處理：（無）」對模型是噪音", () => {
    expect(formatCollaborationContext(base())).toBe("");
    const onlyDecision = formatCollaborationContext(base({
      decisions: [{ title: "定案", decidedByName: null, revoked: false }],
    }));
    expect(onlyDecision).toContain("<已決定>");
    expect(onlyDecision).not.toContain("<待處理>");
    expect(onlyDecision).not.toContain("<等待你>");
  });

  it("長標注截斷到 60 字——協作狀態是骨架不是全文", () => {
    const long = "很長的標注".repeat(30);
    const out = formatCollaborationContext(base({
      openAnnotations: [{ body: long, userName: null, sceneTitle: null }],
    }));
    expect(out).toContain(long.slice(0, 60));
    expect(out).not.toContain(long.slice(0, 61));
  });
});
