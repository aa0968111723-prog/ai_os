/**
 * Animation look / isolation / assistant-write regressions (real PostgreSQL).
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/scenes.animationLooks.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { scenesRouter } from "./scenes";
import { assistantRouter } from "./assistant";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "anim", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("animation look reconcile + isolation (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.characterLooks).where(eq(schema.characterLooks.projectId, projectId));
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
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
      id: userId, name: "Anim", email: `anim-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title, kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    const ctx = { auth: authFor(userId, groupId) };
    return { project, userId, groupId, ctx, scenes: scenesRouter.createCaller(ctx as never) };
  }

  it("removing a character without lookIds strips that character's costume", async () => {
    const { project, userId, groupId, scenes } = await seed("孤兒造型");
    const [lian] = await db.insert(schema.characters).values({
      projectId: project.id, groupId, name: "小蓮", appearance: "圓臉齊瀏海", createdBy: userId,
    }).returning();
    const [afu] = await db.insert(schema.characters).values({
      projectId: project.id, groupId, name: "阿福", appearance: "橘白胖貓", createdBy: userId,
    }).returning();
    const [look] = await db.insert(schema.characterLooks).values({
      projectId: project.id, groupId, characterId: lian.id, name: "日常", costume: "藍色布棉襖", createdBy: userId,
    }).returning();
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "鏡1",
      characterIds: [lian.id, afu.id], lookIds: [look.id],
    }).returning();

    const updated = await scenes.setCards({ sceneId: shot.id, characterIds: [afu.id] });
    expect(updated.characterIds).toEqual([afu.id]);
    expect(updated.lookIds).toBeNull();
  });

  it("duplicate copies look, camera, and performance", async () => {
    const { project, userId, groupId, scenes } = await seed("複本連戲");
    const [lian] = await db.insert(schema.characters).values({
      projectId: project.id, groupId, name: "小蓮", appearance: "圓臉", createdBy: userId,
    }).returning();
    const [look] = await db.insert(schema.characterLooks).values({
      projectId: project.id, groupId, characterId: lian.id, name: "除夕夜", costume: "大紅棉襖", createdBy: userId,
    }).returning();
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "情緒高點",
      characterIds: [lian.id], lookIds: [look.id],
      camera: { angle: "仰角", shotSize: "近景" },
      performance: { emotion: "眼睛發亮的驚喜" },
    }).returning();

    const dup = await scenes.insertAfter({ sceneId: shot.id, duplicate: true });
    expect(dup.lookIds).toEqual([look.id]);
    expect(dup.characterIds).toEqual([lian.id]);
    expect(dup.camera).toMatchObject({ angle: "仰角" });
    expect(dup.performance).toMatchObject({ emotion: "眼睛發亮的驚喜" });
  });

  it("two 小華 projects cannot bind each other's character ids", async () => {
    const a = await seed("小華A");
    const b = await seed("小華B");
    const [huaA] = await db.insert(schema.characters).values({
      projectId: a.project.id, groupId: a.groupId, name: "小華", appearance: "紅圍巾", createdBy: a.userId,
    }).returning();
    const [huaB] = await db.insert(schema.characters).values({
      projectId: b.project.id, groupId: b.groupId, name: "小華", appearance: "藍外套", createdBy: b.userId,
    }).returning();
    const [shotA] = await db.insert(schema.scenes).values({
      projectId: a.project.id, orderIndex: 1, title: "A-1",
    }).returning();
    await expect(a.scenes.setCards({ sceneId: shotA.id, characterIds: [huaB.id] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    const ok = await a.scenes.setCards({ sceneId: shotA.id, characterIds: [huaA.id] });
    expect(ok.characterIds).toEqual([huaA.id]);
  });

  it("assistant update_scene persists and bumps rev", async () => {
    const { project, ctx } = await seed("助手寫入");
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "原標題",
    }).returning();
    expect(shot.rev).toBe(0);
    const assistant = assistantRouter.createCaller(ctx as never);
    const result = await assistant.runAction({
      projectId: project.id,
      action: { type: "update_scene", sceneId: shot.id, field: "title", value: "助手改過的標題" },
    });
    expect(result.ok).toBe(true);
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.id));
    expect(fresh.title).toBe("助手改過的標題");
    expect(fresh.rev).toBeGreaterThan(shot.rev);
  });
});
