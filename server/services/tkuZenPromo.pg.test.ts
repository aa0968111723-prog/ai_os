/**
 * Persist / reload the 淡江禪學社 小華 SHOTLIST fixture.
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
import { TKU_ZEN_PROMO_TITLE, TKU_ZEN_SHOTLIST_LINES } from "../../shared/fixtures/tkuZenPromo";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

d("淡江禪學社 小華 SHOTLIST persists after save/reload", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.storyScenes).where(eq(schema.storyScenes.projectId, projectId));
      await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
      await db.delete(schema.knowledge).where(eq(schema.knowledge.projectId, projectId));
      await db.delete(schema.characterLooks).where(eq(schema.characterLooks.projectId, projectId));
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
      await db.delete(schema.props).where(eq(schema.props.projectId, projectId));
      await db.delete(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId));
      await db.delete(schema.assets).where(eq(schema.assets.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("materializes 6 spoken SHOTLIST beats / pink-bob lock and survives reload", async () => {
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
    expect(reloaded.acts).toHaveLength(6);
    expect(reloaded.characters.map((c) => c.name).sort()).toEqual(["小華", "禪定龜龜"]);
    expect(reloaded.characters.find((c) => c.name === "小華")?.appearance).toContain("針織外套");
    expect(reloaded.characters.find((c) => c.name === "小華")?.appearance).not.toContain("白帽T");
    expect(reloaded.characters.find((c) => c.name === "禪定龜龜")?.appearance).toContain("吉祥物龜龜");
    expect(reloaded.presets.some((p) => p.name === "克難坡")).toBe(true);
    expect(reloaded.looks).toHaveLength(2);
    expect(reloaded.story?.content).toContain(TKU_ZEN_SHOTLIST_LINES[0]);
    expect(reloaded.characters.some((c) => c.name === "媽媽")).toBe(false);
  });
});
