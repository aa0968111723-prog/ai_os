/**
 * HUD 停 on leftover 0/N awaiting_approval must persist discarded
 * so reload cannot resurrect「待你過目」.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/agentCore.stop.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "./boot";
import type { AuthState } from "./auth";
import { stopAgentCore } from "./agentCore";
import { isAgentRunActiveForHud } from "../../shared/agentQuestions";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "stop", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("stopAgentCore persists leftover 0/N 待你過目 (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[]; groups: string[]; teams: string[] } = {
    users: [], projects: [], groups: [], teams: [],
  };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.agentRuns).where(eq(schema.agentRuns.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const groupId of leftovers.groups) {
      await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
      await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
    for (const teamId of leftovers.teams) {
      await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
    }
  });

  it("stop a 0/6 awaiting_approval run → row status discarded (cancelled) → not HUD-active", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    const teamId = randomUUID();
    leftovers.users.push(userId);
    leftovers.groups.push(groupId);
    leftovers.teams.push(teamId);

    await db.insert(schema.users).values({
      id: userId, name: "Stop", email: `stop-${userId}@t.test`, passwordHash: "x",
    });
    await db.insert(schema.teams).values({ id: teamId, name: "stop-team" });
    await db.insert(schema.groups).values({ id: groupId, teamId, name: "stop-group" });
    await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-test-short-100w-stop",
      kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);

    const steps = [1, 2, 3, 4, 5, 6].map((n) => ({
      kind: "generate",
      status: "pending",
      note: n === 1 ? "第 1 鏡「小華躺在床上」生成畫面" : `第 ${n} 鏡生成畫面`,
      sceneNo: n,
    }));
    const [run] = await db.insert(schema.agentRuns).values({
      projectId: project.id,
      groupId,
      userId,
      goal: "六鏡出圖待過目",
      status: "awaiting_approval",
      steps,
    }).returning({ id: schema.agentRuns.id, status: schema.agentRuns.status });
    expect(run.status).toBe("awaiting_approval");
    expect(isAgentRunActiveForHud(run.status)).toBe(true);

    const stopped = await stopAgentCore({ auth: authFor(userId, groupId), runId: run.id });
    expect(stopped.status).toBe("discarded");

    const [reloaded] = await db
      .select({ status: schema.agentRuns.status, steps: schema.agentRuns.steps })
      .from(schema.agentRuns)
      .where(eq(schema.agentRuns.id, run.id));
    expect(reloaded?.status).toBe("discarded");
    expect(isAgentRunActiveForHud(reloaded!.status)).toBe(false);
    const reloadedSteps = (reloaded?.steps ?? []) as Array<{ status: string }>;
    expect(reloadedSteps.every((step) => step.status === "stopped")).toBe(true);
  });
});
