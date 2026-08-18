import { describe, expect, it } from "vitest";
import { ASSISTANT_CAPABILITIES, canDirectlyExecuteCapability, classifyAssistantRequest } from "./assistantExecution";

describe("assistant execution fast path", () => {
  it.each([
    ["這個專案目前卡在哪裡？", "ASK"],
    ["社評", "ASK"],
    ["幫我建立一則會議筆記", "DIRECT"],
    ["請把這件事建立成任務", "DIRECT"],
    ["如何建立任務？", "ASK"],
    ["幫我列出目前有哪些專案", "ASK"],
    ["列出專案清單", "ASK"],
    ["有幾個進行中的專案", "ASK"],
    ["哪個專案最舊", "ASK"],
    ["顯示目前專案", "ASK"],
    ["查看組員有誰", "ASK"],
    ["你可以用瀏覽器嗎？", "ASK"],
    ["幫我開啟瀏覽器", "DIRECT"],
    ["幫我規劃六鏡腳本", "AGENT"],
    ["持續監控失敗的生成並提醒我", "WATCH"],
  ] as const)("classifies %s as %s", (message, expected) => {
    expect(classifyAssistantRequest(message).intent).toBe(expected);
  });

  /**
   * #663 的修法是把「列出／顯示／查看」視為問句。但這些是動詞不是疑問詞，
   * 經常出現在複合寫入的後半段；若無條件短路成 ASK，這些請求會變成只回答、不執行，
   * 而且完全沒有錯誤訊息——對使用者是靜默失效，對 v4 更是直接打斷
   * 「產生候選 → 列出」這條主線。唯讀查詢因此只在句中沒有寫入動詞時才算問句。
   */
  it.each([
    ["幫我建立一個新專案，然後顯示結果", "AGENT"],
    ["新增任務並列出清單", "DIRECT"],
    ["幫我把這段腳本拆成六鏡並顯示分鏡表", "DIRECT"],
    ["幫我建立會議筆記，查看有沒有重複", "DIRECT"],
    ["產生第 3 鏡的畫面並列出候選", "DIRECT"],
  ] as const)("still executes compound write %s (not ASK)", (message, expected) => {
    expect(classifyAssistantRequest(message).intent).toBe(expected);
  });

  it("keeps bounded writes on DIRECT, project work on AGENT, and true coordination on PLAN", () => {
    expect(classifyAssistantRequest("幫我把腳本拆成分鏡，然後逐鏡生成畫面").intent).toBe("AGENT");
    expect(classifyAssistantRequest("把這三鏡改善並重新生成素材").intent).toBe("AGENT");
    expect(classifyAssistantRequest("幫我建立 5 個待辦").intent).toBe("DIRECT");
    expect(classifyAssistantRequest("建立活動專案、分工、做影片、安排交付並持續監控").intent).toBe("PLAN");
  });

  it("only directly runs allow-listed reversible writes for explicit DIRECT", () => {
    const act = classifyAssistantRequest("幫我建立一則筆記");
    expect(canDirectlyExecuteCapability(act, "add_note")).toBe(true);
    expect(canDirectlyExecuteCapability(act, "create_task")).toBe(true);
    expect(canDirectlyExecuteCapability(act, "save_decision")).toBe(true);
    expect(canDirectlyExecuteCapability(act, "create_watch")).toBe(false);
    expect(canDirectlyExecuteCapability(act, "add_schedule_item")).toBe(false);
    expect(canDirectlyExecuteCapability(act, "send_dm")).toBe(false);
    expect(canDirectlyExecuteCapability(act, "create_project")).toBe(true);
    expect(canDirectlyExecuteCapability(classifyAssistantRequest("把這個網址加入專案"), "import_url")).toBe(true);

    const ask = classifyAssistantRequest("如何建立一則筆記？");
    expect(canDirectlyExecuteCapability(ask, "add_note")).toBe(false);
    expect(canDirectlyExecuteCapability(classifyAssistantRequest("幫我列出專案"), "create_project")).toBe(false);
  });

  it("routes capability-first imports and notes without creating a campaign", () => {
    const photos = classifyAssistantRequest("幫我把這個雲端資料夾匯入挑戰營專案素材庫 https://photos.app.goo.gl/demo");
    expect(photos).toMatchObject({ intent: "DIRECT", capabilityId: "import_url", executionMode: "DIRECT_TOOL" });
    expect(classifyAssistantRequest("把 https://example.com/a.pdf 加入挑戰營專案")).toMatchObject({
      intent: "DIRECT", capabilityId: "import_url",
    });
    expect(classifyAssistantRequest("建立 Note 記下今天的決定")).toMatchObject({
      intent: "DIRECT", capabilityId: "add_note",
    });
  });

  it("maps every required AIOS capability domain to real read/write policy", () => {
    const domains = new Set(ASSISTANT_CAPABILITIES.map((item) => item.domain));
    expect(domains).toEqual(new Set([
      "PROJECT", "TASK", "NOTE", "MEMORY", "STORYBOARD", "SCRIPT", "ASSET", "INTAKE",
      "DATABASE", "SCHEDULE", "MEMBER", "COLLABORATION", "COMPUTER", "GENERATION",
    ]));
    expect(ASSISTANT_CAPABILITIES.filter((item) => item.access === "WRITE").every((item) => item.risk !== "READ")).toBe(true);
    expect(ASSISTANT_CAPABILITIES.every((item) => item.executionMode && item.handler && item.verificationStrategy && item.resultType)).toBe(true);
    expect(classifyAssistantRequest("你可以用瀏覽器嗎？")).toMatchObject({
      intent: "ASK", capabilityId: "inspect_computer_runtime", executionMode: "DIRECT_TOOL",
    });
    expect(classifyAssistantRequest("幫我開啟瀏覽器")).toMatchObject({
      intent: "DIRECT", capabilityId: "open_browser_runtime", executionMode: "BROWSER_FALLBACK",
    });
    expect(ASSISTANT_CAPABILITIES.find((item) => item.id === "orchestrate_group_campaign")?.executionMode).toBe("GROUP_CAMPAIGN");
    expect(ASSISTANT_CAPABILITIES.find((item) => item.id === "prepare_external_generation")).toMatchObject({
      risk: "EXTERNAL", direct: false, executionMode: "DIRECT_TOOL", verificationStrategy: "external_confirmation",
    });
    expect(classifyAssistantRequest("這一幕還有什麼問題？")).toMatchObject({
      intent: "ASK", capabilityId: "animation_review_summary",
    });
    expect(classifyAssistantRequest("人物跟連戲先修，畫風不要")).toMatchObject({
      capabilityId: "animation_plan_repair",
    });
    expect(ASSISTANT_CAPABILITIES.find((item) => item.id === "animation_execute_repair")?.risk).toBe("COSTFUL");
    expect(ASSISTANT_CAPABILITIES.find((item) => item.id === "animation_adopt_candidate")?.risk).toBe("SAFE_WRITE");
    const adopt = ASSISTANT_CAPABILITIES.find((item) => item.id === "animation_adopt_candidate");
    expect(adopt).toMatchObject({
      handler: "consistencyAdopt.adoptGenerationCurrent",
      verificationStrategy: "read_back",
      direct: true,
    });
    const keep = ASSISTANT_CAPABILITIES.find((item) => item.id === "animation_keep_current");
    expect(keep).toMatchObject({
      handler: "scenes.review",
      verificationStrategy: "read_back",
    });
    expect(ASSISTANT_CAPABILITIES.find((item) => item.id === "animation_execute_repair")?.handler)
      .toBe("creativeContext.executeAnimationStage");
  });
});
