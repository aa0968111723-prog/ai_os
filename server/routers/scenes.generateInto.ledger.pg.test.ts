/**
 * One generateInto debit === version.points === 週/日 meter (and leftover 6-step
 * plan must not add extra ledger rows).
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/scenes.generateInto.ledger.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { reserveQuota, usedByMember, usedThisWeek, usedToday } from "../services/points";
import { reconcileAgentRunsAfterSceneGenerate } from "../services/agentRunReconcile";
import { storeGenerationSourceMeta } from "../../shared/generationSourceMeta";
import { quotaRouter } from "./quota";
import { scenesRouter } from "./scenes";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

const QWEN = "fal-ai/qwen-image-2/text-to-image";

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "ledger", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("generateInto debit matches version.points and 週/日 meter (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[]; groups: string[]; teams: string[] } = {
    users: [], projects: [], groups: [], teams: [],
  };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.agentRuns).where(eq(schema.agentRuns.projectId, projectId));
      await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
      const gens = await db.select({ id: schema.generations.id }).from(schema.generations).where(eq(schema.generations.projectId, projectId));
      for (const g of gens) {
        await db.delete(schema.costLedger).where(eq(schema.costLedger.generationId, g.id));
      }
      await db.delete(schema.generations).where(eq(schema.generations.projectId, projectId));
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const groupId of leftovers.groups) {
      await db.delete(schema.costLedger).where(eq(schema.costLedger.groupId, groupId));
      await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
      await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.costLedger).where(eq(schema.costLedger.userId, userId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    for (const teamId of leftovers.teams) {
      await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
    }
  });

  it("one reserved generateInto decrements wallet by the same amount versions and 週/日 record", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    const teamId = randomUUID();
    leftovers.users.push(userId);
    leftovers.groups.push(groupId);
    leftovers.teams.push(teamId);

    await db.insert(schema.users).values({
      id: userId, name: "Ledger", email: `ledger-${userId}@t.test`, passwordHash: "x",
    });
    await db.insert(schema.teams).values({ id: teamId, name: "ledger-team" });
    await db.insert(schema.groups).values({ id: groupId, teamId, name: "ledger-group" });
    await db.insert(schema.groupMembers).values({
      groupId, userId, role: "leader", budgetPoints: 500,
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-ledger", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    const [scene] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "鏡1", prompt: "禪堂晨光",
    }).returning();

    const leftoverSteps = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "generate",
      status: "pending",
      note: `第 ${n} 鏡生成畫面`,
      sceneNo: n,
    }));
    await db.insert(schema.agentRuns).values({
      projectId: project.id,
      groupId,
      userId,
      goal: "六鏡出圖",
      status: "running",
      steps: leftoverSteps,
    });

    const weekBefore = await usedThisWeek(userId, groupId);
    const dayBefore = await usedToday(userId);
    const memberBefore = await usedByMember(userId, groupId);

    const genId = randomUUID();
    const assetId = randomUUID();
    const points = 1;
    await db.insert(schema.generations).values({
      id: genId,
      projectId: project.id,
      groupId,
      userId,
      modelId: QWEN,
      kind: "image",
      prompt: "禪堂晨光",
      sceneId: scene.id,
      sceneRole: "visual",
      status: "done",
      resultUrl: `/api/assets/${assetId}/file`,
      pointsEst: points,
      pointsActual: points,
      params: storeGenerationSourceMeta({ prompt: "禪堂晨光" }, { preserveScenePointer: true }),
    });
    await db.insert(schema.assets).values({
      id: assetId,
      projectId: project.id,
      groupId,
      kind: "image",
      title: "候選",
      url: `/api/assets/${assetId}/file`,
      isAiGenerated: true,
      meta: { generationId: genId, modelId: QWEN },
    });
    const quotaErr = await reserveQuota(userId, groupId, points, `分鏡生成 Qwen Image 2.0`, genId);
    expect(quotaErr).toBeNull();

    await reconcileAgentRunsAfterSceneGenerate({
      projectId: project.id,
      sceneId: scene.id,
      generationId: genId,
    });

    const ctx = { auth: authFor(userId, groupId) };
    const scenesApi = scenesRouter.createCaller(ctx as never);
    const quotaApi = quotaRouter.createCaller(ctx as never);
    const versions = await scenesApi.versions({ sceneId: scene.id });
    const visual = versions.versions.filter((v) => v.role === "visual");
    expect(visual).toHaveLength(1);
    expect(visual[0]?.points).toBe(points);

    const weekAfter = await usedThisWeek(userId, groupId);
    const dayAfter = await usedToday(userId);
    const memberAfter = await usedByMember(userId, groupId);
    expect(weekAfter - weekBefore).toBe(points);
    expect(dayAfter - dayBefore).toBe(points);
    expect(memberAfter - memberBefore).toBe(points);

    const my = await quotaApi.my({ groupId });
    expect(my.weeklyUsed).toBe(weekAfter);
    expect(my.dailyUsed).toBe(dayAfter);
    expect(my.memberBudgetRemaining).toBe(500 - memberAfter);

    const ledger = await db.select().from(schema.costLedger).where(eq(schema.costLedger.userId, userId));
    const net = ledger.reduce((s, row) => s + row.delta, 0);
    expect(-net).toBe(points);

    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.projectId, project.id));
    const steps = (run?.steps ?? []) as Array<{ status: string; generationId?: string; sceneNo?: number }>;
    expect(steps[0]?.generationId).toBe(genId);
    expect(steps[0]?.status).toBe("waiting");
    expect(steps.slice(1).every((s) => s.status === "waiting" && !s.generationId)).toBe(true);
  });
});
