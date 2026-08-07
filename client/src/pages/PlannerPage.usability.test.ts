/**
 * 筆記排程「先看到內容」的契約。
 *
 * 回報：這一頁「有點混亂加上不實用」。實機第一屏（393px）依序是標題、在線名單、
 * 三張跳轉大卡、卡片標題、檢視切換、說明鈕、Google 日曆設定——整整一屏沒有任何一筆
 * 行程或筆記。這裡把「內容先出現、設定退到後面」的幾個決定釘成契約，
 * 免得日後又有人把設定搬回清單上方。
 *
 * 佈局用原始碼／樣式表文字守（jsdom 讀不到媒體查詢，與同目錄 mobileStyles 測試同策略）；
 * dayLabel 是純函式，直接測行為。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dayLabel } from "./PlannerPage";

const planner = readFileSync(resolve(process.cwd(), "client/src/pages/PlannerPage.tsx"), "utf8");
const styles = readFileSync(resolve(process.cwd(), "client/src/styles.css"), "utf8");
const declarations = styles.replace(/\/\*[\s\S]*?\*\//g, "");

describe("dayLabel", () => {
  const now = new Date(2026, 7, 7, 9, 30); // 2026-08-07（週五）

  it("講今天／明天／昨天，不要使用者自己換算日期", () => {
    expect(dayLabel(new Date(2026, 7, 7, 23, 0), now)).toBe("今天・8/7（週五）");
    expect(dayLabel(new Date(2026, 7, 8, 0, 5), now)).toBe("明天・8/8（週六）");
    expect(dayLabel(new Date(2026, 7, 6, 8, 0), now)).toBe("昨天・8/6（週四）");
  });

  it("其餘日子給月日＋星期；跨年才補年份", () => {
    expect(dayLabel(new Date(2026, 7, 12), now)).toBe("8/12（週三）");
    expect(dayLabel(new Date(2027, 0, 3), now)).toBe("2027/1/3（週日）");
  });

  it("只看日期不看時間——同一天的深夜行程仍算今天", () => {
    expect(dayLabel(new Date(2026, 7, 7, 0, 0, 0), now)).toBe("今天・8/7（週五）");
    expect(dayLabel(new Date(2026, 7, 7, 23, 59, 59), now)).toBe("今天・8/7（週五）");
  });
});

describe("排程卡：內容先於設定", () => {
  // 日曆連結／.ics 匯出是「設定一次」的東西，不該每次進來都先捲過它
  it("把行事曆同步收進清單下方的摺疊，只有授權失效才自動展開", () => {
    const sync = planner.indexOf('<details className="planner-sync"');
    const list = planner.indexOf("{groups.map((g) => (");
    expect(sync).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(list);
    expect(planner).toContain('if (syncStatus.data?.status === "error") setSyncOpen(true)');
    // 摘要行要講得出目前狀態，否則收合等於把「有沒有在同步」也藏起來
    expect(planner).toContain("已連結 Google 日曆・自動同步中");
    expect(planner).toContain("尚未連結 Google 日曆");
  });

  it("手機新增行程只留標題＋開始，其餘欄位收在「其他欄位」後面", () => {
    expect(planner).toContain("const showAllFields = !compact || moreFields || !!endAt || !!projectId || !!note;");
    expect(planner).toContain("結束時間・專案・備註");
    expect(declarations).toMatch(/\.schedule-create-form__more\s*\{[^}]*min-height: 44px/);
  });

  it("分組標頭用 dayKey 當身分、人話當標籤", () => {
    expect(planner).toContain("else groups.push({ key, label: dayLabel(at), items: [ev] });");
    expect(planner).toContain("<div key={g.key}");
  });
});

describe("跳轉列：三顆膠囊，不是三張卡", () => {
  it("換掉會吃掉整個第一屏的大卡格線", () => {
    expect(planner).not.toContain("planner-jump-grid");
    expect(styles).not.toContain("planner-jump-grid");
    expect(planner).toContain('<nav className="planner-jump" aria-label="筆記排程功能">');
    expect(declarations).toMatch(/\.planner-jump\s*\{[^}]*flex-wrap: wrap/);
    // 膠囊仍要達得到觸控目標下限
    expect(declarations).toMatch(/\.planner-jump button\s*\{[^}]*min-height: 38px/);
  });
});

describe("筆記卡：加一則與找一則都不必捲到底", () => {
  it("新增鈕與搜尋框排在清單之前", () => {
    const card = planner.indexOf("function NotesCard(");
    expect(card).toBeGreaterThan(-1);
    const toolbar = planner.indexOf('<div className="planner-toolbar">\n        {!formOpen && (', card);
    const listBlock = planner.indexOf("{list.isLoading ? (", card);
    expect(toolbar).toBeGreaterThan(-1);
    expect(listBlock).toBeGreaterThan(toolbar);
    expect(planner).toContain('aria-label="搜尋筆記"');
  });

  it("搜尋比對標題與摘要，找不到時說清楚總共有幾份", () => {
    expect(planner).toContain(
      "notes.filter((n) => `${n.title} ${n.excerpt}`.toLowerCase().includes(needle))",
    );
    expect(planner).toContain("這個組有 {notes.length} 份筆記");
  });

  it("表單移到上方後，從下面按編輯要把視角帶回表單", () => {
    expect(planner).toContain("scrollIntoViewForChrome(formRef.current)");
  });
});
