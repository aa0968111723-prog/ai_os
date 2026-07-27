/**
 * sanitizeAuditInput 單元測試(需求 2.2 審計):
 * 憑證鍵剔除(任意深度)、長字串/陣列/鍵數/深度截斷、原始型別直通。
 * 這層守住兩件事:敏感值不落庫、超大輸入(知識庫全文)不灌爆審計表。
 */
import { describe, expect, it } from "vitest";
import { sanitizeAuditInput } from "./audit";

describe("sanitizeAuditInput:原始型別", () => {
  it("null/undefined/數字/布林直通", () => {
    expect(sanitizeAuditInput(null)).toBeNull();
    expect(sanitizeAuditInput(undefined)).toBeUndefined();
    expect(sanitizeAuditInput(42)).toBe(42);
    expect(sanitizeAuditInput(false)).toBe(false);
  });

  it("200 字內字串不動;超過截斷並標註總長", () => {
    const short = "a".repeat(200);
    expect(sanitizeAuditInput(short)).toBe(short);
    const long = "字".repeat(250);
    expect(sanitizeAuditInput(long)).toBe(`${"字".repeat(200)}…(共 250 字)`);
  });
});

describe("sanitizeAuditInput:憑證鍵剔除", () => {
  it("password/token/secret/apikey/api_key 不分大小寫整鍵剔除", () => {
    const out = sanitizeAuditInput({
      password: "P@ss",
      Token: "tok",
      apiKey: "ak",
      api_key: "ak2",
      clientSecret: "cs",
      FAL_API_KEY: "fk",
      keep: "ok",
    }) as Record<string, unknown>;
    expect(out).toEqual({ keep: "ok" });
  });

  it("不把批次寫入的原始 idempotency key 寫進審計資料", () => {
    const out = sanitizeAuditInput({
      tableId: "table",
      idempotencyKey: "import-20260726-001",
      rows: [],
    }) as Record<string, unknown>;
    expect(out).toEqual({ tableId: "table", rows: [] });
  });

  it("巢狀物件內的憑證鍵一樣剔除", () => {
    const out = sanitizeAuditInput({ config: { password: "x", host: "db" } }) as { config: Record<string, unknown> };
    expect(out.config).toEqual({ host: "db" });
  });
});

describe("sanitizeAuditInput:結構截斷", () => {
  it("陣列超過 10 項 → 留前 10 項 + 總數標註", () => {
    const out = sanitizeAuditInput(Array.from({ length: 15 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(11);
    expect(out.slice(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(out[10]).toBe("…(共 15 項)");
  });

  it("物件超過 24 鍵 → 留前 24 鍵 + 截斷標記", () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < 30; i += 1) big[`k${String(i).padStart(2, "0")}`] = i;
    const out = sanitizeAuditInput(big) as Record<string, unknown>;
    expect(Object.keys(out)).toHaveLength(25); // 24 + 「…」
    expect(out["…"]).toBe("(鍵數截斷)");
    expect(out.k00).toBe(0);
    expect(out.k23).toBe(23);
    expect(out.k24).toBeUndefined();
  });

  it("巢狀深度到第 3 層截斷為標記;同深度的字串仍可通過", () => {
    const out = sanitizeAuditInput({ a: { b: { c: { d: 1 }, s: "第三層字串" } } }) as {
      a: { b: { c: unknown; s: string } };
    };
    expect(out.a.b.c).toBe("…(過深截斷)"); // 物件在 depth 3 → 截斷
    expect(out.a.b.s).toBe("第三層字串"); // 字串分支在深度檢查之前 → 保留
  });

  it("陣列元素同樣吃字串截斷與憑證剔除規則", () => {
    const out = sanitizeAuditInput([{ token: "t", ok: 1 }, "b".repeat(300)]) as [Record<string, unknown>, string];
    expect(out[0]).toEqual({ ok: 1 });
    expect(out[1]).toBe(`${"b".repeat(200)}…(共 300 字)`);
  });
});
