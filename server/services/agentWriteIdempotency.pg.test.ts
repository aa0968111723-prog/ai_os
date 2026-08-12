import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { runAgentWatchdog } from "./agentWatchdog";
import { addNoteCore } from "./notesCore";
import { addProjectTaskCore } from "./taskCore";
import { upsertContextBinding } from "./contextBindings";
import type { AuthState } from "./auth";

const RUN_PG = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Agent write retry + watchdog (real PostgreSQL)", () => {
  const userId = randomUUID();
  const teamId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const shotId = randomUUID();
  const assetId = randomUUID();
  const noteId = randomUUID();
  const taskId = randomUUID();
  const runId = randomUUID();

  afterAll(async () => {
    await db.delete(schema.contextBindings).where(eq(schema.contextBindings.projectId, projectId));
    await db.delete(schema.notes).where(eq(schema.notes.projectId, projectId));
    await db.delete(schema.projectTasks).where(eq(schema.projectTasks.projectId, projectId));
    await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
    await db.delete(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
    await db.delete(schema.groups).where(eq(schema.groups.id, groupId)).catch(() => undefined);
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId)).catch(() => undefined);
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  function auth(): AuthState {
    return {
      user: { id: userId, name: "qa", email: `retry-${userId}@example.test`, isSuperAdmin: false, mustChangePassword: false },
      groups: [{ groupId, groupName: "retry-group", teamId, teamName: "retry-team", role: "leader" }],
      adminTeamIds: [],
    };
  }

  it("retries do not duplicate notes, tasks, or shot bindings; watchdog never marks done", async () => {
    await db.insert(schema.users).values({
      id: userId, name: "qa", email: `retry-${userId}@example.test`, passwordHash: "x",
    });
    await db.insert(schema.teams).values({ id: teamId, name: "retry-team" }).catch(() => undefined);
    await db.insert(schema.groups).values({ id: groupId, teamId, name: "retry-group" });
    await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "Retry fixture", kind: "qa", platform: "internal", format: "fixture",
    });
    await db.insert(schema.scenes).values({ id: shotId, projectId, orderIndex: 0, title: "Shot 1" });
    await db.insert(schema.assets).values({
      id: assetId, projectId, groupId, kind: "image", title: "Bind me", url: "/tmp/bind.png",
    });
    await db.insert(schema.agentRuns).values({
      id: runId, projectId, groupId, userId, goal: "watchdog", steps: [], estPoints: 0,
      status: "running", updatedAt: new Date(Date.now() - 60 * 60_000),
    });

    const noteInput = {
      auth: auth(),
      id: noteId,
      groupId,
      projectId,
      title: "retry note",
      content: "same step",
      planRunId: runId,
      planStepId: "create_note",
    };
    const notes = await Promise.all([addNoteCore(noteInput), addNoteCore(noteInput)]);
    expect(notes[0]!.id).toBe(noteId);
    expect(notes[1]!.id).toBe(noteId);
    expect(await db.select({ id: schema.notes.id }).from(schema.notes).where(eq(schema.notes.projectId, projectId))).toHaveLength(1);

    const taskInput = {
      auth: auth(),
      id: taskId,
      groupId,
      projectId,
      title: "retry task",
      planRunId: runId,
      planStepId: "create_task",
    };
    const tasks = await Promise.all([addProjectTaskCore(taskInput), addProjectTaskCore(taskInput)]);
    expect(tasks[0]!.id).toBe(taskId);
    expect(tasks[1]!.id).toBe(taskId);
    expect(await db.select({ id: schema.projectTasks.id }).from(schema.projectTasks).where(eq(schema.projectTasks.projectId, projectId))).toHaveLength(1);

    const bind = {
      auth: auth(),
      scope: { projectId, groupId, scopeType: "shot" as const, scopeId: shotId },
      resourceKind: "asset" as const,
      resourceId: assetId,
      role: "PRODUCTION_ASSET" as const,
      confirmedByUser: true,
    };
    await Promise.all([upsertContextBinding(bind), upsertContextBinding(bind)]);
    expect(await db.select({ id: schema.contextBindings.id }).from(schema.contextBindings).where(eq(schema.contextBindings.projectId, projectId))).toHaveLength(1);

    const report = await runAgentWatchdog(1);
    expect(report.completedForbidden).toBe(0);
    const [run] = await db.select({ status: schema.agentRuns.status }).from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    expect(run?.status).toBe("running");
  });
});
