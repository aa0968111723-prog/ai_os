import { describe, expect, it } from "vitest";
import { assistantDatabaseQueryTerms, formatAssistantDatabaseEvidence, prioritizeAssistantDatabases } from "./assistantDatabaseEvidence";
import { serializeTableForIntelligence } from "./intelligenceLibrary";

describe("assistant database evidence", () => {
  it("extracts useful row lookup terms from a natural-language question", () => {
    const terms = assistantDatabaseQueryTerms("請問安倢在淡水的電話是什麼？");
    expect(terms).toContain("安倢");
    expect(terms).toContain("淡水");
    expect(terms).toContain("電話");
    expect(terms).not.toContain("資料庫");
    expect(terms).not.toContain("的電");
  });

  it("puts the selected database first so page ASK does not rescan the whole site", () => {
    const ordered = prioritizeAssistantDatabases([
      { id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1" },
      { id: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2" },
    ], { pageType: "database", entityType: "database", entityId: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2" });
    expect(ordered[0]?.id).toBe("bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2");
  });

  it("formats a stable source trace with table ref and row id", () => {
    const text = formatAssistantDatabaseEvidence([{
      tableId: "table-1",
      tableRef: "db1",
      tableName: "拍攝聯絡表",
      rowId: "row-1",
      text: "姓名: 安倢 | 電話: 0912",
      score: 0.91,
    }]);
    expect(text).toContain("db1 拍攝聯絡表");
    expect(text).toContain("row row-1");
    expect(text).toContain("姓名: 安倢");
  });
});

describe("structured database ingestion", () => {
  it("serializes field labels, stable row ids and values for chunking/citations", () => {
    const snapshot = serializeTableForIntelligence({
      id: "table-1",
      name: "場景資料",
      fields: [
        { key: "person", label: "人物", type: "text" },
        { key: "weather", label: "天氣", type: "text" },
      ],
      rows: [{ id: "row-1", data: { person: "安倢", weather: "淡水雨天" } }],
    });
    expect(snapshot.text).toContain("資料表：場景資料");
    expect(snapshot.text).toContain("[row:row-1]");
    expect(snapshot.text).toContain("人物: 安倢");
    expect(snapshot.indexedRows).toBe(1);
    expect(snapshot.truncated).toBe(false);
  });

  it("reports truncation instead of pretending an oversized table was fully indexed", () => {
    const snapshot = serializeTableForIntelligence({
      id: "table-1",
      name: "大型資料",
      fields: [{ key: "value", label: "內容", type: "text" }],
      rows: Array.from({ length: 20 }, (_, index) => ({ id: `row-${index}`, data: { value: "x".repeat(2_000) } })),
      maxChars: 10_000,
    });
    expect(snapshot.indexedRows).toBeLessThan(20);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.text).toContain("索引已截斷");
  });

  it("reports rows omitted by the database row cap even when the character budget remains", () => {
    const snapshot = serializeTableForIntelligence({
      id: "table-1",
      name: "大型資料",
      fields: [{ key: "value", label: "內容", type: "text" }],
      rows: [{ id: "row-1", data: { value: "indexed" } }],
      totalRows: 25_000,
    });
    expect(snapshot.indexedRows).toBe(1);
    expect(snapshot.truncated).toBe(true);
    expect(snapshot.text).toContain("1/25000");
  });
});
