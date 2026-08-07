import { beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_PROJECT_IDEA_EVENT, proposeNewProjectIdea, takePendingNewProjectIdea } from "./newProjectIdea";

/**
 * 「以此靈感開新專案」曾經是一顆死鍵：GlobalAssistantSheet 派了 CustomEvent，
 * 但 Launchpad 是 lazy route、掛載前事件就發完了——全站零監聽者，按了沒有任何反應。
 * 這組測試守的是雙軌交棒的兩個要件：暫存先寫後派、讀完即焚。
 */
describe("newProjectIdea 交棒", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("propose 先寫暫存再派事件——晚掛載的 Launchpad 才補收得到", () => {
    let storedAtDispatch: string | null = null;
    const listener = () => {
      // 事件到手的瞬間暫存必須已經在了（順序反了的話，同步 handler 會讀到空）
      storedAtDispatch = sessionStorage.getItem("aios:new-project-idea");
    };
    window.addEventListener(NEW_PROJECT_IDEA_EVENT, listener);
    proposeNewProjectIdea("中秋活動宣傳");
    window.removeEventListener(NEW_PROJECT_IDEA_EVENT, listener);
    expect(storedAtDispatch).toBe("中秋活動宣傳");
  });

  it("take 讀完即焚——重新整理或下次掛載不會重放同一個靈感", () => {
    proposeNewProjectIdea("中秋活動宣傳");
    expect(takePendingNewProjectIdea()).toBe("中秋活動宣傳");
    expect(takePendingNewProjectIdea()).toBeNull();
  });

  it("空白靈感不寫也不派——沒有內容的交棒只會打開一個空表單騙人", () => {
    const seen = vi.fn();
    window.addEventListener(NEW_PROJECT_IDEA_EVENT, seen);
    proposeNewProjectIdea("   ");
    window.removeEventListener(NEW_PROJECT_IDEA_EVENT, seen);
    expect(seen).not.toHaveBeenCalled();
    expect(takePendingNewProjectIdea()).toBeNull();
  });

  it("事件 detail 帶 trim 後的標題，前後空白不進表單", () => {
    const seen = vi.fn((e: Event) => (e as CustomEvent<{ ideaTitle: string }>).detail.ideaTitle);
    window.addEventListener(NEW_PROJECT_IDEA_EVENT, seen);
    proposeNewProjectIdea("  月圓人團圓  ");
    window.removeEventListener(NEW_PROJECT_IDEA_EVENT, seen);
    expect(seen.mock.results[0]!.value).toBe("月圓人團圓");
  });
});
