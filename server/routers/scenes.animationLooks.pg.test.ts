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
import { storyRouter } from "./story";

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
      await db.delete(schema.stories).where(eq(schema.stories.projectId, projectId));
      await db.delete(schema.characterLooks).where(eq(schema.characterLooks.projectId, projectId));
      await db.delete(schema.characters).where(eq(schema.characters.projectId, projectId));
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

  it("26→27: 複製這一鏡 clones after the source (fails on the live silent no-op)", async () => {
    const { project, scenes } = await seed("創作室複製26");
    const ids: string[] = [];
    for (let i = 1; i <= 26; i += 1) {
      const [row] = await db.insert(schema.scenes).values({
        projectId: project.id, orderIndex: i, title: `第 ${i} 鏡`,
      }).returning();
      ids.push(row.id);
    }
    const sourceId = ids[12]!;
    const listedBefore = await scenes.listByProject({ projectId: project.id });
    expect(listedBefore).toHaveLength(26);

    const dup = await scenes.insertAfter({ sceneId: sourceId, duplicate: true });
    expect(dup.id).toBeTruthy();
    expect(dup.projectId).toBe(project.id);

    const listed = await scenes.listByProject({ projectId: project.id });
    expect(listed).toHaveLength(27);
    const sourceIdx = listed.findIndex((row) => row.id === sourceId);
    expect(listed[sourceIdx + 1]?.id).toBe(dup.id);
    expect(listed[sourceIdx + 1]?.title).toMatch(/複本/);
    expect(listed.map((row) => row.id)).toEqual([
      ...ids.slice(0, 13),
      dup.id,
      ...ids.slice(13),
    ]);
  });

  it("複製 increases listByProject by 1 and the new row sits after the source", async () => {
    const { project, userId, groupId, scenes } = await seed("創作室複製這一鏡");
    const [lian] = await db.insert(schema.characters).values({
      projectId: project.id, groupId, name: "小蓮", appearance: "圓臉", createdBy: userId,
    }).returning();
    const [look] = await db.insert(schema.characterLooks).values({
      projectId: project.id, groupId, characterId: lian.id, name: "除夕夜", costume: "大紅棉襖", createdBy: userId,
    }).returning();
    const assetId = randomUUID();
    await db.insert(schema.assets).values({
      id: assetId,
      projectId: project.id,
      groupId,
      kind: "image",
      title: "第04鏡畫面",
      url: `/api/assets/${assetId}/file`,
    });
    const [before] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 0, title: "第03鏡",
    }).returning();
    const [source] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "第04鏡",
      characterIds: [lian.id], lookIds: [look.id], assetId,
      camera: { shotSize: "近景" },
    }).returning();
    const [after] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 2, title: "第05鏡",
    }).returning();

    const listedBefore = await scenes.listByProject({ projectId: project.id });
    expect(listedBefore).toHaveLength(3);

    const dup = await scenes.insertAfter({ sceneId: source.id, duplicate: true });
    expect(dup.projectId).toBe(project.id);
    expect(dup.lookIds).toEqual([look.id]);
    expect(dup.assetId).toBe(assetId);
    expect(dup.characterIds).toEqual([lian.id]);

    const listed = await scenes.listByProject({ projectId: project.id });
    expect(listed).toHaveLength(listedBefore.length + 1);
    const sourceIdx = listed.findIndex((row) => row.id === source.id);
    expect(sourceIdx).toBe(1);
    expect(listed[sourceIdx + 1]?.id).toBe(dup.id);
    expect(listed.map((row) => row.id)).toEqual([before.id, source.id, dup.id, after.id]);
    expect(listed[sourceIdx + 1]?.lookIds).toEqual([look.id]);
    expect(listed[sourceIdx + 1]?.assetId).toBe(assetId);
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

  it("another group cannot list or mutate this project's shots", async () => {
    const a = await seed("組A專案");
    const b = await seed("組B專案");
    await db.insert(schema.scenes).values({
      projectId: a.project.id, orderIndex: 1, title: "只有組A看得到",
    });
    await expect(b.scenes.listByProject({ projectId: a.project.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const [shotB] = await db.insert(schema.scenes).values({
      projectId: b.project.id, orderIndex: 1, title: "組B的鏡",
    }).returning();
    await expect(a.scenes.update({ sceneId: shotB.id, title: "被組A改名" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shotB.id));
    expect(fresh.title).toBe("組B的鏡");
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
    expect("verification" in result && result.verification?.status).toBe("verified");
    expect("verificationMethod" in result && result.verificationMethod).toBe("authoritative_scene_row_read_back");
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.id));
    expect(fresh.title).toBe("助手改過的標題");
    expect(fresh.rev).toBeGreaterThan(shot.rev);
  });

  it("assistant create_scene inserts a real shot and returns its id", async () => {
    const { project, ctx } = await seed("助手新增分鏡");
    const assistant = assistantRouter.createCaller(ctx as never);
    const result = await assistant.runAction({
      projectId: project.id,
      action: {
        type: "create_scene",
        title: "助手新加的一鏡",
        voiceover: "燈籠還在手上",
        prompt: "小蓮停在街口",
        durationSec: 4,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe("create_scene");
    if (result.kind !== "create_scene") return;
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, result.sceneId));
    expect(fresh.title).toBe("助手新加的一鏡");
    expect(fresh.voiceover).toBe("燈籠還在手上");
    expect(fresh.prompt).toBe("小蓮停在街口");
    expect(fresh.durationSec).toBe(4);
    expect(fresh.deletedAt).toBeNull();
    expect(result.ok).toBe(true);
    expect("verification" in result && result.verification?.status).toBe("verified");
    expect("verificationMethod" in result && result.verificationMethod).toBe("authoritative_scene_row_read_back");
  });

  it("assistant update_scene / direct_shot without read-back match → ok:false", async () => {
    const { project, ctx } = await seed("助手讀回");
    const [shot] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 2, title: "原標題",
      camera: { shotSize: "近景" },
    }).returning();
    const assistant = assistantRouter.createCaller(ctx as never);
    const updated = await assistant.runAction({
      projectId: project.id,
      action: { type: "update_scene", sceneId: shot.id, field: "title", value: "讀回後的標題" },
    });
    expect(updated.ok).toBe(true);
    expect("verification" in updated && updated.verification?.status).toBe("verified");
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.id));
    expect(fresh.title).toBe("讀回後的標題");

    const noop = await assistant.runAction({
      projectId: project.id,
      action: { type: "direct_shot", sceneId: shot.id, camera: { shotSize: "近景" } },
    });
    expect(noop.ok).toBe(false);
    expect("verification" in noop && noop.verification?.status).toBe("unverified");
    expect(noop.message).not.toMatch(/^已調整/);
  });

  it("overlapping story.save with the same expectedRev: one wins, latest retry persists", async () => {
    const { project, ctx } = await seed("故事重疊存檔");
    const story = storyRouter.createCaller(ctx as never);
    const first = await story.save({ projectId: project.id, content: "起點" });
    const [a, b] = await Promise.allSettled([
      story.save({
        projectId: project.id,
        content: "A較短",
        expectedRev: first.rev,
        baseline: "起點",
      }),
      story.save({
        projectId: project.id,
        content: "B這一份比較長而且是最新草稿",
        expectedRev: first.rev,
        baseline: "起點",
      }),
    ]);
    const fulfilled = [a, b].filter((row) => row.status === "fulfilled");
    const rejected = [a, b].filter((row) => row.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const got = await story.get({ projectId: project.id });
    expect(["A較短", "B這一份比較長而且是最新草稿"]).toContain(got.story?.content);
    const latest = "B這一份比較長而且是最新草稿";
    const saved = await story.save({
      projectId: project.id,
      content: latest,
      expectedRev: got.story?.rev,
      baseline: got.story?.content,
    });
    expect(saved.rev).toBeGreaterThan(got.story?.rev ?? 0);
    const again = await story.get({ projectId: project.id });
    expect(again.story?.content).toBe(latest);
  });

  it("repeated insertAfter on the same sceneId is LIFO; concurrent same-id still yields 10 distinct UUIDs", async () => {
    const { project, scenes } = await seed("併發插入");
    const [anchor] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 0, title: "錨點",
    }).returning();
    const [tail] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "原本下一鏡",
    }).returning();

    const sequential: string[] = [];
    for (let i = 0; i < 5; i++) {
      sequential.push((await scenes.insertAfter({ sceneId: anchor.id })).id);
    }
    const afterSeq = await scenes.listByProject({ projectId: project.id });
    expect(afterSeq.map((s) => s.id)).toEqual([anchor.id, ...[...sequential].reverse(), tail.id]);

    const created = await Promise.all(
      Array.from({ length: 10 }, () => scenes.insertAfter({ sceneId: anchor.id })),
    );
    const newIds = created.map((row) => row.id);
    expect(new Set(newIds).size).toBe(10);
    const listed = await scenes.listByProject({ projectId: project.id });
    expect(listed).toHaveLength(17);
    expect(listed[0]?.id).toBe(anchor.id);
    expect(listed.at(-1)?.id).toBe(tail.id);
    expect(new Set(listed.map((s) => s.orderIndex)).size).toBe(listed.length);
    expect(new Set(listed.map((s) => s.id))).toEqual(new Set([anchor.id, tail.id, ...sequential, ...newIds]));
  });

  it("chained insertAfter (next target = created.id) keeps click order after the row", async () => {
    const { project, scenes } = await seed("串接插入");
    const [anchor] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 0, title: "錨點",
    }).returning();
    const [tail] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "原本下一鏡",
    }).returning();

    const clickOrder: string[] = [];
    let after = anchor.id;
    for (let i = 0; i < 10; i++) {
      const row = await scenes.insertAfter({ sceneId: after });
      clickOrder.push(row.id);
      after = row.id;
    }
    const listed = await scenes.listByProject({ projectId: project.id });
    expect(listed.map((s) => s.id)).toEqual([anchor.id, ...clickOrder, tail.id]);
  });

  it("project B list is unchanged while A insertAfter runs; B cannot restore-into A's order", async () => {
    const a = await seed("專案A");
    const b = await seed("專案B");
    const [shotA] = await db.insert(schema.scenes).values({
      projectId: a.project.id, orderIndex: 0, title: "A-1",
    }).returning();
    const [shotB] = await db.insert(schema.scenes).values({
      projectId: b.project.id, orderIndex: 0, title: "B-1",
    }).returning();

    const inserted = await a.scenes.insertAfter({ sceneId: shotA.id });
    const listB = await b.scenes.listByProject({ projectId: b.project.id });
    expect(listB.map((s) => s.id)).toEqual([shotB.id]);
    expect(listB.some((s) => s.id === inserted.id)).toBe(false);

    const listA = await a.scenes.listByProject({ projectId: a.project.id });
    expect(listA.map((s) => s.id)).toEqual([shotA.id, inserted.id]);

    await expect(b.scenes.insertAfter({ sceneId: shotA.id })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("restore puts the shot back at its original orderIndex", async () => {
    const { project, scenes } = await seed("還原原位");
    const [first] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 0, title: "第一",
    }).returning();
    const [second] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "第二",
    }).returning();
    await scenes.remove({ sceneId: first.id });
    await scenes.restore({ sceneId: first.id });
    const listed = await scenes.listByProject({ projectId: project.id });
    expect(listed.map((s) => s.id)).toEqual([first.id, second.id]);
    expect(listed[0]?.orderIndex).toBe(0);
  });

  it("restore shifts later shots when the original slot is occupied", async () => {
    const { project, scenes } = await seed("還原讓位");
    const [first] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 0, title: "第一",
    }).returning();
    const [mid] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 1, title: "中間",
    }).returning();
    const [last] = await db.insert(schema.scenes).values({
      projectId: project.id, orderIndex: 2, title: "最後",
    }).returning();
    await scenes.remove({ sceneId: mid.id });
    const inserted = await scenes.insertAfter({ sceneId: first.id });
    await scenes.restore({ sceneId: mid.id });
    const listed = await scenes.listByProject({ projectId: project.id });
    expect(listed.map((s) => s.id)).toEqual([first.id, mid.id, inserted.id, last.id]);
  });
});
