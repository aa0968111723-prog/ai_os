/**
 * Same projectId: 產生分鏡 rows must show up in studio listByProject.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/story.studioList.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { scenesRouter } from "./scenes";
import { storyRouter } from "./story";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "studio-list", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("parse → 產生分鏡 → studio listByProject (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.parseCandidates).where(eq(schema.parseCandidates.projectId, projectId));
      await db.delete(schema.parseRuns).where(eq(schema.parseRuns.projectId, projectId));
      await db.delete(schema.shotContextPacketHeads).where(eq(schema.shotContextPacketHeads.projectId, projectId));
      await db.delete(schema.scenePackageHeads).where(eq(schema.scenePackageHeads.projectId, projectId));
      await db.delete(schema.shotContextPackets).where(eq(schema.shotContextPackets.projectId, projectId));
      await db.delete(schema.scenePackages).where(eq(schema.scenePackages.projectId, projectId));
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.storyScenes).where(eq(schema.storyScenes.projectId, projectId));
      await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("materialize 1場6鏡 then listByProject returns those same shot ids", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "StudioList", email: `studio-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-studio-list", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    const [story] = await db.insert(schema.stories).values({
      projectId: project.id, groupId, content: "一場六鏡短稿。",
    }).returning();
    const shots = Array.from({ length: 6 }, (_, i) => ({
      title: `鏡${i + 1}`,
      prompt: `第 ${i + 1} 鏡畫面`,
      durationSec: 4,
    }));
    await db.insert(schema.parseRuns).values({
      projectId: project.id,
      storyId: story.id,
      status: "done",
      contentHash: "studio-list-hash",
      plan: {
        characters: [],
        locations: [],
        props: [],
        scenes: [{ title: "第一場", shots }],
      },
      createdBy: userId,
    });

    const ctx = { auth: authFor(userId, groupId) };
    const storyApi = storyRouter.createCaller(ctx as never);
    const scenesApi = scenesRouter.createCaller(ctx as never);
    const board = await storyApi.generateStoryboard({ projectId: project.id });
    expect(board.sceneIds).toHaveLength(6);
    expect(board.storySceneIds).toHaveLength(1);

    const listed = await scenesApi.listByProject({ projectId: project.id });
    expect(listed.map((row) => row.id)).toEqual(board.sceneIds);
    expect(listed).toHaveLength(6);
    expect(listed.map((row) => row.title)).toEqual(["鏡1", "鏡2", "鏡3", "鏡4", "鏡5", "鏡6"]);
  });
});
