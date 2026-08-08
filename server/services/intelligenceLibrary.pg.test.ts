import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { registerIntelligenceResource } from "./intelligenceLibrary";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Intelligence Library ingestion (real PostgreSQL)", () => {
  const resourceId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();

  afterAll(async () => {
    const rows = await db.select({ id: schema.assetIntelligence.id }).from(schema.assetIntelligence)
      .where(and(eq(schema.assetIntelligence.resourceKind, "asset"), eq(schema.assetIntelligence.resourceId, resourceId)));
    for (const row of rows) {
      await db.delete(schema.intelligenceProcessingJobs).where(eq(schema.intelligenceProcessingJobs.intelligenceId, row.id));
      await db.delete(schema.assetIntelligence).where(eq(schema.assetIntelligence.id, row.id));
    }
  });

  it("registers the same legacy resource idempotently", async () => {
    const first = await registerIntelligenceResource({ resourceKind: "asset", resourceId, groupId, projectId, sourceType: "upload" });
    const second = await registerIntelligenceResource({ resourceKind: "asset", resourceId, groupId, projectId, sourceType: "upload" });
    expect(second.id).toBe(first.id);
    const jobs = await db.select().from(schema.intelligenceProcessingJobs)
      .where(eq(schema.intelligenceProcessingJobs.intelligenceId, first.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.stage).toBe("extract_metadata");
  });
});
