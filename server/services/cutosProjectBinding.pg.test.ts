import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import {
  CutosBindingError,
  bindCutosProject,
  findBinding,
  listGroupBindings,
  rememberTimelineRevision,
  resolveCutosProject,
  unbindCutosProject,
} from "./cutosProjectBinding";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

/**
 * The binding is the authorization boundary of the whole integration, so it is
 * tested against real PostgreSQL: the uniqueness guarantees that stop an agent
 * widening its own scope are database constraints, not application checks.
 */
describe.skipIf(!RUN_PG).sequential("CUTOS project binding (real PostgreSQL)", () => {
  const teamId = randomUUID();
  const groupA = randomUUID();
  const groupB = randomUUID();
  const memberId = randomUUID();
  const outsiderId = randomUUID();
  const projectA = randomUUID();
  const projectA2 = randomUUID();
  const projectB = randomUUID();

  beforeAll(async () => {
    await db.insert(schema.teams).values({ id: teamId, name: `t-${teamId.slice(0, 8)}` });
    await db.insert(schema.groups).values([
      { id: groupA, teamId, name: `ga-${groupA.slice(0, 8)}` },
      { id: groupB, teamId, name: `gb-${groupB.slice(0, 8)}` },
    ]);
    await db.insert(schema.users).values([
      { id: memberId, name: "member", email: `m-${memberId}@t.local`, passwordHash: "x", status: "active" },
      { id: outsiderId, name: "outsider", email: `o-${outsiderId}@t.local`, passwordHash: "x", status: "active" },
    ]);
    // The member belongs to group A only. The outsider belongs to group B.
    await db.insert(schema.groupMembers).values([
      { groupId: groupA, userId: memberId, role: "member" },
      { groupId: groupB, userId: outsiderId, role: "member" },
    ]);
    const project = (id: string, groupId: string, ownerId: string) => ({
      id,
      groupId,
      ownerId,
      title: `p-${id.slice(0, 8)}`,
      kind: "video",
      platform: "web",
      format: "landscape",
    });
    await db.insert(schema.projects).values([
      project(projectA, groupA, memberId),
      project(projectA2, groupA, memberId),
      project(projectB, groupB, outsiderId),
    ]);
  });

  afterAll(async () => {
    await db.delete(schema.aiosCutosProjectBindings)
      .where(inArray(schema.aiosCutosProjectBindings.aiosProjectId, [projectA, projectA2, projectB]));
    await db.delete(schema.projects)
      .where(inArray(schema.projects.id, [projectA, projectA2, projectB]));
    await db.delete(schema.groupMembers).where(inArray(schema.groupMembers.groupId, [groupA, groupB]));
    await db.delete(schema.users).where(inArray(schema.users.id, [memberId, outsiderId]));
    await db.delete(schema.groups).where(inArray(schema.groups.id, [groupA, groupB]));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  const bind = (aiosProjectId: string, cutosProjectId: string, userId = memberId) =>
    bindCutosProject({ userId, aiosProjectId, cutosProjectId, verify: false });

  it("persists a binding that survives a fresh read", async () => {
    const binding = await bind(projectA, "cutos-alpha");
    expect(binding.cutosProjectId).toBe("cutos-alpha");
    // Read back through a separate query: this is durable state, not a Map.
    const found = await findBinding(projectA);
    expect(found?.cutosProjectId).toBe("cutos-alpha");
    expect(found?.groupId).toBe(groupA);
  });

  it("resolves the CUTOS project from the run's own scope", async () => {
    const resolved = await resolveCutosProject({
      userId: memberId,
      groupId: groupA,
      projectId: projectA,
    });
    expect(resolved.cutosProjectId).toBe("cutos-alpha");
  });

  it("refuses a caller who is not in the project's group", async () => {
    await expect(
      resolveCutosProject({ userId: outsiderId, groupId: groupA, projectId: projectA }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a mismatched group even for a real member", async () => {
    // A forged or stale context that names the wrong group must not resolve.
    await expect(
      resolveCutosProject({ userId: memberId, groupId: groupB, projectId: projectA }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses an unbound project rather than guessing one", async () => {
    await expect(
      resolveCutosProject({ userId: memberId, groupId: groupA, projectId: projectA2 }),
    ).rejects.toMatchObject({ code: "BINDING_NOT_FOUND" });
  });

  it("refuses to bind a CUTOS project that another AIOS project already owns", async () => {
    const error = await bind(projectA2, "cutos-alpha").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CutosBindingError);
    expect((error as CutosBindingError).code).toBe("ALREADY_BOUND");
  });

  it("keeps one CUTOS project per AIOS project when re-pointed", async () => {
    await bind(projectA, "cutos-beta");
    const found = await findBinding(projectA);
    expect(found?.cutosProjectId).toBe("cutos-beta");
    const rows = await db
      .select()
      .from(schema.aiosCutosProjectBindings)
      .where(eq(schema.aiosCutosProjectBindings.aiosProjectId, projectA));
    // Re-pointing updates in place; it must not leave a second live row.
    expect(rows).toHaveLength(1);
    await bind(projectA, "cutos-alpha");
  });

  it("refuses to bind a project the caller cannot access", async () => {
    await expect(bind(projectB, "cutos-gamma", memberId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses to bind a project that does not exist", async () => {
    await expect(bind(randomUUID(), "cutos-nowhere")).rejects.toMatchObject({
      code: "PROJECT_NOT_FOUND",
    });
  });

  it("remembers the last observed timeline revision for the next mutation guard", async () => {
    await rememberTimelineRevision(projectA, 12);
    const found = await findBinding(projectA);
    expect(found?.lastTimelineRevision).toBe(12);
  });

  it("lists only the bindings of one group", async () => {
    const groupABindings = await listGroupBindings(groupA);
    expect(groupABindings.map((b) => b.aiosProjectId)).toContain(projectA);
    const groupBBindings = await listGroupBindings(groupB);
    expect(groupBBindings.map((b) => b.aiosProjectId)).not.toContain(projectA);
  });

  it("unbinds and then refuses to resolve", async () => {
    await unbindCutosProject({ userId: memberId, aiosProjectId: projectA });
    expect(await findBinding(projectA)).toBeNull();
    await expect(
      resolveCutosProject({ userId: memberId, groupId: groupA, projectId: projectA }),
    ).rejects.toMatchObject({ code: "BINDING_NOT_FOUND" });
    await bind(projectA, "cutos-alpha");
  });

  it("refuses a user whose account has been deactivated", async () => {
    await db.update(schema.users).set({ status: "disabled" }).where(eq(schema.users.id, memberId));
    try {
      await expect(
        resolveCutosProject({ userId: memberId, groupId: groupA, projectId: projectA }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await db.update(schema.users).set({ status: "active" }).where(eq(schema.users.id, memberId));
    }
  });

  it("refuses immediately after the user is removed from the group", async () => {
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.userId, memberId));
    try {
      // Access is re-derived on every call, so removal takes effect at once.
      await expect(
        resolveCutosProject({ userId: memberId, groupId: groupA, projectId: projectA }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    } finally {
      await db.insert(schema.groupMembers).values({ groupId: groupA, userId: memberId, role: "member" });
    }
  });
});
