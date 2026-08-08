import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { registerIntelligenceResource } from "./intelligenceLibrary";
import { purgeTableIntelligence } from "./intelligencePrivacy";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Intelligence database privacy (real PostgreSQL)", () => {
  const tableId = randomUUID();
  const fileId = randomUUID();
  const groupId = randomUUID();
  const creatorId = randomUUID();

  afterAll(async () => {
    await purgeTableIntelligence(tableId);
    await db.delete(schema.dataFiles).where(eq(schema.dataFiles.id, fileId));
    await db.delete(schema.dataTables).where(eq(schema.dataTables.id, tableId));
  });

  it("does not enroll tables or documents whose database disables AI", async () => {
    await db.insert(schema.dataTables).values({
      id: tableId,
      scope: "group",
      groupId,
      name: "Human-only records",
      fields: [{ key: "secret", label: "Secret", type: "text" }],
      agentAccess: "none",
      createdBy: creatorId,
    });
    await db.insert(schema.dataFiles).values({
      id: fileId,
      tableId,
      name: "private.txt",
      mime: "text/plain",
      textContent: "AI must not index this text",
      uploadedBy: creatorId,
    });

    await expect(registerIntelligenceResource({
      resourceKind: "table",
      resourceId: tableId,
      groupId,
      sourceType: "manual",
      createdBy: creatorId,
    })).rejects.toThrow("not enabled for AI analysis");
    await expect(registerIntelligenceResource({
      resourceKind: "document",
      resourceId: fileId,
      groupId,
      sourceType: "upload",
      createdBy: creatorId,
    })).rejects.toThrow("not enabled for AI analysis");

    const rows = await db.select({ id: schema.assetIntelligence.id }).from(schema.assetIntelligence)
      .where(orResource(tableId, fileId));
    expect(rows).toEqual([]);
  });

  it("purges previously derived data when AI access is disabled", async () => {
    const [intelligence] = await db.insert(schema.assetIntelligence).values({
      resourceKind: "table",
      resourceId: tableId,
      groupId,
      summary: "derived secret",
      analysisStatus: "ready",
      createdBy: creatorId,
    }).returning({ id: schema.assetIntelligence.id });
    const intelligenceId = intelligence!.id;
    const chunkId = randomUUID();
    await db.insert(schema.intelligenceChunks).values({
      id: chunkId,
      intelligenceId,
      ordinal: 0,
      text: "derived secret",
      tokenCount: 2,
      contentHash: "privacy-test",
    });
    await db.insert(schema.intelligenceEmbeddings).values({
      intelligenceId,
      chunkId,
      vector: [1, 0],
      dimensions: 2,
      embeddingModel: "privacy-test",
      embeddingVersion: "v1",
      embeddingStatus: "ready",
    });
    await db.insert(schema.entityRelationships).values({
      groupId,
      fromType: "asset",
      fromId: intelligenceId,
      relationType: "MENTIONS",
      toType: "topic",
      toId: randomUUID(),
      confidence: 0.9,
    });

    expect(await purgeTableIntelligence(tableId)).toBe(1);
    expect(await db.select().from(schema.assetIntelligence).where(eq(schema.assetIntelligence.id, intelligenceId))).toEqual([]);
    expect(await db.select().from(schema.intelligenceChunks).where(eq(schema.intelligenceChunks.intelligenceId, intelligenceId))).toEqual([]);
    expect(await db.select().from(schema.intelligenceEmbeddings).where(eq(schema.intelligenceEmbeddings.intelligenceId, intelligenceId))).toEqual([]);
    expect(await db.select().from(schema.entityRelationships).where(eq(schema.entityRelationships.fromId, intelligenceId))).toEqual([]);
  });
});

function orResource(tableId: string, fileId: string) {
  return or(
    and(
      eq(schema.assetIntelligence.resourceKind, "table"),
      eq(schema.assetIntelligence.resourceId, tableId),
    ),
    and(
      eq(schema.assetIntelligence.resourceKind, "document"),
      eq(schema.assetIntelligence.resourceId, fileId),
    ),
  );
}
