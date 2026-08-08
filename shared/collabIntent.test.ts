import { describe, expect, it } from "vitest";
import { INTENT_LABEL, MESSAGE_INTENTS, suggestIntent } from "./collabIntent";

describe("suggestIntent（建議，不裁決）", () => {
  it("修改要求的典型句式認得出來", () => {
    expect(suggestIntent("這一鏡人物眼神要改。")).toBe("change_request");
    expect(suggestIntent("這一格節奏再慢一點")).toBe("change_request");
    expect(suggestIntent("這裡人物切太快")).toBe("change_request");
    expect(suggestIntent("背景換成黃昏")).toBe("change_request");
  });

  it("問句優先於修改要求——「這裡要改嗎？」是提問不是命令", () => {
    expect(suggestIntent("這裡要改嗎？")).toBe("question");
    expect(suggestIntent("要不要調整一下?")).toBe("question");
  });

  it("阻塞句式", () => {
    expect(suggestIntent("我卡住了，素材一直生不出來")).toBe("blocker");
    expect(suggestIntent("要等組長核准才能繼續")).toBe("blocker");
  });

  it("一般留言不亂建議——誤判會讓提示變成噪音，判準刻意保守", () => {
    expect(suggestIntent("收到 🙏")).toBeNull();
    expect(suggestIntent("隨喜讚歎，這版很好")).toBeNull();
    expect(suggestIntent("")).toBeNull();
    expect(suggestIntent("   ")).toBeNull();
  });

  it("每一種 intent 都有給人看的標籤", () => {
    for (const intent of MESSAGE_INTENTS) expect(INTENT_LABEL[intent]).toBeTruthy();
  });
});
