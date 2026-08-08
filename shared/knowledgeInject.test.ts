import { describe, expect, it } from "vitest";
import {
  assembleKnowledgeContext,
  extractKnowledgeSummary,
  rankKnowledgeRows,
  KIND_BUDGET_WEIGHTS,
  type KnowledgeRowForInject,
} from "./knowledgeInject";

const labelOf = (k: string) => k;

function row(
  partial: Partial<KnowledgeRowForInject> & Pick<KnowledgeRowForInject, "id" | "kind" | "title" | "content">,
): KnowledgeRowForInject {
  return {
    pinned: false,
    createdAt: new Date("2026-01-01"),
    ...partial,
  };
}

describe("rankKnowledgeRows", () => {
  it("preferIds → pinned → 時間", () => {
    const rows = [
      row({ id: "a", kind: "note", title: "新筆記", content: "a", createdAt: new Date("2026-03-01") }),
      row({ id: "b", kind: "script", title: "腳本", content: "b", pinned: true, createdAt: new Date("2026-01-01") }),
      row({ id: "c", kind: "transcript", title: "開示", content: "c", createdAt: new Date("2026-02-01") }),
    ];
    const ranked = rankKnowledgeRows(rows, ["c"], "flat");
    expect(ranked.map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("script_first 把腳本提前（非 prefer 區）", () => {
    const rows = [
      row({ id: "n", kind: "note", title: "n", content: "n", createdAt: new Date("2026-03-01") }),
      row({ id: "s", kind: "script", title: "s", content: "s", createdAt: new Date("2026-01-01") }),
    ];
    const ranked = rankKnowledgeRows(rows, [], "script_first");
    expect(ranked[0]!.id).toBe("s");
  });
});

describe("assembleKnowledgeContext", () => {
  it("釘選腳本在預算內優先於新長筆記", () => {
    const longNote = "N".repeat(5000);
    const script = "SCRIPT-BODY-" + "S".repeat(100);
    const rows = [
      row({ id: "note1", kind: "note", title: "雜訊", content: longNote, createdAt: new Date("2026-06-01") }),
      row({
        id: "sc1",
        kind: "script",
        title: "主腳本",
        content: script,
        pinned: true,
        createdAt: new Date("2026-01-01"),
      }),
    ];
    const r = assembleKnowledgeContext(rows, "", labelOf, { budgetChars: 2000, mode: "flat" });
    expect(r.text).toContain("SCRIPT-BODY");
    expect(r.items.find((i) => i.id === "sc1")?.status).toBe("full");
  });

  it("preferIds 先於配額", () => {
    const rows = [
      row({ id: "a", kind: "note", title: "A", content: "AAA-CONTENT", createdAt: new Date("2026-01-01") }),
      row({ id: "b", kind: "script", title: "B", content: "BBB-SCRIPT", createdAt: new Date("2026-02-01") }),
    ];
    const r = assembleKnowledgeContext(rows, "", labelOf, {
      budgetChars: 50,
      preferIds: ["a"],
      mode: "balanced",
    });
    expect(r.text.indexOf("AAA-CONTENT")).toBeGreaterThan(-1);
    expect(r.items.find((i) => i.id === "a")?.includedChars).toBeGreaterThan(0);
  });

  it("script_only 不含卡片、優先腳本", () => {
    const rows = [
      row({ id: "n", kind: "note", title: "筆記", content: "NOTE-ONLY", createdAt: new Date("2026-03-01") }),
      row({ id: "s", kind: "script", title: "腳本", content: "SCRIPT-ONLY", createdAt: new Date("2026-01-01") }),
    ];
    const r = assembleKnowledgeContext(rows, "【角色定裝卡】假卡片", labelOf, {
      mode: "script_only",
      budgetChars: 500,
      includeCards: true, // 應被 mode 關掉
    });
    expect(r.text).not.toContain("假卡片");
    expect(r.text).toContain("SCRIPT-ONLY");
    expect(r.cardsIncluded).toBe(false);
  });

  it("balanced 權重總和為 1", () => {
    const sum = Object.values(KIND_BUDGET_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("截斷時 truncated 與 partial 狀態正確", () => {
    const rows = [row({ id: "x", kind: "script", title: "長", content: "X".repeat(1000) })];
    const r = assembleKnowledgeContext(rows, "", labelOf, { budgetChars: 100, mode: "flat" });
    expect(r.truncated).toBe(true);
    expect(r.items[0]!.status).toBe("partial");
    // 約 18% 預算預留給其他篇摘要，故單篇不會吃滿 100
    expect(r.includedChars).toBeGreaterThan(0);
    expect(r.includedChars).toBeLessThanOrEqual(100);
  });

  it("extractKnowledgeSummary 壓空白並截斷", () => {
    const s = extractKnowledgeSummary("第一句。".repeat(80), 40);
    expect(s.length).toBeLessThanOrEqual(42);
    expect(s).toContain("第一句");
  });

  it("預算緊時 skipped 篇可用 summary 補上", () => {
    const rows = [
      row({
        id: "big",
        kind: "script",
        title: "長腳本",
        content: "S".repeat(500),
        createdAt: new Date("2026-02-01"),
      }),
      row({
        id: "side",
        kind: "note",
        title: "側記",
        content: "完整側記內容不進預算",
        summary: "側記摘要重點",
        createdAt: new Date("2026-01-01"),
      }),
    ];
    const r = assembleKnowledgeContext(rows, "", labelOf, { budgetChars: 200, mode: "flat" });
    expect(r.text).toContain("側記摘要重點");
  });
});

/**
 * P5「本次只用這幾份依據」。
 *
 * 最重要的一條：這是**限制**不是排序。使用者說「只用這三份」時，第四份不該因為
 * 預算還有剩就偷偷混進去——那等於系統用了他沒選的資料，還讓他以為沒有。
 */
describe("onlyIds（本次只用這幾份）", () => {
  const rows = [
    row({ id: "a", kind: "script", title: "腳本", content: "AAAA" }),
    row({ id: "b", kind: "note", title: "筆記", content: "BBBB" }),
    row({ id: "c", kind: "transcript", title: "開示", content: "CCCC" }),
  ];

  it("★ 只有選中的進得了上下文——沒選的即使預算還有剩也不進", () => {
    const r = assembleKnowledgeContext(rows, "", labelOf, { onlyIds: ["a"], budgetChars: 10_000 });
    expect(r.text).toContain("腳本");
    expect(r.text).not.toContain("筆記");
    expect(r.text).not.toContain("開示");
    expect(r.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("空陣列視同未指定（呼叫端不小心傳空陣列不該把依據全部清空）", () => {
    const r = assembleKnowledgeContext(rows, "", labelOf, { onlyIds: [], budgetChars: 10_000 });
    expect(r.items.map((i) => i.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("★ 選的 id 全都不存在時維持空集合——不可以自作主張退回全部", () => {
    // script_only 在沒有腳本時會退回全部；這裡刻意不那樣做：
    // 使用者明確說「只用這幾份」，退回全部等於偷偷用了他沒選的資料。
    const r = assembleKnowledgeContext(rows, "", labelOf, { onlyIds: ["nope"], budgetChars: 10_000 });
    expect(r.items).toEqual([]);
    expect(r.text).not.toContain("腳本");
    expect(r.text).not.toContain("筆記");
  });

  it("★ 限制不會放寬預算——選中的一樣會被上限截斷並誠實回報", () => {
    const long = [row({ id: "a", kind: "script", title: "長腳本", content: "x".repeat(500) })];
    const r = assembleKnowledgeContext(long, "", labelOf, { onlyIds: ["a"], budgetChars: 100 });
    expect(r.includedChars).toBeLessThanOrEqual(100);
    expect(r.truncated).toBe(true);
  });

  it("totalContentChars 以「本次可用的集合」為分母，截斷率才有意義", () => {
    const r = assembleKnowledgeContext(rows, "", labelOf, { onlyIds: ["a"], budgetChars: 10_000 });
    expect(r.totalContentChars).toBe(4); // 只有 a 的 "AAAA"
  });

  it("與 preferIds 併用：仍只在選中的集合內排序", () => {
    const r = assembleKnowledgeContext(rows, "", labelOf, {
      onlyIds: ["a", "b"],
      preferIds: ["b"],
      budgetChars: 10_000,
    });
    expect(r.items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});
