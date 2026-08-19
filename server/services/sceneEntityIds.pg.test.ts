/**
 * JSONB scene refs have no FK. Removing a card / copying a dirty shot must not
 * persist dangling ids.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/sceneEntityIds.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "./boot";
import type { AuthState } from "./auth";
import { scenesRouter } from "../routers/scenes";
import { charactersRouter } from "../routers/characters";
import { scenePresetsRouter } from "../routers/scenePresets";
import { propsRouter } from "../routers/props";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "jsonb", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

describe.skipIf(!RUN_PG).sequential("JSONB scene ids fail-closed (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.characterLooks).where(eq(schema.characterLooks.projectId, projectId));
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
      await db.delete(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId));
      await db.delete(schema.props).where(eq(schema.props.projectId, projectId));
      await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  async function seed(title: string) {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "Jsonb", email: `jsonb-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title, kind: "animation", platform: "test", format: "9:16",
    }).returning();
    leftovers.projects.push(project.id);
    const ctx = { auth: authFor(userId, groupId) };
    return {
      project,
      userId,
      groupId,
      scenes: scenesRouter.createCaller(ctx as never),
      characters: charactersRouter.createCaller(ctx as never),
      presets: scenePresetsRouter.createCaller(ctx as never),
      props: propsRouter.createCaller(ctx as never),
    };
  }

  it("setCards refuses a missing character id and does not persist it", async () => {
    const { project, scenes } = await seed("缺卡");
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "A",
    }).returning();
    const gone = randomUUID();
    await expect(scenes.setCards({ sceneId: shot.id, characterIds: [gone] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.id));
    expect(fresh.characterIds).toBeNull();
  });

  it("duplicate copies living ids only — gone character and recycled asset drop", async () => {
    const { project, userId, groupId, scenes } = await seed("幽靈複製");
    const [live] = await db.insert(schema.characters).values({
      projectId: project.id, groupId, name: "小華", appearance: "粉橘短髮女孩、白帽T", createdBy: userId,
    }).returning();
    const gone = randomUUID();
    const assetId = randomUUID();
    await db.insert(schema.assets).values({
      id: assetId,
      projectId: project.id,
      groupId,
      kind: "image",
      title: "回收桶畫面",
      url: `/api/assets/${assetId}/file`,
      deletedAt: new Date(),
    });
    const [source] = await db.insert(schema.scenes).values({
      projectId: project.id,
      orderIndex: 1,
      title: "B 夕陽",
      characterIds: [live.id, gone],
      assetId,
    }).returning();

    const dup = await scenes.insertAfter({ sceneId: source.id, duplicate: true });
    expect(dup.characterIds).toEqual([live.id]);
    expect(dup.characterIds).not.toContain(gone);
    expect(dup.assetId).toBeNull();
  });

  it("characters.remove strips the id from every scene and does not leave look ghosts", async () => {
    const { project, userId, groupId, scenes, characters } = await seed("刪卡清綁");
    const [hua] = await db.insert(schema.characters).values({
      projectId: project.id, groupId, name: "小華", appearance: "白帽T", createdBy: userId,
    }).returning();
    const [look] = await db.insert(schema.characterLooks).values({
      projectId: project.id, groupId, characterId: hua.id, name: "日常", costume: "白帽T", createdBy: userId,
    }).returning();
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "A",
      characterIds: [hua.id], lookIds: [look.id],
    }).returning();

    await characters.remove({ id: hua.id });
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.id));
    expect(fresh.characterIds).toBeNull();
    expect(fresh.lookIds).toBeNull();
    const leftoverLooks = await db.select().from(schema.characterLooks).where(eq(schema.characterLooks.characterId, hua.id));
    expect(leftoverLooks).toEqual([]);
    await expect(scenes.setCards({ sceneId: shot.id, characterIds: [hua.id] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("scenePresets.remove and props.remove strip their JSONB ids", async () => {
    const { project, userId, groupId, presets, props } = await seed("場景道具");
    const [preset] = await db.insert(schema.scenePresets).values({
      projectId: project.id, groupId, name: "校門口", palette: "暖色", createdBy: userId,
    }).returning();
    const [prop] = await db.insert(schema.props).values({
      projectId: project.id, groupId, name: "書包", appearance: "帆布", createdBy: userId,
    }).returning();
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "A",
      scenePresetIds: [preset.id], propIds: [prop.id],
    }).returning();

    await presets.remove({ id: preset.id });
    await props.remove({ id: prop.id });
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.id));
    expect(fresh.scenePresetIds).toBeNull();
    expect(fresh.propIds).toBeNull();
  });
});
