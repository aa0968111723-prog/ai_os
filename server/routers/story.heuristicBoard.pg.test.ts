/**
 * Parse never succeeded: generateStoryboard still builds shots from story text.
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=postgres://… npx vitest run server/routers/story.heuristicBoard.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import type { AuthState } from "../services/auth";
import { scenesRouter } from "./scenes";
import { storyRouter } from "./story";
import { planStoryboardFromStoryText } from "../services/storyParse";
import { TKU_ZEN_SHOTLIST_AD_PARSE } from "../../shared/fixtures/tkuZenPromo";
import type { StoryParsePlan } from "../../shared/story";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "heuristic", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

d("parse-fail 產生分鏡 from story text (real PostgreSQL)", () => {
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
      await db.delete(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId));
      await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
      await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    }
    for (const userId of leftovers.users) {
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    }
  });

  it("no done parse run + story text → generateStoryboard creates shots; addDraft still works", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "Heuristic", email: `heuristic-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-xiaohua-timeout", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    await db.insert(schema.stories).values({
      projectId: project.id,
      groupId,
      content: "小華走進禪堂。晨光從窗櫺灑進來。\n\n師父坐在蒲團上，對她點頭。",
    });

    const ctx = { auth: authFor(userId, groupId) };
    const storyApi = storyRouter.createCaller(ctx as never);
    const scenesApi = scenesRouter.createCaller(ctx as never);

    const before = await scenesApi.listByProject({ projectId: project.id });
    expect(before).toHaveLength(0);

    const board = await storyApi.generateStoryboard({ projectId: project.id });
    expect(board.sceneIds.length).toBeGreaterThan(0);
    expect(board.reused).toBe(false);

    const listed = await scenesApi.listByProject({ projectId: project.id });
    expect(listed.map((row) => row.id)).toEqual(board.sceneIds);
    expect(listed.length).toBeGreaterThan(0);

    const extra = await scenesApi.addDraft({ projectId: project.id, title: `第 ${listed.length + 1} 鏡` });
    const afterAdd = await scenesApi.listByProject({ projectId: project.id });
    expect(afterAdd.map((row) => row.id)).toContain(extra.id);
    expect(afterAdd).toHaveLength(listed.length + 1);
  });

  it("generateStoryboard rewrites cached male 小華 titles so copy cannot say 他", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "GenderBoard", email: `gender-board-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-test-ad-gender-board", kind: "video", platform: "test", format: "9:16",
    }).returning();
    leftovers.projects.push(project.id);
    const [story] = await db.insert(schema.stories).values({
      projectId: project.id,
      groupId,
      content: TKU_ZEN_SHOTLIST_AD_PARSE,
    }).returning();
    const malePlan: StoryParsePlan = {
      characters: [{ name: "小華", appearance: "年輕男性", costume: "黑長直髮", confidence: 0.95 }],
      locations: [],
      props: [],
      scenes: [{
        title: "校門口",
        shots: [
          {
            title: "小華站在校門口，夕陽光照在他身上",
            prompt: "小華站在校門口，夕陽光照在他身上",
            characterRefs: ["小華"],
            durationSec: 5,
          },
          {
            title: "小華站在夕陽下，夕陽光照在他身上",
            prompt: "小華站在夕陽下，夕陽光照在他身上",
            characterRefs: ["小華"],
            durationSec: 5,
          },
        ],
      }],
    };
    await db.insert(schema.parseRuns).values({
      projectId: project.id,
      storyId: story.id,
      status: "done",
      createdBy: userId,
      plan: malePlan,
      stats: {
        characters: { created: 0, linked: 0, pending: 0 },
        locations: { created: 0, linked: 0, pending: 0 },
        props: { created: 0, linked: 0, pending: 0 },
        looks: { created: 0 },
        scenes: 1,
        shots: 2,
      },
    });

    const storyApi = storyRouter.createCaller({ auth: authFor(userId, groupId) } as never);
    const board = await storyApi.generateStoryboard({ projectId: project.id });
    expect(board.reused).toBe(false);
    expect(board.sceneIds).toHaveLength(2);

    const shots = await db.select().from(schema.scenes).where(eq(schema.scenes.projectId, project.id));
    expect(shots.some((s) => (s.title ?? "").includes("她身上") || (s.prompt ?? "").includes("她身上"))).toBe(true);
    expect(shots.some((s) => (s.title ?? "").includes("他身上") || (s.prompt ?? "").includes("他身上"))).toBe(false);
  });

  it("產生分鏡 adopts 5 orphan shots into scenes — does not grow 5→plan+5", async () => {
    const userId = randomUUID();
    const groupId = randomUUID();
    leftovers.users.push(userId);
    await db.insert(schema.users).values({
      id: userId, name: "OrphanBoard", email: `orphan-board-${userId}@t.test`, passwordHash: "x",
    });
    const [project] = await db.insert(schema.projects).values({
      groupId, ownerId: userId, title: "overnight-orphan-board", kind: "video", platform: "test", format: "16:9",
    }).returning();
    leftovers.projects.push(project.id);
    const unmarked = [
      "安倢走進禪堂。晨光從窗櫺灑進來。師父對她點頭。",
      "",
      "她走進教室。拉開椅子。坐下寫生。",
      "",
      "宿舍走廊很暗。燈還沒關。她停在門口。",
    ].join("\n");
    await db.insert(schema.stories).values({
      projectId: project.id,
      groupId,
      content: unmarked,
    });

    const ctx = { auth: authFor(userId, groupId) };
    const storyApi = storyRouter.createCaller(ctx as never);
    const scenesApi = scenesRouter.createCaller(ctx as never);
    for (let i = 1; i <= 5; i += 1) {
      await scenesApi.addDraft({ projectId: project.id, title: `第 ${i} 鏡` });
    }
    const before = await scenesApi.listByProject({ projectId: project.id });
    expect(before).toHaveLength(5);
    expect(before.every((row) => !row.storySceneId)).toBe(true);

    const planned = planStoryboardFromStoryText(unmarked);
    const plannedShots = planned.scenes.reduce((n, sc) => n + sc.shots.length, 0);
    expect(plannedShots).toBeGreaterThan(5);

    const board = await storyApi.generateStoryboard({ projectId: project.id });
    expect(board.reused).toBe(false);

    const listed = await scenesApi.listByProject({ projectId: project.id });
    expect(listed).toHaveLength(plannedShots);
    expect(listed.every((row) => Boolean(row.storySceneId))).toBe(true);
    expect(before.every((row) => listed.some((live) => live.id === row.id))).toBe(true);
    expect(new Set(listed.map((row) => row.id))).toEqual(new Set(board.sceneIds));

    const storyScenes = await db.select().from(schema.storyScenes).where(eq(schema.storyScenes.projectId, project.id));
    expect(storyScenes.every((sc) => Boolean(sc.locationId))).toBe(true);
    const presets = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.projectId, project.id));
    expect(new Set(presets.map((p) => p.name))).toEqual(new Set(["禪堂", "教室", "宿舍"]));
  });
});
