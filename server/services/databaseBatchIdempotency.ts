import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db";
import {
  addDataRowsValidatedInTransaction,
  type DataTableRow,
  type DatabaseTransaction,
} from "./databaseCore";
import {
  toDatabaseBatchResponse,
  type DatabaseBatchResponse,
} from "./databaseBatchApi";

export const IDEMPOTENCY_KEY_MIN_LENGTH = 8;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_CLEANUP_BATCH = 100;
export const IDEMPOTENCY_CONFLICT_CODE = "IDEMPOTENCY_CONFLICT";

/** Single source of truth for service, tRPC validation and MCP JSON Schema. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const ADVISORY_HASH_SEED = 4_910_723;

export class IdempotencyConflictError extends Error {
  readonly code = IDEMPOTENCY_CONFLICT_CODE;

  constructor() {
    super(`${IDEMPOTENCY_CONFLICT_CODE}: 此 Idempotency-Key 已用於不同的批次內容`);
    this.name = "IdempotencyConflictError";
  }
}

export class InvalidIdempotencyKeyError extends Error {
  readonly code: "IDEMPOTENCY_KEY_REQUIRED" | "IDEMPOTENCY_KEY_INVALID";

  constructor(code: "IDEMPOTENCY_KEY_REQUIRED" | "IDEMPOTENCY_KEY_INVALID", message: string) {
    super(message);
    this.name = "InvalidIdempotencyKeyError";
    this.code = code;
  }
}

/**
 * Keys are intentionally conservative so they are safe in HTTP headers,
 * JSON-RPC arguments, logs and database lock names. They are case-sensitive.
 */
export function parseIdempotencyKey(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    throw new InvalidIdempotencyKeyError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "需要 Idempotency-Key（8–128 字元）",
    );
  }
  if (
    typeof value !== "string"
    || value.length < IDEMPOTENCY_KEY_MIN_LENGTH
    || value.length > IDEMPOTENCY_KEY_MAX_LENGTH
    || !IDEMPOTENCY_KEY_PATTERN.test(value)
  ) {
    throw new InvalidIdempotencyKeyError(
      "IDEMPOTENCY_KEY_INVALID",
      "Idempotency-Key 格式無效：限 8–128 字元，僅可使用英數字、點、底線、冒號與連字號",
    );
  }
  return value;
}

function frame(tag: string, value: string): string {
  return `${tag}${value.length}:${value}`;
}

/**
 * Injective canonical encoding for JSON-shaped values. Object keys are sorted,
 * while array order and the distinction between missing-data `undefined` and
 * explicit `null` are retained.
 */
