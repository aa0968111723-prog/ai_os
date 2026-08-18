/**
 * story.save OCC: a stale-rev blur must not silent-LWW a newer story.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/story.save.occ.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { storyRouter } from "./story";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "story", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("story.save blur OCC (real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  async function seed() {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "Story", email: `story-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "失焦 OCC", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    return { project, story: storyRouter.createCaller({ auth: authFor(userId, groupId) } as never) };
  }

  it("blur with a stale expectedRev cannot silent-LWW overwrite a newer rev", async () => {
    const { project, story } = await seed();
    const first = await story.save({ projectId: project.id, content: "起點" });
    const newer = await story.save({
      projectId: project.id,
      content: "夥伴較新",
      expectedRev: first.rev,
      baseline: "起點",
    });
    expect(newer.rev).toBeGreaterThan(first.rev);

    await expect(story.save({
      projectId: project.id,
      content: "失焦舊稿",
      expectedRev: first.rev,
      baseline: "起點",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const got = await story.get({ projectId: project.id });
    expect(got.story?.content).toBe("夥伴較新");
    expect(got.story?.rev).toBe(newer.rev);
  });

  it("omitting expectedRev still LWW — that is why onBlur must send rev", async () => {
    const { project, story } = await seed();
    const first = await story.save({ projectId: project.id, content: "起點" });
    await story.save({
      projectId: project.id,
      content: "夥伴較新",
      expectedRev: first.rev,
      baseline: "起點",
    });
    const lww = await story.save({ projectId: project.id, content: "失焦舊稿" });
    expect(lww.rev).toBeGreaterThan(first.rev);
    const got = await story.get({ projectId: project.id });
    expect(got.story?.content).toBe("失焦舊稿");
  });
});
