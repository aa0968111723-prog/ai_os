import { beforeEach, describe, expect, it } from "vitest";
import {
  getAssistantContext,
  noteAssistantAction,
  registerAssistantFocus,
  registerAssistantPage,
  resetAssistantContextForTest,
} from "./assistantContext";

beforeEach(() => {
  resetAssistantContextForTest();
  window.history.replaceState(null, "", "/");
});

describe("registerAssistantPage（頁面層）", () => {
  it("註冊後讀得到 pageType／projectId，route 由 store 自己補", () => {
    window.history.replaceState(null, "", "/p/proj-1");
    registerAssistantPage({ pageType: "project", projectId: "proj-1", projectTitle: "招生短片" });
    expect(getAssistantContext()).toMatchObject({
      route: "/p/proj-1",
      pageType: "project",
      projectId: "proj-1",
      projectTitle: "招生短片",
    });
  });

  it("卸載時清空——上一個專案不得殘留", () => {
    const dispose = registerAssistantPage({ pageType: "project", projectId: "proj-1" });
    dispose();
    expect(getAssistantContext()).toEqual({
      route: "/", pageType: "other", projectId: undefined, projectTitle: undefined,
      entityType: undefined, entityId: undefined, entityLabel: undefined,
      selectedEntityIds: undefined, activeTab: undefined, recentAction: undefined,
    });
  });

  it("換頁時舊頁 cleanup 不得清掉新頁（React effect 順序：新註冊 → 舊 cleanup）", () => {
    const disposeOld = registerAssistantPage({ pageType: "storyboard", projectId: "proj-1" });
    registerAssistantPage({ pageType: "tasks", projectId: "proj-2" });
    disposeOld();
    expect(getAssistantContext()).toMatchObject({ pageType: "tasks", projectId: "proj-2" });
  });

  it("同一專案內改 pageType（長捲軸捲到另一段）不清掉打開中的分鏡", () => {
    registerAssistantPage({ pageType: "story", projectId: "p1", projectTitle: "招生短片" });
    registerAssistantFocus({ entityType: "shot", entityId: "s3", entityLabel: "第 3 鏡" });
    registerAssistantPage({ pageType: "storyboard", projectId: "p1", projectTitle: "招生短片" });
    expect(getAssistantContext()).toMatchObject({
      pageType: "storyboard", projectId: "p1", entityId: "s3", entityLabel: "第 3 鏡",
    });
  });

  it("換專案時焦點一併作廢：上一案的分鏡不得帶到下一案", () => {
    registerAssistantPage({ pageType: "project", projectId: "proj-1" });
    registerAssistantFocus({ entityType: "shot", entityId: "shot-3", entityLabel: "第 3 鏡" });
    expect(getAssistantContext().entityId).toBe("shot-3");
    registerAssistantPage({ pageType: "project", projectId: "proj-2" });
    expect(getAssistantContext().entityId).toBeUndefined();
    expect(getAssistantContext().entityLabel).toBeUndefined();
  });
});

