/**
 * First-parse of a ~300-char Chinese SHOTLIST must finish in mock without a 150s hang.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/services/storyParse.promo.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { TKU_ZEN_SHOTLIST_AD_PARSE, TKU_ZEN_SHOTLIST_FIRST_PARSE } from "../../shared/fixtures/tkuZenPromo";
import { XIAOHUA_LOCKED_APPEARANCE } from "../../shared/characterIdentityLock";
import { db, schema } from "../db";
import { markBootReady } from "./boot";
import { NIM_DEFAULT_MODEL, NIM_REASONING_MODEL } from "./nvidia-nim";
import {
  materializeStoryboard,
  mockStoryExtract,
  runStoryParse,
  STORY_PARSE_SHORT_CHARS,
  STORY_PARSE_SHORT_PRIMARY_MS,
} from "./storyParse";
import type { StoryParsePlan } from "../../shared/story";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

d("~300-char Chinese first-parse runStoryParse (mock EXTRACT, real PostgreSQL)", () => {
  const leftovers: { users: string[]; projects: string[] } = { users: [], projects: [] };

  afterAll(async () => {
    for (const projectId of leftovers.projects) {
      await db.delete(schema.parseCandidates).where(eq(schema.parseCandidates.projectId, projectId));
      await db.delete(schema.parseRuns).where(eq(schema.parseRuns.projectId, projectId));
      await db.delete(schema.scenes).where(eq(schema.scenes.projectId, projectId));
      await db.delete(schema.storyScenes).where(eq(schema.storyScenes.projectId, projectId));
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

  it("force cache-miss first parse succeeds on 70B well under 150s and writes counters", async () => {
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.length).toBeGreaterThanOrEqual(280);
    expect(TKU_ZEN_SHOTLIST_FIRST_PARSE.length).toBeLessThanOrEqual(STORY_PARSE_SHORT_CHARS);

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

    const complete = vi.fn(async (_prompt: string, opts: { model: string; timeoutMs?: number; fallbackTimeoutMs?: number }) => {
      expect(opts.model).toBe(NIM_DEFAULT_MODEL);
      expect(opts.model).not.toBe(NIM_REASONING_MODEL);
      expect(opts.timeoutMs ?? 150_000).toBe(STORY_PARSE_SHORT_PRIMARY_MS);
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
      force: true,
      assertAccess: () => undefined,
      complete,
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(15_000);
    expect(result.skipped).not.toBe(true);
    expect(result.mock).toBe(false);
    expect(result.stats.scenes).toBe(6);
    expect(result.stats.shots).toBeGreaterThan(0);
    expect(complete).toHaveBeenCalledOnce();

    const [run] = await db.select().from(schema.parseRuns).where(eq(schema.parseRuns.id, result.runId));
    expect(run?.status).toBe("done");
    expect(run?.stats).toMatchObject({ scenes: result.stats.scenes, shots: result.stats.shots });

    // Hash cache is not the success path. force:true must parse again on 70B.
    complete.mockClear();
    const forced = await runStoryParse({
      userId,
      projectId: project.id,
      force: true,
      assertAccess: () => undefined,
      complete,
    });
    expect(forced.skipped).not.toBe(true);
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0]?.[1]?.model).toBe(NIM_DEFAULT_MODEL);
  });

  it("161-char A–D cache-miss stays on 70B and refuses 年輕男性 for 小華", async () => {
    expect(TKU_ZEN_SHOTLIST_AD_PARSE.length).toBe(161);
    expect(TKU_ZEN_SHOTLIST_AD_PARSE.length).toBeLessThanOrEqual(STORY_PARSE_SHORT_CHARS);

    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "AdParse", email: `ad-parse-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-test-ad-first-parse", kind: "video", platform: "test", format: "9:16",
    }).returning();
    leftovers.projects.push(project.id);
    await db.insert(schema.stories).values({
      projectId: project.id,
      groupId,
      content: TKU_ZEN_SHOTLIST_AD_PARSE,
    });

    const flipped = mockStoryExtract(TKU_ZEN_SHOTLIST_AD_PARSE);
    const poisoned: StoryParsePlan = {
      ...flipped,
      characters: [
        { name: "小華", appearance: "年輕男性", costume: "黑長直髮", confidence: 0.95 },
        { name: "禪定龜龜", appearance: "吉祥物龜龜", costume: "圓殼", confidence: 0.95 },
      ],
      scenes: flipped.scenes.map((scene, i) => ({
        ...scene,
        shots: scene.shots.map((shot) => (
          i === 0
            ? {
                ...shot,
                title: "小華站在校門口，夕陽光照在他身上",
                prompt: "小華站在校門口，夕陽光照在他身上",
                characterRefs: ["小華"],
              }
            : shot
        )),
      })),
    };
    const complete = vi.fn(async (_prompt: string, opts: { model: string; timeoutMs?: number }) => {
      expect(opts.model).toBe(NIM_DEFAULT_MODEL);
      expect(opts.model).not.toBe(NIM_REASONING_MODEL);
      expect(opts.timeoutMs ?? 150_000).toBe(STORY_PARSE_SHORT_PRIMARY_MS);
      return {
        output: JSON.stringify(poisoned),
        model: NIM_DEFAULT_MODEL,
        downgraded: false,
      };
    });

    const result = await runStoryParse({
      userId,
      projectId: project.id,
      force: true,
      assertAccess: () => undefined,
      complete,
    });
    expect(result.skipped).not.toBe(true);
    expect(complete).toHaveBeenCalledOnce();

    const cards = await db.select().from(schema.characters).where(eq(schema.characters.projectId, project.id));
    const xiaohua = cards.find((c) => c.name === "小華");
    expect(xiaohua?.appearance).toBe(XIAOHUA_LOCKED_APPEARANCE);
    expect(xiaohua?.appearance).toContain("粉橘短髮女孩");
    expect(xiaohua?.appearance).not.toContain("年輕男性");
    expect(cards.find((c) => c.name === "禪定龜龜")?.appearance).toContain("吉祥物龜龜");

    const [parseRun] = await db.select().from(schema.parseRuns).where(eq(schema.parseRuns.id, result.runId));
    const plan = parseRun?.plan as StoryParsePlan | null;
    const copy = JSON.stringify(plan?.scenes ?? []);
    expect(copy).toContain("她身上");
    expect(copy).not.toMatch(/他身上/);

    const board = await materializeStoryboard({
      userId,
      projectId: project.id,
      runId: result.runId,
      assertAccess: () => undefined,
    });
    expect(board.reused).toBe(false);
    const shots = await db.select().from(schema.scenes).where(eq(schema.scenes.projectId, project.id));
    expect(shots.some((s) => (s.title ?? "").includes("她身上") || (s.prompt ?? "").includes("她身上"))).toBe(true);
    expect(shots.some((s) => (s.title ?? "").includes("他身上") || (s.prompt ?? "").includes("他身上"))).toBe(false);
  });
});
