/**
 * First-parse of a ~300-char Chinese SHOTLIST must finish in mock without a 150s hang.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/storyParse.promo.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { TKU_ZEN_SHOTLIST_FIRST_PARSE } from "../../shared/fixtures/tkuZenPromo";
import { db, schema } from "../db";
import { markBootReady } from "./boot";
import { NIM_DEFAULT_MODEL } from "./nvidia-nim";
import {
  mockStoryExtract,
  runStoryParse,
  STORY_PARSE_PROMO_CHARS,
  STORY_PARSE_PROMO_PRIMARY_MS,
} from "./storyParse";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

d("~300-char Chinese first-parse runStoryParse (mock EXTRACT, real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.parseCandidates).where(eq(schema.parseCandidates.projectId, projectId));
      await db.delete(schema.parseRuns).where(eq(schema.parseRuns.projectId, projectId));
      await db.delete(schema.characterLooks).where(eq(schema.characterLooks.projectId, projectId));
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
      await db.delete(schema.props).where(eq(schema.props.projectId, projectId));
      await db.delete(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId));
      await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("completes first parse without a 150s timeout and writes counters", async () => {
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.length).toBeGreaterThanOrEqual(280);
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.length).toBeLessThanOrEqual(STORY_PARSE_PROMO_CHARS);

    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "PromoParse", email: `promo-parse-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-test-shotlist-first-parse", kind: "video", platform: "test", format: "9:16",
    }).returning();
    leftovers.projects.push(project.id);
    await db.insert(schema.stories).values({
      projectId: project.id,
      groupId,
      content: TKU_ZEN_SHOTLIST_FIRST_PARSE,
    });

    const complete = vi.fn(async (_prompt: string, opts: { timeoutMs?: number; fallbackTimeoutMs?: number }) => {
      expect(opts.timeoutMs ?? 150_000).toBe(STORY_PARSE_PROMO_PRIMARY_MS);
      expect(opts.timeoutMs ?? 150_000).toBeLessThan(150_000);
      expect(String(opts.timeoutMs ?? "")).not.toMatch(/150000/);
      return {
        output: JSON.stringify(mockStoryExtract(TKU_ZEN_SHOTLIST_FIRST_PARSE)),
        model: NIM_DEFAULT_MODEL,
        downgraded: false,
      };
    });

    const started = Date.now();
    const result = await runStoryParse({
      userId,
      projectId: project.id,
      assertAccess: () => undefined,
      complete,
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(15_000);
    expect(result.skipped).not.toBe(true);
    expect(result.mock).toBe(false);
    expect(result.stats.scenes).toBeGreaterThan(0);
    expect(result.stats.shots).toBeGreaterThan(0);
    expect(complete).toHaveBeenCalledOnce();

    const [run] = await db.select().from(schema.parseRuns).where(eq(schema.parseRuns.id, result.runId));
    expect(run?.status).toBe("done");
    expect(run?.stats).toMatchObject({ scenes: result.stats.scenes, shots: result.stats.shots });
  });
});
