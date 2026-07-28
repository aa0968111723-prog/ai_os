import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import {
  completeProjectTaskCore,
  decideProjectApprovalCore,
} from "./taskCore";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("human task wake-up (real PostgreSQL)", () => {
  const actorId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const runIds: string[] = [];
  const taskIds: string[] = [];
  const auth: AuthState = {
    user: {
      id: actorId,
      name: "Human task test",
      email: "human-task@example.test",
      isSuperAdmin: false,
      mustChangePassword: false,
    },
    groups: [{
      groupId,
      groupName: "Task group",
      teamId: randomUUID(),
      teamName: "Task team",
      role: "leader",
    }],
    adminTeamIds: [],
  };

  afterAll(async () => {
    if (taskIds.length) await db.delete(schema.projectTasks).where(inArray(schema.projectTasks.id, taskIds));
    if (runIds.length) await db.delete(schema.agentRuns).where(inArray(schema.agentRuns.id, runIds));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });

  async function ensureProject(): Promise<void> {
    const [existing] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (existing) return;
    await db.insert(schema.projects).values({
      id: projectId,
      groupId,
      ownerId: actorId,
      title: "Human task wake-up",
      kind: "campaign",
      platform: "test",
      format: "plan",
      worldview: {},
    });
  }

  it("atomically completes a task and resumes the exact waiting step once", async () => {
    await ensureProject();
    const runId = randomUUID();
    const taskId = randomUUID();
    runIds.push(runId);
    taskIds.push(taskId);
    await db.insert(schema.agentRuns).values({
      id: runId,
      projectId,
      groupId,
      userId: actorId,
      goal: "等待人員完成後繼續",
      status: "waiting",
      currentStep: 0,
      steps: [{
        id: "wait-confirmation",
        kind: "wait_for_human",
        note: "等待確認",
        status: "waiting",
        taskId,
      }],
    });
    await db.insert(schema.projectTasks).values({
      id: taskId,
      groupId,
      projectId,
      planRunId: runId,
      planStepId: "create-confirmation",
      wakeRunId: runId,
      wakeStepId: "wait-confirmation",
      title: "確認名單",
      assigneeId: actorId,
      createdBy: actorId,
    });

    const replies = await Promise.all([
      completeProjectTaskCore(auth, taskId),
      completeProjectTaskCore(auth, taskId),
    ]);
    expect(replies.every((task) => task.status === "done")).toBe(true);
    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    expect(run.status).toBe("done");
    expect(run.currentStep).toBe(1);
    expect((run.steps as Array<{ status: string }>)[0].status).toBe("done");
  });

  it("rejecting approval fails closed and stops later steps", async () => {
    await ensureProject();
    const runId = randomUUID();
    const taskId = randomUUID();
    runIds.push(runId);
    taskIds.push(taskId);
    await db.insert(schema.agentRuns).values({
      id: runId,
      projectId,
      groupId,
      userId: actorId,
      goal: "核准後才執行",
      status: "waiting",
      currentStep: 0,
      steps: [
        {
          id: "approve-visual",
          kind: "request_approval",
          note: "核准主視覺",
          status: "waiting",
          taskId,
        },
        {
          id: "publish-next",
          kind: "create_note",
          note: "整理交付",
          status: "pending",
        },
      ],
    });
    await db.insert(schema.projectTasks).values({
      id: taskId,
      groupId,
      projectId,
      planRunId: runId,
      planStepId: "approve-visual",
      wakeRunId: runId,
      wakeStepId: "approve-visual",
      taskType: "approval",
      approverRole: "group_leader",
      status: "review",
      title: "核准主視覺",
      createdBy: actorId,
    });

    await decideProjectApprovalCore(auth, taskId, "reject");
    const [run] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, runId));
    const steps = run.steps as Array<{ status: string }>;
    expect(run.status).toBe("failed");
    expect(steps[0].status).toBe("failed");
    expect(steps[1].status).toBe("stopped");
  });
});
