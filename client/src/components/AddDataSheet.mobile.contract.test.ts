import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
/** 去掉註解再比對：註解裡剛好寫到同名 class 時不該讓斷言誤過 */
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const start = declarations.lastIndexOf(`${selector} {`);
  expect(start, `找不到 ${selector} 的樣式規則`).toBeGreaterThan(-1);
  return declarations.slice(start, declarations.indexOf("}", start));
}

/**
 * 手機契約（資料中心 §34／§35／§36）。jsdom 讀不到媒體查詢，所以直接驗 CSS 宣告——
 * 這幾條每一條都對應一個真機上會出事的情況，不是樣式偏好。
 */
describe("加入資料面板的手機契約", () => {
  // 面板裡有標題／內容／網址輸入框。iOS 鍵盤彈出時不縮 dvh，
  // backdrop 不讓開 --kb-inset 的話「加入」鍵會被鍵盤蓋住按不到。
  it("鍵盤彈出時面板讓開，且捲動被圍堵在面板內", () => {
    const r = rule(".add-data-backdrop");
    expect(r).toContain("bottom: var(--kb-inset, 0px)");
    expect(r).toContain("overscroll-behavior: contain");
  });

  it("手機轉貼底 sheet：dvh 取代 vh、補 safe-area", () => {
    const r = rule(".add-data-card");
    expect(r).toContain("max-height: min(92dvh, 100%)");
    expect(r).toContain("max(16px, var(--safe-bottom))");
  });

  // iOS 對 <16px 的輸入框會自動放大整頁，sheet 會被推歪
  it("面板內的輸入框在手機至少 16px", () => {
    const start = declarations.lastIndexOf(".add-data-panel input,");
    expect(start).toBeGreaterThan(-1);
    expect(declarations.slice(start, declarations.indexOf("}", start))).toContain("font-size: 16px");
  });

  // 390px 上水平大卡一定被裁掉；來源與加入方式都必須是直式清單
  it("加入方式在手機是單欄，不是會被裁掉的水平卡", () => {
    expect(rule(".add-data-methods")).toContain("grid-template-columns: 1fr");
  });

  it("加入方式每一列至少 44px 觸控目標，長說明省略而不撐破", () => {
    expect(rule(".add-data-method")).toContain("min-height: 56px");
    expect(rule(".add-data-method__copy small")).toContain("text-overflow: ellipsis");
  });
});

describe("資料中心總覽的手機契約", () => {
  it("搜尋框在手機至少 16px（否則 iOS 會放大整頁）", () => {
    expect(rule(".hub-search input")).toContain("font-size: 16px");
  });

  it("資源列的長檔名省略而不撐破版面", () => {
    const start = declarations.lastIndexOf(".hub-item__copy strong,");
    expect(start).toBeGreaterThan(-1);
    expect(declarations.slice(start, declarations.indexOf("}", start))).toContain("text-overflow: ellipsis");
  });

  it("來源清單是直式的，每列至少 44px 可點", () => {
    expect(rule(".hub-source-list")).toContain("flex-direction: column");
    expect(rule(".hub-source")).toContain("min-height: 52px");
    expect(rule(".hub-source > a")).toContain("min-height: 44px");
  });

  it("首屏主要動作在手機佔滿寬度且維持 44px", () => {
    expect(rule(".database-intro__cta > .btn")).toContain("min-height: 44px");
  });
});

describe("連接與服務的手機契約", () => {
  // 原本是 230px 寬的水平捲動卡：390px 上第二張以後永遠被裁掉，
  // 使用者不捲就不知道還有 Notion／API。連線狀態是「一眼要看完」的資訊。
  it("來源狀態卡在手機改成直式清單，不再水平截斷", () => {
    const r = rule(".integration-status-grid");
    expect(r).toContain("flex-direction: column");
    expect(declarations.lastIndexOf(".integration-status-card { min-width: 0; width: 100%;")).toBeGreaterThan(-1);
  });
});
