import { and, eq, inArray, or } from "drizzle-orm";
import { db, schema } from "../db";

/**
 * Removes every AI-derived record for a database when its owner disables AI
 * access. The source table, rows and files remain untouched and human-readable.
 */
export async function purgeTableIntelligence(tableId: string): Promise<number> {
  const [tableIntelligence, documentIntelligence] = await Promise.all([
    db.select({ id: schema.assetIntelligence.id }).from(schema.assetIntelligence)
      .where(and(
        eq(schema.assetIntelligence.resourceKind, "table"),
        eq(schema.assetIntelligence.resourceId, tableId),
      )),
    db.select({ id: schema.assetIntelligence.id }).from(schema.assetIntelligence)
      .innerJoin(schema.dataFiles, eq(schema.dataFiles.id, schema.assetIntelligence.resourceId))
      .where(and(
        eq(schema.assetIntelligence.resourceKind, "document"),
        eq(schema.dataFiles.tableId, tableId),
      )),
  ]);
  const ids = [...new Set([...tableIntelligence, ...documentIntelligence].map((row) => row.id))];
  if (!ids.length) return 0;

  await db.delete(schema.intelligenceProcessingJobs).where(inArray(schema.intelligenceProcessingJobs.intelligenceId, ids));
  await db.delete(schema.intelligenceRetrievalSources).where(inArray(schema.intelligenceRetrievalSources.intelligenceId, ids));
  await db.delete(schema.intelligenceEmbeddings).where(inArray(schema.intelligenceEmbeddings.intelligenceId, ids));
  await db.delete(schema.intelligenceChunks).where(inArray(schema.intelligenceChunks.intelligenceId, ids));
  await db.delete(schema.intelligenceSegments).where(inArray(schema.intelligenceSegments.intelligenceId, ids));
  await db.delete(schema.aiClassifications).where(inArray(schema.aiClassifications.intelligenceId, ids));
  await db.delete(schema.aiFeedbackEvents).where(inArray(schema.aiFeedbackEvents.intelligenceId, ids));
  await db.delete(schema.aiReviewItems).where(inArray(schema.aiReviewItems.intelligenceId, ids));
  await db.delete(schema.faceClusterMembers).where(inArray(schema.faceClusterMembers.intelligenceId, ids));
  await db.delete(schema.detectedFaces).where(inArray(schema.detectedFaces.intelligenceId, ids));
  await db.delete(schema.duplicateGroupMembers).where(inArray(schema.duplicateGroupMembers.intelligenceId, ids));
  await db.delete(schema.assetIntelligenceEntities).where(inArray(schema.assetIntelligenceEntities.intelligenceId, ids));
  await db.delete(schema.assetIntelligenceTags).where(inArray(schema.assetIntelligenceTags.intelligenceId, ids));
  await db.delete(schema.intelligenceDataSources).where(inArray(schema.intelligenceDataSources.intelligenceId, ids));
  await db.delete(schema.intelligenceVersionLinks).where(or(
    inArray(schema.intelligenceVersionLinks.parentIntelligenceId, ids),
    inArray(schema.intelligenceVersionLinks.childIntelligenceId, ids),
  ));
  await db.delete(schema.entityRelationships).where(and(
    eq(schema.entityRelationships.fromType, "asset_intelligence"),
    inArray(schema.entityRelationships.fromId, ids),
  ));
  await db.delete(schema.assetIntelligence).where(inArray(schema.assetIntelligence.id, ids));
  return ids.length;
}
