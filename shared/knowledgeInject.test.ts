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

  /**
   * 這條界線決定了「本次知識優先」能不能收資料庫文件：preferIds 只認得 knowledge 列，
   * 對不上的 id 會被無聲丟掉——不報錯、不回報。代理規劃（agentCore.loadPickedPlannerSources）
   * 走的是另一條路、認得 dataFiles，兩邊契約不同。若哪天要讓資料庫文件也能在「問 AI」勾選，
   * 得先讓助手端真的載得到那些檔，而不是把 dataFile id 塞進 preferIds 就當支援了。
   */
  it("preferIds 出現不屬於本專案知識的 id 時無聲略過（不丟錯、不佔位）", () => {
    const rows = [
      row({ id: "know-1", kind: "transcript", title: "開示逐字稿", content: "a", createdAt: new Date("2026-01-01") }),
    ];
    const ranked = rankKnowledgeRows(rows, ["file-在資料庫的PDF", "know-1"], "flat");
    expect(ranked.map((r) => r.id)).toEqual(["know-1"]);
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

  /**
   * 使用者實際會體驗到的後果：勾了一份不在 knowledge 表的文件，組出來的上下文完全沒有它，
   * 而 truncated／items 也不會留下任何痕跡可讓 UI 說「你勾的那份沒進去」。
   * 所以在助手端補上載入能力之前，介面上就不該讓資料庫文件可勾。
   */
  it("非知識庫的 preferId 既不注入內容、也不在 items 留下痕跡", () => {
    const rows = [row({ id: "know-1", kind: "note", title: "站內筆記", content: "KNOWN-CONTENT" })];
    const r = assembleKnowledgeContext(rows, "", labelOf, {
      budgetChars: 500,
      preferIds: ["file-法會流程PDF", "know-1"],
      mode: "balanced",
    });
    expect(r.text).toContain("KNOWN-CONTENT");
    expect(r.text).not.toContain("法會流程PDF");
    expect(r.items.map((i) => i.id)).toEqual(["know-1"]);
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