describe("registerAssistantFocus（焦點層）", () => {
  it("與頁面層獨立合成：捲動改 pageType 不會清掉打開中的分鏡", () => {
    registerAssistantPage({ pageType: "project", projectId: "p1", projectTitle: "招生短片" });
    registerAssistantFocus({ entityType: "shot", entityId: "s3", entityLabel: "第 3 鏡" });
    // 頁面層再註冊一次代表換頁；這裡改用焦點層覆寫 pageType（同一頁捲到分鏡段）
    registerAssistantFocus({ entityType: "shot", entityId: "s3", entityLabel: "第 3 鏡", pageType: "storyboard" });
    expect(getAssistantContext()).toMatchObject({
      pageType: "storyboard", projectId: "p1", projectTitle: "招生短片", entityId: "s3",
    });
  });

  it("焦點層卸載只清焦點，頁面身分留著", () => {
    registerAssistantPage({ pageType: "project", projectId: "p1" });
    const dispose = registerAssistantFocus({ entityType: "shot", entityId: "s3" });
    dispose();
    expect(getAssistantContext()).toMatchObject({ pageType: "project", projectId: "p1" });
    expect(getAssistantContext().entityId).toBeUndefined();
  });

  it("後註冊的焦點接管；舊焦點的 cleanup 不得清掉新焦點", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1" });
    const disposeOld = registerAssistantFocus({ entityType: "shot", entityId: "s3" });
    registerAssistantFocus({ entityType: "asset", entityId: "a9" });
    disposeOld();
    expect(getAssistantContext()).toMatchObject({ entityType: "asset", entityId: "a9" });
  });

  it("同頁多個面並存時，只有真的有選取的那個註冊——空手的面不得洗掉別人的焦點", () => {
    // 專案頁同時掛著分鏡中心與素材庫：兩者都無條件註冊的話，後掛載的（即使什麼都沒選）
    // 會把前者剛設好的焦點清成空白。約定是「沒東西可講就不註冊」（見各註冊點的 early return）。
    registerAssistantPage({ pageType: "storyboard", projectId: "p1" });
    registerAssistantFocus({ entityType: "shot", entityId: "s3", entityLabel: "第 3 鏡" });
    // 素材庫沒勾任何東西 → 不呼叫 registerAssistantFocus（模擬 early return）
    expect(getAssistantContext()).toMatchObject({ entityType: "shot", entityId: "s3" });
    // 使用者真的去勾了素材 → 這時才註冊，且理應接管（最近一次真實選擇勝出）
    registerAssistantFocus({ entityType: "asset", selectedEntityIds: ["a1", "a2"] });
    expect(getAssistantContext()).toMatchObject({ entityType: "asset", selectedEntityIds: ["a1", "a2"] });
    expect(getAssistantContext().entityId).toBeUndefined();
  });

  it("空的 selectedEntityIds 收成 undefined；有值就照收", () => {
    registerAssistantPage({ pageType: "assets" });
    registerAssistantFocus({ entityType: "asset", selectedEntityIds: [] });
    expect(getAssistantContext().selectedEntityIds).toBeUndefined();
    registerAssistantFocus({ entityType: "asset", selectedEntityIds: ["a1", "a2"] });
    expect(getAssistantContext().selectedEntityIds).toEqual(["a1", "a2"]);
  });

  it("同一份內容重複註冊不換快照身分（避免每次 render 觸發重繪）", () => {
    registerAssistantPage({ pageType: "home" });
    const first = getAssistantContext();
    registerAssistantPage({ pageType: "home" });
    expect(getAssistantContext()).toBe(first);
    registerAssistantFocus({ entityType: "shot", entityId: "s1" });
    const second = getAssistantContext();
    registerAssistantFocus({ entityType: "shot", entityId: "s1" });
    expect(getAssistantContext()).toBe(second);
  });

  it("selection 改變會產生新快照（勾選第三張素材要即時反映）", () => {
    registerAssistantPage({ pageType: "assets" });
    registerAssistantFocus({ entityType: "asset", selectedEntityIds: ["a1"] });
    const first = getAssistantContext();
    registerAssistantFocus({ entityType: "asset", selectedEntityIds: ["a1", "a2"] });
    expect(getAssistantContext()).not.toBe(first);
    expect(getAssistantContext().selectedEntityIds).toEqual(["a1", "a2"]);
  });
});

describe("noteAssistantAction", () => {
  it("記最近一次操作，重複同一句不換快照", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1" });
    noteAssistantAction("編輯了第 3 鏡");
    expect(getAssistantContext().recentAction).toBe("編輯了第 3 鏡");
    const snap = getAssistantContext();
    noteAssistantAction("編輯了第 3 鏡");
    expect(getAssistantContext()).toBe(snap);
  });

  it("空白忽略；過長截斷到 60", () => {
    registerAssistantPage({ pageType: "home" });
    noteAssistantAction("   ");
    expect(getAssistantContext().recentAction).toBeUndefined();
    noteAssistantAction("あ".repeat(100));
    expect(getAssistantContext().recentAction).toHaveLength(60);
  });

  it("同一專案內換段落時保留（「剛剛編輯了第 3 鏡」在製作段仍然為真）", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1" });
    noteAssistantAction("編輯了第 3 鏡");
    registerAssistantPage({ pageType: "production", projectId: "p1" });
    expect(getAssistantContext().recentAction).toBe("編輯了第 3 鏡");
  });

  it("換到別的地方就清掉（不把上一個專案／頁面的操作帶過去）", () => {
    registerAssistantPage({ pageType: "storyboard", projectId: "p1" });
    noteAssistantAction("編輯了第 3 鏡");
    registerAssistantPage({ pageType: "storyboard", projectId: "p2" });
    expect(getAssistantContext().recentAction).toBeUndefined();
    noteAssistantAction("上傳了素材");
    registerAssistantPage({ pageType: "home" });
    expect(getAssistantContext().recentAction).toBeUndefined();
  });
});
