import { describe, expect, it } from "vitest";
import type { AssistantPageContext } from "./assistantContext";
import {
  formatContextBreadcrumb,
  formatContextForPrompt,
  getAssistantQuickActions,
} from "./assistantQuickActions";

const ctx = (over: Partial<AssistantPageContext> = {}): AssistantPageContext => ({
  route: "/",
  pageType: "home",
  ...over,
});

describe("getAssistantQuickActions", () => {
  it("首頁最多 4 顆、其他情境最多 3 顆（再多就變選項牆）", () => {
    const pages: AssistantPageContext["pageType"][] = [
      "home", "project", "story", "storyboard", "production", "final", "settings", "studio",
      "assets", "tasks", "notes", "schedule", "database", "agent_run", "collab", "chat", "community", "other",
    ];
    for (const pageType of pages) {
      const out = getAssistantQuickActions(ctx({ pageType }));
      expect(out.length).toBeGreaterThan(0);
      const max = out[0].id.startsWith("home.") ? 4 : out[0].id.startsWith("project.") ? 5 : 3;
      expect(out.length).toBeLessThanOrEqual(max);
      for (const a of out) {
        expect(a.label.length).toBeLessThanOrEqual(6);
        expect(a.prompt.length).toBeGreaterThan(5);
      }
    }
  });

  it("首頁＝Goal → Action 快捷（加入資料／繼續目前工作／做影片／安排工作）", () => {
    const ids = getAssistantQuickActions(ctx({ pageType: "home" })).map((a) => a.id);
    expect(ids).toEqual(["home.add-data", "home.continue", "home.video", "home.schedule"]);
  });

  it("分鏡頁＝分鏡型；故事頁＝腳本型（頁面換、快捷就換）", () => {
    expect(getAssistantQuickActions(ctx({ pageType: "storyboard" })).map((a) => a.id))
      .toEqual(["board.progress", "board.next", "board.gaps"]);
    expect(getAssistantQuickActions(ctx({ pageType: "story" })).map((a) => a.id))
      .toEqual(["script.improve", "script.to-board", "script.pace"]);
  });

  it("有作用中分鏡：快捷指名那一鏡，且提示詞帶得出「第 3 鏡」", () => {
    const out = getAssistantQuickActions(ctx({
      pageType: "storyboard", entityType: "shot", entityId: "s3", entityLabel: "第 3 鏡",
    }));
    expect(out.map((a) => a.id)).toEqual(["shot.improve", "shot.next", "shot.assets"]);
    expect(out[0].prompt).toContain("第 3 鏡");
  });

  it("多選優先於作用中實體：選 3 鏡就給批次型，且提示詞說得出數量", () => {
    const out = getAssistantQuickActions(ctx({
      pageType: "storyboard", entityType: "shot", entityId: "s3", entityLabel: "第 3 鏡",
      selectedEntityIds: ["s3", "s4", "s5"],
    }));
    expect(out.map((a) => a.id)).toEqual(["shots.batch-improve", "shots.directions", "shots.unify-style"]);
    expect(out[0].prompt).toContain("3");
  });

  it("只選一個不算多選（回到單一實體的快捷）", () => {
    const out = getAssistantQuickActions(ctx({
      pageType: "storyboard", entityType: "shot", entityId: "s3", selectedEntityIds: ["s3"],
    }));
    expect(out[0].id).toBe("shot.improve");
  });

  it("素材多選／任務多選各有自己的批次快捷", () => {
    expect(getAssistantQuickActions(ctx({ pageType: "assets", entityType: "asset", selectedEntityIds: ["a", "b"] }))[0].id)
      .toBe("assets.pick-best");
    expect(getAssistantQuickActions(ctx({ pageType: "tasks", entityType: "task", selectedEntityIds: ["t", "u"] }))[0].id)
      .toBe("tasks.batch-schedule");
  });
});

describe("formatContextForPrompt（compact block；只給指標不給資料）", () => {
  it("空 context 回空字串（提示詞一字不多佔）", () => {
    expect(formatContextForPrompt(ctx())).toBe("頁面：今日工作台");
    expect(formatContextForPrompt(ctx({ pageType: "other" }))).toBe("");
  });

  it("列出頁面／正在看／已選取／剛剛做了，且不含任何 id", () => {
    const out = formatContextForPrompt(ctx({
      pageType: "storyboard",
      projectId: "11111111-1111-4111-8111-111111111111",
      entityType: "shot",
      entityId: "22222222-2222-4222-8222-222222222222",
      entityLabel: "第 3 鏡",
      selectedEntityIds: ["a", "b"],
      recentAction: "編輯了第 3 鏡",
    }));
    expect(out).toContain("頁面：分鏡");
    expect(out).toContain("正在看：第 3 鏡");
    expect(out).toContain("已選取：2 個分鏡");
    expect(out).toContain("剛剛做了：編輯了第 3 鏡");
    // 指標不含 uuid——真正資料由工具去查
    expect(out).not.toContain("1111");
    expect(out).not.toContain("2222");
  });
});

describe("formatContextBreadcrumb（給人看的一行，不顯示技術 id）", () => {
  it("專案 · 頁面 · 實體", () => {
    expect(formatContextBreadcrumb(ctx({
      pageType: "storyboard", projectTitle: "挑戰營回顧影片", entityLabel: "第 4 鏡",
    }))).toBe("挑戰營回顧影片 · 分鏡 · 第 4 鏡");
  });

  it("多選時顯示數量而非單一實體", () => {
    expect(formatContextBreadcrumb(ctx({
      pageType: "assets", projectTitle: "招生短片", entityType: "asset",
      entityLabel: "海報.png", selectedEntityIds: ["a", "b", "c"],
    }))).toBe("招生短片 · 素材庫 · 已選 3 個素材");
  });

  it("首頁沒有專案時只有頁面名", () => {
    expect(formatContextBreadcrumb(ctx({ pageType: "home" }))).toBe("今日工作台");
  });

  it("絕不吐 uuid", () => {
    const s = formatContextBreadcrumb(ctx({
      pageType: "project",
      projectId: "33333333-3333-4333-8333-333333333333",
      entityId: "44444444-4444-4444-8444-444444444444",
    }));
    expect(s).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
