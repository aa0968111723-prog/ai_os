/**
 * Persist / reload the user-specified 淡江禪學社 小華 60s fixture.
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/tkuZenPromo.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "./boot";
import {
  assertTkuZenPromoSnapshot,
  loadTkuZenPromoSnapshot,
  materializeTkuZenPromoContent,
} from "./tkuZenPromoProject";
import { TKU_ZEN_PROMO_TITLE, TKU_ZEN_SHOTS } from "../../shared/fixtures/tkuZenPromo";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

d("淡江禪學社 小華 60s fixture persists after save/reload", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.storyScenes).where(eq(schema.storyScenes.projectId, projectId));
      await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
      await db.delete(schema.props).where(eq(schema.props.projectId, projectId));
      await db.delete(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("parses the exact promo into characters / 7 acts / shots and survives reload", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "Zen", email: `zen-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: TKU_ZEN_PROMO_TITLE, kind: "video", platform: "test", format: "9:16",
    }).returning();
    leftovers.projects.push(project.id);

    await materializeTkuZenPromoContent({
      userId,
      projectId: project.id,
      groupId,
    });
    const first = await loadTkuZenPromoSnapshot(project.id);
    assertTkuZenPromoSnapshot(first);
    const reloaded = await loadTkuZenPromoSnapshot(project.id);
    assertTkuZenPromoSnapshot(reloaded);
    expect(reloaded.shots).toHaveLength(TKU_ZEN_SHOTS.length);
    expect(reloaded.acts).toHaveLength(7);
    expect(reloaded.story?.content).toBe(first.story?.content);
    expect(reloaded.characters.map((c) => c.name).sort()).toEqual(["媽媽", "小華", "禪定龜龜"]);
  });

});
