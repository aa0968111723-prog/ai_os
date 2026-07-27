import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import {
  databaseRowsBatchScope,
  executeIdempotentDatabaseBatch,
  executeIdempotentDatabaseBatchInTransaction,
} from "./databaseBatchIdempotency";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG)("database batch idempotency (real PostgreSQL)", () => {
  const actorId = randomUUID();
  const tableId = randomUUID();
  const prefix = randomUUID();
  let table: typeof schema.dataTables.$inferSelect;

  beforeAll(async () => {
    await db.insert(schema.users).values({
      id: actorId,
      name: "Idempotency PG test",
      email: `idempotency-${prefix}@example.test`,
      passwordHash: "not-used",
    });
    [table] = await db
      .insert(schema.dataTables)
      .values({
        id: tableId,
        scope: "personal",
        ownerId: actorId,
        name: "Idempotency PG test",
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "count", label: "Count", type: "number" },
        ],
        createdBy: actorId,
      })
      .returning();
  });

  afterAll(async () => {
    await db
      .delete(schema.idempotencyRecords)
      .where(eq(schema.idempotencyRecords.actorId, actorId));
    await db.delete(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    await db.delete(schema.dataTables).where(eq(schema.dataTables.id, tableId));
    await db.delete(schema.users).where(eq(schema.users.id, actorId));
  });

  it("rolls rows and cache back together when the outer transaction aborts", async () => {
    const marker = new Error("simulated crash before commit");
    await expect(db.transaction(async (tx) => {
      await executeIdempotentDatabaseBatchInTransaction(tx, {
        table,
        actorId,
        rawRows: [{ name: "rolled back", count: 1 }],
        idempotencyKey: "pg-rollback-0001",
      });
      throw marker;
    })).rejects.toBe(marker);

    const rows = await db
      .select()
      .from(schema.dataRows)
      .where(eq(schema.dataRows.tableId, tableId));
    const records = await db
      .select()
      .from(schema.idempotencyRecords)
      .where(eq(schema.idempotencyRecords.actorId, actorId));
    expect(rows).toHaveLength(0);
    expect(records).toHaveLength(0);
  });

  it("serializes concurrent replicas, replays exact requests and conflicts on drift", async () => {
    const input = {
      table,
      actorId,
      rawRows: [{ name: "alpha", count: 1 }, { name: "beta", count: 2 }],
      idempotencyKey: "pg-concurrent-0001",
    };
    const replies = await Promise.all([
      executeIdempotentDatabaseBatch(input),
      executeIdempotentDatabaseBatch(input),
    ]);
    expect(replies.map((reply) => reply.replayed).sort()).toEqual([false, true]);
    expect(replies[0].insertedCount).toBe(2);
    expect(replies[1].insertedCount).toBe(2);

    const rows = await db
      .select()
      .from(schema.dataRows)
      .where(eq(schema.dataRows.tableId, tableId));
    expect(rows).toHaveLength(2);

    const records = await db
      .select()
      .from(schema.idempotencyRecords)
      .where(and(
        eq(schema.idempotencyRecords.actorId, actorId),
        eq(schema.idempotencyRecords.scope, databaseRowsBatchScope(tableId)),
      ));
    expect(records).toHaveLength(1);
    expect(records[0].keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(records[0].keyHash).not.toBe(input.idempotencyKey);

    await expect(executeIdempotentDatabaseBatch({
      ...input,
      rawRows: [{ name: "changed", count: 99 }],
    })).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("allows key reuse after expiry and replaces the cached record", async () => {
    await db
      .update(schema.idempotencyRecords)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(schema.idempotencyRecords.actorId, actorId));

    const response = await executeIdempotentDatabaseBatch({
      table,
      actorId,
      rawRows: [{ name: "after-expiry", count: 3 }],
      idempotencyKey: "pg-concurrent-0001",
    });
    expect(response.replayed).toBe(false);
    expect(response.insertedCount).toBe(1);

    const rows = await db
      .select()
      .from(schema.dataRows)
      .where(eq(schema.dataRows.tableId, tableId));
    expect(rows).toHaveLength(3);
    const records = await db
      .select()
      .from(schema.idempotencyRecords)
      .where(eq(schema.idempotencyRecords.actorId, actorId));
    expect(records).toHaveLength(1);
  });
});
