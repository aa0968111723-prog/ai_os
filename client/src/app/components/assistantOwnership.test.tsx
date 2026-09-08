import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(path.join(__dirname, "..", "..", rel), "utf8");

/**
 * 助手面板的擁有權契約：**每個寬度只能有一個主人**。
 *
 * 兩個地方會掛 `GlobalAssistantSheet`：手機底欄（MobileNavigation）與桌面頂欄
 * （AssistantLauncher）。兩個又都監聽 compose 事件。如果它們的顯示條件沒有互補，
 * 就會出現某個寬度區間「送一句話同時開兩張面板」——實測是 portal 出去的兩張
 * 貼底 sheet 疊在一起，焦點與外點判斷互搶。
 *
 * 這幾條用原始碼層級守，而不是渲染測試：兩個元件各自有 trpc／wouter／portal 依賴，
 * 要把它們同時掛起來得鋪一整套替身，而真正要守的其實只是「條件是否互補」這件事。
 */
describe("助手面板的擁有權", () => {
  const mobileNav = read("app/components/MobileNavigation.tsx");
  const launcher = read("app/components/AssistantLauncher.tsx");

  it("兩邊都以同一個斷點來源決定要不要掛（不各寫一個數字）", () => {
    expect(mobileNav).toContain("useIsPhone");
    // AssistantLauncher 走 MENU_SHEET_MQ，而 MENU_SHEET_MQ 就是 PHONE_MQ（見 MenuSurface）
    expect(launcher).toContain("MENU_SHEET_MQ");
    expect(read("app/components/MenuSurface.tsx")).toContain("export const MENU_SHEET_MQ = PHONE_MQ;");
  });

  it("手機底欄只在手機掛面板", () => {
    // `{phone && <GlobalAssistantSheet` —— 沒有這個守衛，桌面會多出第二張
    expect(mobileNav).toMatch(/\{phone && \(\s*<GlobalAssistantSheet/);
  });

  it("桌面入口在手機直接退場", () => {
    expect(launcher).toContain("if (compact) return null;");
  });

  it("手機底欄在桌面不接管 compose 事件", () => {
    // 就算面板沒掛，監聽器仍在；不 gate 的話 state 會被設成 open 卻沒有東西渲染
    expect(mobileNav).toMatch(/if \(phone\) setAssistantOpen\(true\)/);
  });
});

/**
 * 「開面板之前就送出的那句話」只能被**面板裡那一張**領走。
 *
 * ProjectAssistant 有兩個渲染點：全站助手面板，以及創作台側欄常駐的那一張。
 * 側欄那張在桌面專案頁是一直掛著的——它若也補領，就會在面板掛好之前先把暫存
 * 吃掉，使用者按下送出後面板照樣開一個空輸入框。
 */
describe("pendingCompose 的擁有權", () => {
  const assistant = read("components/ProjectAssistant.tsx");
  const sheet = read("app/components/GlobalAssistantSheet.tsx");
  const workbench = read("features/creation-workbench/CreationWorkbench.tsx");

  it("ProjectAssistant 預設不領，由呼叫端明確宣告", () => {
    expect(assistant).toContain("claimsPendingCompose = false");
    // P1 第二次追問修復後 listener 帶 autoSend 分流（無 autoSend 仍只填框）；
    // 擁有權語義不變：補領仍只給 claimsPendingCompose 那一張。
    expect(assistant).toMatch(/useAssistantComposeListener\([\s\S]*?claimsPendingCompose,?\s*\)/);
    expect(assistant).toContain("if (!claimsPendingCompose)");
  });

  it("只有助手面板那一張宣告自己是主人", () => {
    expect(sheet).toContain("claimsPendingCompose");
    expect(workbench).not.toContain("claimsPendingCompose");
  });
});
