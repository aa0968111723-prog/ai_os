import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { composeProjectCreativeContext } from "./projectCreativeContext";
import {
  confirmStoryEntityProposal,
  resolveStoryEntityBindings,
  setStoryEntityBindingLock,
} from "./storyEntityBinding";

const RUN_PG = Boolean(process.env.DATABASE_URL);

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "ctx", email: `${userId}@t.local`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "G", teamId: randomUUID(), teamName: "T", role: "leader" }],
    adminTeamIds: [],
  };
}

describe.skipIf(!RUN_PG).sequential("project creative context (real PostgreSQL)", () => {
  const groupA = randomUUID();
  const groupB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const charA = randomUUID();
  const charA2 = randomUUID();
  const charB = randomUUID();

  beforeAll(async () => {
    await db.insert(schema.users).values([
      { id: userA, name: "A", email: `a-${userA}@t.local`, passwordHash: "x" },
      { id: userB, name: "B", email: `b-${userB}@t.local`, passwordHash: "x" },
    ]);
    await db.insert(schema.projects).values([
      { id: projectA, groupId: groupA, ownerId: userA, title: "專案A", kind: "video", platform: "youtube", format: "16:9" },
      { id: projectB, groupId: groupB, ownerId: userB, title: "專案B", kind: "video", platform: "youtube", format: "16:9" },
    ]);
    await db.insert(schema.stories).values([
      { projectId: projectA, groupId: groupA, content: "安倢撐著紅傘跟上師父。另一個安倢站在門口。", rev: 1 },
      { projectId: projectB, groupId: groupB, content: "外人角色不該被 A 讀到。", rev: 1 },
    ]);
    await db.insert(schema.characters).values([
      { id: charA, projectId: projectA, groupId: groupA, name: "安倢", appearance: "米白外套", createdBy: userA },
      { id: charA2, projectId: projectA, groupId: groupA, name: "安倢", appearance: "另一套", notes: "又名安姐", createdBy: userA },
      { id: charB, projectId: projectB, groupId: groupB, name: "外人", appearance: "不該外洩", createdBy: userB },
    ]);
    await db.insert(schema.props).values({
      projectId: projectA, groupId: groupA, name: "紅傘", appearance: "朱紅油紙傘", createdBy: userA,
    });
  });

  afterAll(async () => {
    await db.delete(schema.storyEntityBindingProposals).where(eq(schema.storyEntityBindingProposals.projectId, projectA));
    await db.delete(schema.storyEntityBindings).where(eq(schema.storyEntityBindings.projectId, projectA));
    await db.delete(schema.characters).where(eq(schema.characters.projectId, projectA));
    await db.delete(schema.characters).where(eq(schema.characters.projectId, projectB));
    await db.delete(schema.props).where(eq(schema.props.projectId, projectA));
    await db.delete(schema.stories).where(eq(schema.stories.projectId, projectA));
    await db.delete(schema.stories).where(eq(schema.stories.projectId, projectB));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectA));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectB));
    await db.delete(schema.users).where(eq(schema.users.id, userA));
    await db.delete(schema.users).where(eq(schema.users.id, userB));
  });

  it("composes only project A canonical records", async () => {
    const ctx = await composeProjectCreativeContext({ auth: authFor(userA, groupA), projectId: projectA });
    expect(ctx.characters.map((c) => c.id).sort()).toEqual([charA, charA2].sort());
    expect(ctx.characters.some((c) => c.id === charB)).toBe(false);
    expect(ctx.props.some((p) => p.title === "紅傘")).toBe(true);
    expect(ctx.provider.paidCallsAuthorized).toBe(false);
    expect(ctx.characters[0]?.provenance.whySelected).toBeTruthy();
  });

  it("does not let project A retrieve project B", async () => {
    await expect(composeProjectCreativeContext({
      auth: authFor(userA, groupA),
      projectId: projectB,
    })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates a proposal for ambiguous names and does not overwrite a lock", async () => {
    const first = await resolveStoryEntityBindings({
      auth: authFor(userA, groupA),
      projectId: projectA,
      persist: true,
    });
    expect(first.proposed).toBeGreaterThan(0);
    const proposal = first.proposals.find((row) => row.mentionKey.includes("安倢") || row.mentionText === "安倢");
    expect(proposal).toBeTruthy();
    const confirmed = await confirmStoryEntityProposal({
      auth: authFor(userA, groupA),
      proposalId: proposal!.id,
      entityId: charA,
      lock: true,
    });
    expect(confirmed.binding.locked).toBe(true);
    expect(confirmed.binding.entityId).toBe(charA);
    expect(confirmed.proposal.status).toBe("applied");

    await setStoryEntityBindingLock({
      auth: authFor(userA, groupA),
      bindingId: confirmed.binding.id,
      locked: true,
    });

    const again = await resolveStoryEntityBindings({
      auth: authFor(userA, groupA),
      projectId: projectA,
      persist: true,
    });
    const still = again.bindings.find((row) => row.id === confirmed.binding.id);
    expect(still?.entityId).toBe(charA);
    expect(still?.locked).toBe(true);
    expect(again.lockedPreserved).toBeGreaterThan(0);
  });

  it("does not write a foreign entity id into a project binding", async () => {
    const pending = await db.select().from(schema.storyEntityBindingProposals).where(and(
      eq(schema.storyEntityBindingProposals.projectId, projectA),
      eq(schema.storyEntityBindingProposals.status, "pending"),
    ));
    if (pending[0]) {
      await expect(confirmStoryEntityProposal({
        auth: authFor(userA, groupA),
        proposalId: pending[0].id,
        entityId: charB,
      })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});
