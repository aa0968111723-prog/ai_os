import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { AnimationConsistencyEvaluation } from "../../../shared/animationEvaluation";

/**
 * Immutable output-evaluation evidence.
 *
 * This is evidence about a generated candidate, never Canon/Shot intent/current.
 * Same generation + evaluator version + evidence fingerprint is idempotent.
 */
export const generationConsistencyEvaluations = pgTable("generation_consistency_evaluations", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  shotId: uuid("shot_id").notNull(),
  generationId: uuid("generation_id").notNull(),
  candidateAssetId: uuid("candidate_asset_id").notNull(),
  packetId: uuid("packet_id").notNull(),
  evaluatorProvider: text("evaluator_provider").notNull(),
  evaluatorModel: text("evaluator_model"),
  evaluatorVersion: text("evaluator_version").notNull(),
  evidenceFingerprint: text("evidence_fingerprint").notNull(),
  result: jsonb("result").$type<AnimationConsistencyEvaluation>().notNull(),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  idempotencyUq: uniqueIndex("generation_consistency_eval_idempotency_uq")
    .on(t.generationId, t.evaluatorVersion, t.evidenceFingerprint),
  projectCreatedIdx: index("generation_consistency_eval_project_created_idx")
    .on(t.projectId, t.createdAt),
  shotCreatedIdx: index("generation_consistency_eval_shot_created_idx")
    .on(t.shotId, t.createdAt),
}));

