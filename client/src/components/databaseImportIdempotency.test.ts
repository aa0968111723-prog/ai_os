import { describe, expect, it } from "vitest";
import {
  clearDatabaseImportAttempt,
  createDatabaseImportIdempotencyKey,
  DATABASE_IMPORT_ATTEMPT_TTL_MS,
  databaseImportPayloadSignature,
  getDatabaseImportAttempt,
} from "./databaseImportIdempotency";

describe("database import retry identity", () => {
  it("keeps the signature stable across header-map insertion order", () => {
    const left = databaseImportPayloadSignature({
      tableId: "table",
      content: "name,qty\nlight,2",
      format: "csv",
      headerMap: { name: "name", qty: "qty" },
    });
    const right = databaseImportPayloadSignature({
      tableId: "table",
      content: "name,qty\nlight,2",
      format: "csv",
      headerMap: { qty: "qty", name: "name" },
    });
    expect(left).toBe(right);
  });

  it("rotates identity when content, format, mapping or table changes", () => {
    const base = {
      tableId: "table-a",
      content: "name\nlight",
      format: "csv",
      headerMap: { name: "name" },
    };
    const signature = databaseImportPayloadSignature(base);
    expect(databaseImportPayloadSignature({ ...base, content: "name\ncamera" })).not.toBe(signature);
    expect(databaseImportPayloadSignature({ ...base, format: "tsv" })).not.toBe(signature);
    expect(databaseImportPayloadSignature({ ...base, headerMap: { name: "title" } })).not.toBe(signature);
    expect(databaseImportPayloadSignature({ ...base, tableId: "table-b" })).not.toBe(signature);
  });

  it("creates header-safe keys accepted by the server policy", () => {
    expect(createDatabaseImportIdempotencyKey()).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/);
  });

  it("survives a reload with the same key but stores no raw imported content", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const payload = {
      tableId: "table-a",
      content: "name\nhighly-sensitive-row-value",
      format: "csv",
      headerMap: { name: "name" },
    };
    const first = getDatabaseImportAttempt(payload, { storage, now: 1_000 });
    const afterReload = getDatabaseImportAttempt(payload, { storage, now: 2_000 });
    expect(afterReload.key).toBe(first.key);
    expect(JSON.stringify([...values.values()])).not.toContain("highly-sensitive-row-value");

    clearDatabaseImportAttempt(payload.tableId, first.key, storage);
    const afterSuccess = getDatabaseImportAttempt(payload, { storage, now: 3_000 });
    expect(afterSuccess.key).not.toBe(first.key);
  });

  it("rotates after payload changes or the server replay TTL expires", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    const payload = {
      tableId: "table-a",
      content: "name\nlight",
      format: "csv",
      headerMap: { name: "name" },
    };
    const first = getDatabaseImportAttempt(payload, { storage, now: 1_000 });
    const changed = getDatabaseImportAttempt(
      { ...payload, content: "name\ncamera" },
      { storage, now: 2_000 },
    );
    expect(changed.key).not.toBe(first.key);
    const reverted = getDatabaseImportAttempt(payload, { storage, now: 3_000 });
    expect(reverted.key).toBe(first.key);
    const expired = getDatabaseImportAttempt(
      { ...payload, content: "name\ncamera" },
      { storage, now: 2_000 + DATABASE_IMPORT_ATTEMPT_TTL_MS },
    );
    expect(expired.key).not.toBe(changed.key);
  });
});
