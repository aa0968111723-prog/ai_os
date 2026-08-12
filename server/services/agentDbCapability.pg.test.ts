import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { attachAssetsToShotVerified } from "./assistantAssetBinding";
import type { AuthState } from "./auth";

const RUN_PG = Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("Agent DB capability matrix (real PostgreSQL)", () => {
  const userId = randomUUID();
  const teamId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const shotIds = [randomUUID(), randomUUID(), randomUUID()];
  const assetIds = Array.from({ length: 5 }, () => randomUUID());

  afterAll(async () => {
    await db.delete(schema.contextBindings).where(eq(schema.contextBindings.projectId, projectId));
    await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
    await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
    await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId)).catch(() => undefined);
  });

  function auth(): AuthState {
    return {
      user: { id: userId, name: "qa", email: `cap-${userId}@example.test`, isSuperAdmin: false, mustChangePassword: false },
      groups: [{ groupId, groupName: "cap-group", teamId: randomUUID(), teamName: "cap-team", role: "leader" }],
      adminTeamIds: [],
    };
  }

  it("binds recent 5 assets to shot 3 and read-back matches", async () => {
    await db.insert(schema.users).values({
      id: userId, name: "qa", email: `cap-${userId}@example.test`, passwordHash: "x",
    });
    await db.insert(schema.teams).values({ id: teamId, name: "cap-team" });
    await db.insert(schema.groups).values({ id: groupId, teamId, name: "cap-group" });
    await db.insert(schema.groupMembers).values({ groupId, userId, role: "leader" });
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId, title: "Capability fixture", kind: "qa", platform: "internal", format: "fixture",
    });
    await db.insert(schema.scenes).values(shotIds.map((id, index) => ({
      id, projectId, orderIndex: index, title: `Shot ${index + 1}`,
    })));
    await db.insert(schema.assets).values(assetIds.map((id, index) => ({
      id, projectId, groupId, kind: "image", title: `Asset ${index + 1}`, url: `/tmp/asset-${index + 1}.png`,
    })));

    const recent = await db
      .select({ id: schema.assets.id })
      .from(schema.assets)
      .where(and(eq(schema.assets.projectId, projectId), eq(schema.assets.kind, "image")))
      .orderBy(schema.assets.createdAt);
    expect(recent).toHaveLength(5);

    const shot3 = shotIds[2]!;
    const result = await attachAssetsToShotVerified({
      auth: auth(),
      projectId,
      shotId: shot3,
      assetIds: recent.map((row) => row.id),
    });
    expect(result.verification.status).toBe("verified");

    const readBack = await db.select({ resourceId: schema.contextBindings.resourceId }).from(schema.contextBindings).where(and(
      eq(schema.contextBindings.projectId, projectId),
      eq(schema.contextBindings.scopeType, "shot"),
      eq(schema.contextBindings.scopeId, shot3),
      eq(schema.contextBindings.resourceKind, "asset"),
    ));
    expect(readBack.map((row) => row.resourceId).sort()).toEqual([...assetIds].sort());
    expect(readBack).toHaveLength(5);

    const foreignProject = randomUUID();
    await db.insert(schema.projects).values({
      id: foreignProject, groupId: randomUUID(), ownerId: userId, title: "Other tenant", kind: "qa", platform: "internal", format: "fixture",
    });
    await expect(attachAssetsToShotVerified({
      auth: auth(),
      projectId: foreignProject,
      shotId: shot3,
      assetIds,
    })).rejects.toThrow();
    await db.delete(schema.projects).where(eq(schema.projects.id, foreignProject));
  });

  it("source-truth: empty custom table is not an empty project asset library", async () => {
    const tableId = randomUUID();
    await db.insert(schema.dataTables).values({
      id: tableId, scope: "group", groupId, name: "empty-custom", fields: [], agentAccess: "read", createdBy: userId,
    });
    const [table] = await db.select({ id: schema.dataTables.id }).from(schema.dataTables).where(eq(schema.dataTables.id, tableId));
    const assetCount = await db.select({ id: schema.assets.id }).from(schema.assets).where(and(
      eq(schema.assets.projectId, projectId),
      inArray(schema.assets.id, assetIds),
    ));
    const rowCount = await db.select({ id: schema.dataRows.id }).from(schema.dataRows).where(eq(schema.dataRows.tableId, tableId));
    expect(table).toBeTruthy();
    expect(assetCount).toHaveLength(5);
    expect(rowCount).toHaveLength(0);
    await db.delete(schema.dataTables).where(eq(schema.dataTables.id, tableId));
  });
});
