import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  canonicalRequestHash,
  canonicalizeIdempotencyValue,
  databaseRowsBatchScope,
  hashIdempotencyKey,
  parseIdempotencyKey,
} from "./databaseBatchIdempotency";

describe("Idempotency-Key validation", () => {
  it("accepts bounded header-safe keys without normalizing their identity", () => {
    expect(parseIdempotencyKey("Import:2026-07-26_001")).toBe("Import:2026-07-26_001");
    expect(parseIdempotencyKey("a".repeat(IDEMPOTENCY_KEY_MAX_LENGTH))).toHaveLength(128);
  });

  it("rejects missing, short, oversized and unsafe keys with stable codes", () => {
    for (const value of [undefined, null, ""]) {
      expect(() => parseIdempotencyKey(value)).toThrowError(
        expect.objectContaining({ code: "IDEMPOTENCY_KEY_REQUIRED" }),
      );
    }
    for (const value of ["short", "contains space", "a".repeat(129), ["array-key"]]) {
      expect(() => parseIdempotencyKey(value)).toThrowError(
        expect.objectContaining({ code: "IDEMPOTENCY_KEY_INVALID" }),
      );
    }
  });
});

describe("canonical request hashing", () => {
  it("is independent of object insertion order, including nested row data", () => {
    const left = {
      tableId: "table-a",
      rows: [{ qty: 2, details: { color: "blue", size: "M" } }],
    };
    const right = {
      rows: [{ details: { size: "M", color: "blue" }, qty: 2 }],
      tableId: "table-a",
    };
    expect(canonicalizeIdempotencyValue(left)).toBe(canonicalizeIdempotencyValue(right));
    expect(canonicalRequestHash(left)).toBe(canonicalRequestHash(right));
  });

  it("retains array order and distinguishes missing data from explicit null", () => {
    expect(canonicalRequestHash([{ a: 1 }, { a: 2 }]))
      .not.toBe(canonicalRequestHash([{ a: 2 }, { a: 1 }]));
    expect(canonicalRequestHash([undefined])).not.toBe(canonicalRequestHash([null]));
  });

  it("binds key digests to actor and scope without storing the raw key", () => {
    const scope = databaseRowsBatchScope("table-a");
    const digest = hashIdempotencyKey("actor-a", scope, "Import-20260726");
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain("Import-20260726");
    expect(hashIdempotencyKey("actor-b", scope, "Import-20260726")).not.toBe(digest);
    expect(hashIdempotencyKey("actor-a", databaseRowsBatchScope("table-b"), "Import-20260726"))
      .not.toBe(digest);
  });
});

describe("atomic PostgreSQL composition source guards", () => {
  const source = readFileSync(
    new URL("./databaseBatchIdempotency.ts", import.meta.url),
    "utf8",
  );
  const coreSource = readFileSync(new URL("./databaseCore.ts", import.meta.url), "utf8");
  // TD-08：表定義在領域模組；idempotency_records 在 schema/auth.ts
  const schemaSource = readFileSync(new URL("../db/schema/auth.ts", import.meta.url), "utf8");
  const restSource = readFileSync(new URL("./restApi.ts", import.meta.url), "utf8");
  const mcpSource = readFileSync(new URL("./mcp.ts", import.meta.url), "utf8");
  const auditSource = readFileSync(new URL("./audit.ts", import.meta.url), "utf8");
  const databasesRouterSource = readFileSync(
    new URL("../routers/databases.ts", import.meta.url),
    "utf8",
  );

  it("uses a transaction advisory lock before cache lookup and composes rows + record", () => {
    const lockAt = source.indexOf("pg_advisory_xact_lock");
    const lookupAt = source.indexOf(".from(schema.idempotencyRecords)", lockAt);
    const rowsAt = source.indexOf("addDataRowsValidatedInTransaction", lookupAt);
    const recordAt = source.indexOf("tx.insert(schema.idempotencyRecords)", rowsAt);
    expect(lockAt).toBeGreaterThanOrEqual(0);
    expect(lookupAt).toBeGreaterThan(lockAt);
    expect(rowsAt).toBeGreaterThan(lookupAt);
    expect(recordAt).toBeGreaterThan(rowsAt);
    expect(source).toContain(
      "db.transaction((tx) => executeIdempotentDatabaseBatchInTransaction(tx, input))",
    );
    expect(coreSource).toContain("export async function addDataRowsValidatedInTransaction");
  });

  it("stores hashes and bounded expiry cleanup metadata, never a raw key column", () => {
    expect(schemaSource).toContain('keyHash: text("key_hash").notNull()');
    expect(schemaSource).toContain('requestHash: text("request_hash").notNull()');
    expect(schemaSource).toContain('expiresAt: timestamp("expires_at"');
    expect(schemaSource).not.toContain('rawKey: text("raw_key")');
    expect(source).toContain("for update skip locked");
    expect(source).toContain("IDEMPOTENCY_TTL_MS");
    expect(auditSource).toContain("idempotency.?key");
  });

  it("requires a key in REST and MCP and exposes replay/conflict semantics", () => {
    expect(restSource).toContain('req.headers["idempotency-key"]');
    expect(restSource).toContain("res.status(409)");
    expect(restSource).toContain('"Idempotency-Replayed"');
    expect(mcpSource).toContain('"idempotencyKey"');
    expect(mcpSource).toContain('required: ["tableId", "idempotencyKey", "rows"]');
    expect(mcpSource).toContain("pattern: IDEMPOTENCY_KEY_PATTERN.source");
    expect(mcpSource).toContain("executeIdempotentDatabaseBatch");
  });

  it("also composes the 5,000-row tRPC import through the same atomic service", () => {
    expect(databasesRouterSource).toContain("idempotencyKey: z.string()");
    expect(databasesRouterSource).toContain(".regex(");
    expect(databasesRouterSource).toContain("IDEMPOTENCY_KEY_PATTERN");
    expect(databasesRouterSource).toContain("executeIdempotentDatabaseBatch({");
    expect(databasesRouterSource).toContain('operation: "databases.importData"');
    expect(databasesRouterSource).toContain("replayed: batch.replayed");
    expect(databasesRouterSource).not.toContain("const batch = await addDataRowsValidated(");
  });
});
