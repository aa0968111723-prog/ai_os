import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { listProjectAgentEvents, recordAgentEvent } from "./agentEventCore";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("agent event trace (real PostgreSQL)", () => {
  const runId = randomUUID();
  const actorId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const auth: AuthState = {
    user: {
      id: actorId,
      name: "Event test",
      email: "event-test@example.test",
      isSuperAdmin: false,
      mustChangePassword: false, uiDensity: null,
    },
    groups: [{
      groupId,
      groupName: "Event group",
      teamId: randomUUID(),
      teamName: "Event team",
      role: "leader",
    }],
    adminTeamIds: [],
  };

  afterAll(async () => {
    await db.delete(schema.agentEvents).where(eq(schema.agentEvents.runId, runId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });

  it("deduplicates the same lifecycle event across concurrent replicas", async () => {
    const input = {
      runId,
      groupId,
      projectId,
      eventKey: "step:research:completed",
      eventType: "step_completed" as const,
      stepId: "research",
      stepIndex: 0,
      actorType: "ai" as const,
      summary: "完成：整理研究筆記",
      data: { outputRefs: [{ type: "note", id: randomUUID() }] },
    };
    await Promise.all([
      recordAgentEvent(input),
      recordAgentEvent(input),
      recordAgentEvent(input),
    ]);

    const rows = await db.select().from(schema.agentEvents).where(eq(schema.agentEvents.runId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventKey: input.eventKey,
      eventType: "step_completed",
      stepId: "research",
      summary: input.summary,
    });
  });

  it("paginates equal-time events with a stable time+UUID cursor", async () => {
    await db.insert(schema.projects).values({
      id: projectId,
      groupId,
      ownerId: actorId,
      title: "Event pagination",
      kind: "campaign",
      platform: "test",
      format: "plan",
      worldview: {},
    });
    await recordAgentEvent({
      runId,
      groupId,
      projectId,
      eventKey: "run:approved",
      eventType: "approved",
      actorType: "human",
      actorId,
      summary: "已核准",
    });
    await recordAgentEvent({
      runId,
      groupId,
      projectId,
      eventKey: "run:done",
      eventType: "run_completed",
      summary: "已完成",
    });

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 3; pageNo += 1) {
      const page = await listProjectAgentEvents(auth, projectId, { cursor, limit: 1 });
      expect(page.items).toHaveLength(1);
      expect(seen.has(page.items[0].id)).toBe(false);
      seen.add(page.items[0].id);
      cursor = page.nextCursor ?? undefined;
    }
    expect(seen.size).toBe(3);
  });
});
