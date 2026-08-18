/**
 * Same-group same-display-name isolation + reference-image project scope (real PostgreSQL).
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/dataIntegrity.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "./boot";
import type { AuthState } from "./auth";
import { charactersRouter } from "../routers/characters";
import { storyRouter } from "../routers/story";
import { assertReferenceImage } from "./referenceAsset";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
if (RUN_PG) markBootReady();

describe.skipIf(!RUN_PG).sequential("data integrity: same-name projects stay isolated", () => {
  const leftovers: { users: string[]; projects: string[]; assets: string[] } = {
    users: [],
    projects: [],
    assets: [],
  };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
      await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  async function seedPair() {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "integrity", email: `integrity-${userId}@t.test`, passwordHash: "x",
    });
    const [projectA] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "小華", kind: "animation", platform: "test", format: "9:16",
    }).returning();
    const [projectB] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "小華", kind: "animation", platform: "test", format: "9:16",
    }).returning();
    leftovers.projects.push(projectA.id, projectB.id);
    const auth: AuthState = {
      user: { id: userId, name: "integrity", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
      groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
      adminTeamIds: [],
    };
    const ctx = { auth };
    return {
      userId,
      groupId,
      projectA,
      projectB,
      characters: charactersRouter.createCaller(ctx as never),
      story: storyRouter.createCaller(ctx as never),
    };
  }

  it("two projects named 小華 in the same group do not share story or characters", async () => {
    const { projectA, projectB, story, characters, userId, groupId } = await seedPair();
    await story.save({ projectId: projectA.id, content: "這是專案A小華的故事" });
    await story.save({ projectId: projectB.id, content: "這是專案B小華的故事" });
    const [huaA] = await db.insert(schema.characters).values({
      projectId: projectA.id, groupId, name: "小華", appearance: "粉橘短髮、專案A", createdBy: userId,
    }).returning();
    const [huaB] = await db.insert(schema.characters).values({
      projectId: projectB.id, groupId, name: "小華", appearance: "藍外套、專案B", createdBy: userId,
    }).returning();

    const gotA = await story.get({ projectId: projectA.id });
    const gotB = await story.get({ projectId: projectB.id });
    expect(gotA.story?.content).toBe("這是專案A小華的故事");
    expect(gotB.story?.content).toBe("這是專案B小華的故事");
    expect(gotA.story?.id).not.toBe(gotB.story?.id);

    const listA = await characters.list({ projectId: projectA.id });
    const listB = await characters.list({ projectId: projectB.id });
    expect(listA.map((row) => row.id)).toEqual([huaA.id]);
    expect(listB.map((row) => row.id)).toEqual([huaB.id]);
    expect(listA[0]?.appearance).toContain("專案A");
    expect(listB[0]?.appearance).toContain("專案B");
  });

  it("assertReferenceImage rejects a same-group 小華-B image bound onto 小華-A", async () => {
    const { projectA, projectB, characters, groupId } = await seedPair();
    const [assetB] = await db.insert(schema.assets).values({
      projectId: projectB.id,
      groupId,
      kind: "image",
      title: "小華-B 定裝",
      url: "https://example.test/xiaohua-b.jpg",
    }).returning();
    leftovers.assets.push(assetB.id);

    await expect(assertReferenceImage(assetB.id, groupId, projectA.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    await expect(characters.add({
      projectId: projectA.id,
      name: "小華",
      appearance: "想偷綁專案B的圖",
      referenceAssetId: assetB.id,
    })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const [assetA] = await db.insert(schema.assets).values({
      projectId: projectA.id,
      groupId,
      kind: "image",
      title: "小華-A 定裝",
      url: "https://example.test/xiaohua-a.jpg",
    }).returning();
    leftovers.assets.push(assetA.id);
    const ok = await characters.add({
      projectId: projectA.id,
      name: "小華",
      appearance: "本專案定裝圖",
      referenceAssetId: assetA.id,
    });
    expect(ok.referenceAssetId).toBe(assetA.id);
    expect(ok.projectId).toBe(projectA.id);
  });
});
