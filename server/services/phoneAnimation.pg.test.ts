/**
 * Phone animation projection against real PostgreSQL.
 *
 * Proves the compact phone summary is the existing board, filtered repair
 * calls the existing planner, and confirmation has not happened yet so
 * generation count stays unchanged.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { emptyEvaluationDimensions } from "../../shared/animationEvaluation";
import {
  phoneAnimationFindings,
  phoneAnimationRepairProposal,
  phoneAnimationSummary,
} from "./phoneAnimation";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Phone animation production adapter (real PostgreSQL)", () => {
  const groupId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const auth: AuthState = {
    user: { id: userId, name: "phone-anim", email: "phone-anim@example.test", isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "動畫組", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
  const shotIds: string[] = [];
  const labels: string[] = [];

  afterAll(async () => {
    await db.delete(schema.generationConsistencyEvaluations).where(eq(schema.generationConsistencyEvaluations.projectId, projectId));
    await db.delete(schema.generations).where(eq(schema.generations.projectId, projectId));
    await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });

  it("seeds three review shots with persisted findings", async () => {
    await db.insert(schema.projects).values({
      id: projectId,
      groupId,
      ownerId: userId,
      title: "手機修復閉環",
      kind: "animation",
      platform: "test",
      format: "9:16",
    });
    const [image] = await db.insert(schema.assets).values({
      projectId, groupId, kind: "image", title: "current", url: "https://example.test/cur.png",
    }).returning({ id: schema.assets.id });
    const inserted = await db.insert(schema.scenes).values([
      { projectId, orderIndex: 3, title: "Shot 04", prompt: "人物站著", assetId: image.id },
      { projectId, orderIndex: 4, title: "Shot 05", prompt: "換手", assetId: image.id },
      { projectId, orderIndex: 7, title: "Shot 08", prompt: "畫風", assetId: image.id },
    ]).returning({ id: schema.scenes.id });
    shotIds.push(...inserted.map((row) => row.id));
    const findings = [
      { code: "identity_drift", dimension: "identity" as const, reason: "人物外觀偏移" },
      { code: "hand_swap", dimension: "physics" as const, reason: "左右手持物與上一鏡不一致" },
      { code: "style_drift", dimension: "style" as const, reason: "畫風陰影偏離目前 Style" },
    ];
    for (const [index, shotId] of shotIds.entries()) {
      const generationId = randomUUID();
      await db.insert(schema.generations).values({
        id: generationId,
        projectId,
        groupId,
        userId,
        modelId: "fal-ai/flux/dev",
        kind: "image",
        status: "done",
        prompt: "x",
        sceneId: shotId,
      });
      const dimensions = emptyEvaluationDimensions();
      dimensions[findings[index]!.dimension] = {
        status: "finding",
        confidence: "high",
        summary: findings[index]!.reason,
        evidenceSourceIds: [],
      };
      await db.insert(schema.generationConsistencyEvaluations).values({
        projectId,
        groupId,
        shotId,
        generationId,
        candidateAssetId: image.id,
        packetId: randomUUID(),
        evaluatorProvider: "structural",
        evaluatorVersion: "animation-structural.v1",
        evidenceFingerprint: `phone-anim-${index}`,
        result: {
          schemaVersion: "animation-consistency-evaluation.v1",
          generationId,
          shotId,
          evaluatorVersion: "animation-structural.v1",
          evidenceFingerprint: `phone-anim-${index}`,
          visualCheckStatus: "completed",
          dimensions,
          recommendation: "repair",
          findings: [{
            code: findings[index]!.code,
            dimension: findings[index]!.dimension,
            severity: findings[index]!.dimension === "physics" ? "blocker" : "warning",
            confidence: "high",
            reason: findings[index]!.reason,
            evidenceSourceIds: [],
          }],
        },
      });
    }
  });

  it("summary counts match board truth and stay bounded", async () => {
    const summary = await phoneAnimationSummary({
      auth,
      projectId,
      onQuery: (label) => labels.push(label),
    });
    expect(summary.counts.needsReview).toBe(3);
    expect(summary.counts.blocked).toBe(1);
    expect(summary.topFindings.map((row) => row.reason)).toEqual(expect.arrayContaining([
      "人物外觀偏移",
      "左右手持物與上一鏡不一致",
      "畫風陰影偏離目前 Style",
    ]));
    expect(JSON.stringify(summary.topFindings)).not.toMatch(/fingerprint|packet|evaluator/i);
    expect(new Set(labels).size).toBeLessThanOrEqual(6);
  });

  it("dimension filter keeps identity/physics and drops style", async () => {
    const { findings } = await phoneAnimationFindings({
      auth,
      projectId,
      include: ["identity", "look", "temporal", "physics"],
      exclude: ["style"],
    });
    expect(findings.map((row) => row.dimension).sort()).toEqual(["identity", "physics"]);
  });

  it("repair proposal uses the existing planner and does not create generations", async () => {
    const before = await db.select({ id: schema.generations.id }).from(schema.generations)
      .where(eq(schema.generations.projectId, projectId));
    const result = await phoneAnimationRepairProposal({
      auth,
      projectId,
      text: "人物跟連戲先修，畫風不要",
    });
    expect(result.status).toBe("proposal");
    if (result.status !== "proposal") return;
    expect(result.proposal.affectedShotIds).toHaveLength(2);
    expect(result.proposal.dimensions).not.toContain("style");
    expect(result.proposal.untouchedCount).toBe(1);
    expect(result.proposal.notes.some((line) => line.includes("候選"))).toBe(true);
    const after = await db.select({ id: schema.generations.id }).from(schema.generations)
      .where(eq(schema.generations.projectId, projectId));
    expect(after).toHaveLength(before.length);
  });
});
