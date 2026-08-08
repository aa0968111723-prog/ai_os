import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { retrieveAssistantDatabaseEvidence, type AssistantReadableDatabase } from "./assistantDatabaseEvidence";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("assistant database evidence ranking (real PostgreSQL)", () => {
  const tableId = randomUUID();
  const groupId = randomUUID();
  const creatorId = randomUUID();

  afterAll(async () => {
    await db.delete(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    await db.delete(schema.dataTables).where(eq(schema.dataTables.id, tableId));
  });

  it("keeps an older exact match ahead of newer broad partial matches", async () => {
    const fields = [
      { key: "name", label: "Name", type: "text" as const, required: true },
      { key: "contact", label: "Contact", type: "text" as const },
    ];
    await db.insert(schema.dataTables).values({
      id: tableId,
      scope: "group",
      groupId,
      name: "Production contacts",
      fields,
      agentAccess: "read",
      createdBy: creatorId,
    });
    const exactRowId = randomUUID();
    await db.insert(schema.dataRows).values([
      {
        id: exactRowId,
        tableId,
        data: { name: "Anjie", contact: "phone 0912-345-678" },
        createdBy: creatorId,
        createdAt: new Date("2020-01-01T00:00:00Z"),
        updatedAt: new Date("2020-01-01T00:00:00Z"),
      },
      ...Array.from({ length: 40 }, (_, index) => ({
        id: randomUUID(),
        tableId,
        data: { name: `Recent contact ${index}`, contact: `phone extension ${index}` },
        createdBy: creatorId,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      })),
    ]);
    const databases: AssistantReadableDatabase[] = [{
      ref: "db1",
      id: tableId,
      name: "Production contacts",
      fields,
      rowCount: 41,
      canWrite: false,
    }];

    const evidence = await retrieveAssistantDatabaseEvidence(databases, "Find Anjie phone", {
      candidateLimit: 20,
      limit: 5,
    });

    expect(evidence[0]?.rowId).toBe(exactRowId);
    expect(evidence[0]?.text).toContain("0912-345-678");
  });
});
