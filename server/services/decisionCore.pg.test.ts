import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { createProjectDecisionCore } from "./decisionCore";
import type { AuthState } from "./auth";

const RUN_PG = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("decision retry (real PostgreSQL)", () => {
  const userId = randomUUID();
  const teamId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();

  afterAll(async () => {
    await db.delete(schema.decisions).where(eq(schema.decisions.projectId, projectId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
    await db.delete(schema.groups).where(eq(schema.groups.id, groupId)).catch(() => undefined);
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId)).catch(() => undefined);
    await db.delete(schema.users).where(eq(schema.users.id, userId));
  });

  function auth(): AuthState {
    return {
      user: { id: userId, name: "qa", email: `decision-${userId}@example.test`, isSuperAdmin: false, mustChangePassword: false },
      groups: [{ groupId, groupName: "decision-group", teamId, teamName: "decision-team", role: "leader" }],
      adminTeamIds: [],
    };
  }

  it("retries the same active decision title instead of inserting a second row", async () => {
    await db.insert(schema.users).values({
      id: userId, name: "qa", email: `decision-${userId}@example.test`, passwordHash: "x",
    });
    await db.insert(schema.teams).values({ id: teamId, name: "decision-team" }).catch(() => undefined);
    await db.insert(schema.groups).values({ id: groupId, teamId, name: "decision-group" });
    await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "Decision fixture", kind: "qa", platform: "internal", format: "fixture",
    });

    const first = await createProjectDecisionCore({ auth: auth(), projectId, title: "角色之後都穿米白外套" });
    const second = await createProjectDecisionCore({ auth: auth(), projectId, title: "角色之後都穿米白外套" });
    expect(second.id).toBe(first.id);
    const rows = await db.select({ id: schema.decisions.id }).from(schema.decisions).where(eq(schema.decisions.projectId, projectId));
    expect(rows).toHaveLength(1);
  });
});
