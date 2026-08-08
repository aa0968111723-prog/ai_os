import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import {
  claimAndProcessIntelligenceJob,
  registerIntelligenceResource,
} from "./intelligenceLibrary";
import { retrieveAssistantDatabaseEvidence, type AssistantReadableDatabase } from "./assistantDatabaseEvidence";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Intelligence Library ingestion (real PostgreSQL)", () => {
  const resourceId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const tableId = randomUUID();
  const tableIntelligenceIds: string[] = [];

  afterAll(async () => {
    const rows = await db.select({ id: schema.assetIntelligence.id }).from(schema.assetIntelligence)
      .where(and(eq(schema.assetIntelligence.resourceKind, "asset"), eq(schema.assetIntelligence.resourceId, resourceId)));
    for (const row of rows) {
      await db.delete(schema.intelligenceProcessingJobs).where(eq(schema.intelligenceProcessingJobs.intelligenceId, row.id));
      await db.delete(schema.assetIntelligence).where(eq(schema.assetIntelligence.id, row.id));
    }
    for (const id of tableIntelligenceIds) {
      await db.delete(schema.assetIntelligenceEntities).where(eq(schema.assetIntelligenceEntities.intelligenceId, id));
      await db.delete(schema.entityRelationships).where(and(
        eq(schema.entityRelationships.fromType, "asset_intelligence"),
        eq(schema.entityRelationships.fromId, id),
      ));
      await db.delete(schema.intelligenceEmbeddings).where(eq(schema.intelligenceEmbeddings.intelligenceId, id));
      await db.delete(schema.intelligenceChunks).where(eq(schema.intelligenceChunks.intelligenceId, id));
      await db.delete(schema.intelligenceDataSources).where(eq(schema.intelligenceDataSources.intelligenceId, id));
      await db.delete(schema.aiClassifications).where(eq(schema.aiClassifications.intelligenceId, id));
      await db.delete(schema.assetIntelligenceTags).where(eq(schema.assetIntelligenceTags.intelligenceId, id));
      await db.delete(schema.intelligenceProcessingJobs).where(eq(schema.intelligenceProcessingJobs.intelligenceId, id));
      await db.delete(schema.assetIntelligence).where(eq(schema.assetIntelligence.id, id));
    }
    await db.delete(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    await db.delete(schema.dataTables).where(eq(schema.dataTables.id, tableId));
  });

  it("registers the same legacy resource idempotently", async () => {
    const first = await registerIntelligenceResource({ resourceKind: "asset", resourceId, groupId, projectId, sourceType: "upload" });
    const second = await registerIntelligenceResource({ resourceKind: "asset", resourceId, groupId, projectId, sourceType: "upload" });
    expect(second.id).toBe(first.id);
    const jobs = await db.select().from(schema.intelligenceProcessingJobs)
      .where(eq(schema.intelligenceProcessingJobs.intelligenceId, first.id));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.stage).toBe("extract_metadata");
    // Do not leave a deliberately source-less asset job ahead of the real
    // table pipeline exercised below.
    await db.delete(schema.intelligenceProcessingJobs).where(eq(schema.intelligenceProcessingJobs.intelligenceId, first.id));
  });

  it("indexes real structured rows and makes them retrievable as cited database evidence", async () => {
    const creatorId = randomUUID();
    await db.insert(schema.dataTables).values({
      id: tableId,
      scope: "group",
      groupId,
      name: "拍攝聯絡表",
      description: "劇組聯絡與天候備註",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "note", label: "備註", type: "text" },
        { key: "project", label: "專案", type: "project" },
      ],
      agentAccess: "read",
      createdBy: creatorId,
    });
    const rowId = randomUUID();
    await db.insert(schema.dataRows).values({
      id: rowId,
      tableId,
      data: {
        name: "安倢",
        note: "淡水雨天撐傘，電話 0912-345-678",
        project: "aaaaaaaa-----------------------aaa",
      },
      createdBy: creatorId,
    });
    const intelligence = await registerIntelligenceResource({
      resourceKind: "table",
      resourceId: tableId,
      groupId,
      sourceType: "manual",
      createdBy: creatorId,
    });
    tableIntelligenceIds.push(intelligence.id);

    for (let step = 0; step < 20; step += 1) {
      if (await claimAndProcessIntelligenceJob() === "idle") break;
    }

    const [analyzed] = await db.select().from(schema.assetIntelligence)
      .where(eq(schema.assetIntelligence.id, intelligence.id));
    expect(analyzed?.canonicalType).toBe("SPREADSHEET");
    expect(analyzed?.category).toBe("Structured Database");
    expect(analyzed?.categoryConfidence).toBe(1);
    expect(analyzed?.analysisStatus).toBe("ready");
    const chunks = await db.select().from(schema.intelligenceChunks)
      .where(eq(schema.intelligenceChunks.intelligenceId, intelligence.id));
    expect(chunks.some((chunk) => chunk.text.includes("安倢") && chunk.text.includes(rowId))).toBe(true);

    const readable: AssistantReadableDatabase[] = [{
      ref: "db1",
      id: tableId,
      name: "拍攝聯絡表",
      fields: [
        { key: "name", label: "姓名", type: "text", required: true },
        { key: "note", label: "備註", type: "text" },
        { key: "project", label: "專案", type: "project" },
      ],
      rowCount: 1,
      canWrite: false,
    }];
    const evidence = await retrieveAssistantDatabaseEvidence(readable, "安倢在淡水的電話是什麼？");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.rowId).toBe(rowId);
    expect(evidence[0]?.text).toContain("0912-345-678");
    expect(await retrieveAssistantDatabaseEvidence([], "安倢電話")).toEqual([]);
  });
});
