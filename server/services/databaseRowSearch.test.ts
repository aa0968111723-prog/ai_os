import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_DATABASE_KEYWORD_LIMIT,
  ASSISTANT_DATABASE_ROW_LIMIT,
  buildAssistantDatabaseRowsQuery,
  escapeLikeLiteral,
  normalizeAssistantDatabaseKeyword,
  normalizeDatabaseSearchKeyword,
} from "./databaseRowSearch";

const TABLE_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("AI 助手資料庫全量搜尋 SQL", () => {
  it("第 101 筆以外的命中不會再被 pre-limit 排除：WHERE/ILIKE 在 LIMIT 20 前由 PostgreSQL 執行", () => {
    // 舊版的具體反例：最新 149 筆都不匹配，只有第 150 筆匹配。
    const newestFirst = Array.from({ length: 150 }, (_, index) => ({
      data: { 名稱: index === 149 ? "埋藏在第150筆的命中" : `普通資料 ${index + 1}` },
    }));
    const containsKeyword = (row: (typeof newestFirst)[number]) => JSON.stringify(row.data).includes("埋藏");
    expect(newestFirst.slice(0, 100).filter(containsKeyword)).toEqual([]); // 舊路徑永遠查不到
    expect(newestFirst.filter(containsKeyword)).toHaveLength(1); // 完整資料集確實有命中

    const rendered = buildAssistantDatabaseRowsQuery(TABLE_ID, "埋藏").toSQL();
    const whereAt = rendered.sql.indexOf(" where ");
    const ilikeAt = rendered.sql.indexOf(" ilike ");
    const orderAt = rendered.sql.indexOf(" order by ");
    const limitAt = rendered.sql.indexOf(" limit ");

    expect(whereAt).toBeGreaterThan(-1);
    expect(ilikeAt).toBeGreaterThan(whereAt);
    expect(orderAt).toBeGreaterThan(ilikeAt);
    expect(limitAt).toBeGreaterThan(orderAt);
    expect(rendered.params).toEqual([TABLE_ID, "%埋藏%", "\\", ASSISTANT_DATABASE_ROW_LIMIT]);
    expect(ASSISTANT_DATABASE_ROW_LIMIT).toBe(20);
  });

  it("空關鍵字只取最新 20 列，不加入無意義的 ILIKE", () => {
    const rendered = buildAssistantDatabaseRowsQuery(TABLE_ID, "   ").toSQL();
    expect(rendered.sql).not.toContain("ilike");
    expect(rendered.params).toEqual([TABLE_ID, ASSISTANT_DATABASE_ROW_LIMIT]);
  });

  it("%、_、反斜線按字面搜尋且仍全部參數化", () => {
    expect(escapeLikeLiteral("100%_ok\\done")).toBe("100\\%\\_ok\\\\done");
    const rendered = buildAssistantDatabaseRowsQuery(TABLE_ID, "100%_ok\\done").toSQL();
    expect(rendered.params).toEqual([
      TABLE_ID,
      "%100\\%\\_ok\\\\done%",
      "\\",
      ASSISTANT_DATABASE_ROW_LIMIT,
    ]);
    // 使用者內容只在 params，不可被拼進 SQL 字串。
    expect(rendered.sql).not.toContain("100%");
  });

  it("服務層再次收斂 NUL、前後空白與 80 字上限", () => {
    const normalized = normalizeAssistantDatabaseKeyword(` \0${"關".repeat(100)} `);
    expect(normalized).toBe("關".repeat(ASSISTANT_DATABASE_KEYWORD_LIMIT));
  });

  it("REST/MCP/網頁通用搜尋也收斂 NUL、長度與 LIKE 萬用字元", () => {
    expect(normalizeDatabaseSearchKeyword(` \0${"a".repeat(250)} `)).toBe("a".repeat(200));
    for (const relative of ["./restApi.ts", "./mcp.ts", "../routers/databases.ts"]) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(source, relative).toContain("normalizeDatabaseSearchKeyword");
      expect(source, relative).toContain("escapeLikeLiteral");
      expect(source, relative).toContain("escape");
    }
  });
});

describe("兩個助手共用全量搜尋路徑", () => {
  it("專案與團隊助手都呼叫共用 helper，不再各自先 limit(100) 後 Node 篩選", () => {
    for (const relative of ["../routers/assistant.ts", "../routers/teamAssistant.ts"]) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(source, relative).toContain("searchAssistantDatabaseRows(");
      expect(source, relative).not.toContain("JSON.stringify(r.data");
      expect(source, relative).not.toContain(".limit(100)");
    }
  });
});