export function canonicalizeIdempotencyValue(value: unknown): string {
  if (value === undefined) return "u";
  if (value === null) return "n";
  if (typeof value === "boolean") return value ? "b1" : "b0";
  if (typeof value === "string") return frame("s", value);
  if (typeof value === "number") {
    if (Number.isNaN(value)) return "dNaN";
    if (value === Number.POSITIVE_INFINITY) return "dInfinity";
    if (value === Number.NEGATIVE_INFINITY) return "d-Infinity";
    if (Object.is(value, -0)) return "d-0";
    return frame("d", String(value));
  }
  if (Array.isArray(value)) {
    return frame("a", value.map(canonicalizeIdempotencyValue).join(""));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entryValue]) => (
        `${frame("k", key)}${canonicalizeIdempotencyValue(entryValue)}`
      ))
      .join("");
    return frame("o", entries);
  }
  throw new TypeError(`不支援的冪等內容型別：${typeof value}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalRequestHash(value: unknown): string {
  return sha256(canonicalizeIdempotencyValue(value));
}

/** The digest binds the raw key to its actor and operation scope. */
export function hashIdempotencyKey(actorId: string, scope: string, rawKey: string): string {
  return sha256(
    `${frame("a", actorId)}${frame("s", scope)}${frame("k", rawKey)}`,
  );
}

export function databaseRowsBatchScope(tableId: string): string {
  return `database.rows.batch:${tableId}`;
}

export interface IdempotentDatabaseBatchResponse extends DatabaseBatchResponse {
  replayed: boolean;
}

export interface IdempotentDatabaseBatchInput {
  table: Pick<DataTableRow, "id" | "fields">;
  actorId: string;
  rawRows: unknown[];
  idempotencyKey: string;
  /** Defaults to the effective table + rows request used by REST/MCP. */
  requestPayload?: unknown;
  now?: Date;
}

function cachedBatchResponse(value: Record<string, unknown>): DatabaseBatchResponse {
  const errors = value.errors;
  if (
    typeof value.insertedCount !== "number"
    || typeof value.attempted !== "number"
    || typeof value.failed !== "number"
    || typeof value.skipped !== "number"
    || !Array.isArray(errors)
    || typeof value.capacityReached !== "boolean"
  ) {
    throw new Error("冪等快取內容損壞，請聯絡管理員");
  }
  return value as unknown as DatabaseBatchResponse;
}

/** Bounded, index-backed opportunistic cleanup; concurrent workers skip locks. */
export async function cleanupExpiredIdempotencyRecords(
  tx: DatabaseTransaction,
  now: Date,
  limit = IDEMPOTENCY_CLEANUP_BATCH,
): Promise<void> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 1_000));
  await tx.execute(sql`
    delete from ${schema.idempotencyRecords}
    where ${schema.idempotencyRecords.id} in (
      select ${schema.idempotencyRecords.id}
      from ${schema.idempotencyRecords}
      where ${schema.idempotencyRecords.expiresAt} <= ${now}
      order by ${schema.idempotencyRecords.expiresAt}
      limit ${safeLimit}
      for update skip locked
    )
  `);
}

/**
 * Transaction-level entry point for PostgreSQL integration and rollback/fault
 * tests. The advisory lock, protected rows and cached result share one tx.
 */
export async function executeIdempotentDatabaseBatchInTransaction(
  tx: DatabaseTransaction,
  input: IdempotentDatabaseBatchInput,
): Promise<IdempotentDatabaseBatchResponse> {
  const key = parseIdempotencyKey(input.idempotencyKey);
  const scope = databaseRowsBatchScope(input.table.id);
  const keyHash = hashIdempotencyKey(input.actorId, scope, key);
  const requestHash = canonicalRequestHash(input.requestPayload ?? {
    tableId: input.table.id,
    rows: input.rawRows,
  });
  const now = input.now ?? new Date();

  // A transaction-level lock is held until COMMIT/ROLLBACK and works across
  // replicas. The database row-cap lock is acquired later by databaseCore.
  await tx.execute(sql`
    select pg_advisory_xact_lock(hashtextextended(${keyHash}, ${ADVISORY_HASH_SEED}))
  `);

  const [existing] = await tx
    .select()
    .from(schema.idempotencyRecords)
    .where(and(
      eq(schema.idempotencyRecords.actorId, input.actorId),
      eq(schema.idempotencyRecords.scope, scope),
      eq(schema.idempotencyRecords.keyHash, keyHash),
    ))
    .limit(1);

  if (existing && existing.expiresAt.getTime() > now.getTime()) {
    if (existing.requestHash !== requestHash) {
      throw new IdempotencyConflictError();
    }
    return {
      ...cachedBatchResponse(existing.response),
      replayed: true,
    };
  }
  if (existing) {
    await tx
      .delete(schema.idempotencyRecords)
      .where(eq(schema.idempotencyRecords.id, existing.id));
  }

  const inserted = await addDataRowsValidatedInTransaction(
    tx,
    input.table,
    input.actorId,
    input.rawRows,
    { errorLimit: 50 },
  );
  const response = toDatabaseBatchResponse(inserted);
  await tx.insert(schema.idempotencyRecords).values({
    actorId: input.actorId,
    scope,
    keyHash,
    requestHash,
    response,
    expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
  });
  await cleanupExpiredIdempotencyRecords(tx, now);

  return { ...response, replayed: false };
}

export function executeIdempotentDatabaseBatch(
  input: IdempotentDatabaseBatchInput,
): Promise<IdempotentDatabaseBatchResponse> {
  return db.transaction((tx) => executeIdempotentDatabaseBatchInTransaction(tx, input));
}
