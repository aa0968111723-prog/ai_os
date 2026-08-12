import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { addDataRowValidated } from "./databaseCore";
import type { DataField } from "../../shared/databaseFields";

const RUN_PG = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("custom DB row retry (real PostgreSQL)", () => {
  const userId = randomUUID();
  const tableId = randomUUID();
  const fields: DataField[] = [{ key: "name", label: "名稱", type: "text", required: true }];

  afterAll(async () => {
    await db.delete(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    await db.delete(schema.dataTables).where(eq(schema.dataTables.id, tableId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  it("replays the same payload within 2 minutes instead of inserting twice", async () => {
    await db.insert(schema.users).values({
      id: userId, name: "qa", email: `dbrow-${userId}@example.test`, passwordHash: "x",
    });
    await db.insert(schema.dataTables).values({
      id: tableId,
      scope: "personal",
      ownerId: userId,
      name: "retry-table",
      fields,
      agentAccess: "write",
      createdBy: userId,
    });

    const first = await addDataRowValidated({ id: tableId, fields }, userId, { name: "三腳架" });
    const second = await addDataRowValidated({ id: tableId, fields }, userId, { name: "三腳架" });
    expect(second.id).toBe(first.id);
    const rows = await db.select({ id: schema.dataRows.id }).from(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    expect(rows).toHaveLength(1);
  });
});
