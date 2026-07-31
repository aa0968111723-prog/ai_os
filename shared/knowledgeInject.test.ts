import { describe, expect, it } from "vitest";
import {
  assembleKnowledgeContext,
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
    expect(r.includedChars).toBe(100);
  });
});
