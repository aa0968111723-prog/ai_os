/**
 * Story 共編持久化（驗收 O／P；真 PostgreSQL）。
 *
 * O：快照落盤 → 重載 → 內容正確（含「既有專案第一次開共編要種 stories.content」）。
 * P：materialize 的 stories.content 與 Yjs canonical document 一致，
 *    且 rev 有前進——還在用舊 autosave 的客戶端下一次儲存會撞到衝突卡，
 *    而不是把共編內容整份蓋掉。
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { db, schema } from "../db";
import { markBootReady } from "./boot";
import type { AuthState } from "./auth";
import { storyRouter } from "../routers/story";
import { flushStoryDocNow, loadStoryDoc, persistStoryDoc, STORY_TEXT_KEY } from "./collabDoc";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
if (RUN_PG) markBootReady();

function storyCaller(userId: string, groupId: string) {
  const auth: AuthState = {
    user: { id: userId, name: "共編", email: `${userId}@t.local`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
  return storyRouter.createCaller({ auth } as never);
}

describe.skipIf(!RUN_PG).sequential("collabDoc 持久化（真 PostgreSQL）", () => {
  const groupId = randomUUID();
  const editor = randomUUID();
  const projectIds: string[] = [];

  async function newProject(content?: string): Promise<string> {
    const id = randomUUID();
    projectIds.push(id);
    await db.insert(schema.projects).values({
      id, groupId, ownerId: editor, title: "共編測試", kind: "video", platform: "youtube", format: "16:9",
    });
    if (content !== undefined) {
      await db.insert(schema.stories).values({ projectId: id, groupId, content, updatedBy: editor });
    }
    return id;
  }

  async function storyRow(projectId: string) {
    const [row] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    return row;
  }

  /** Production flush always passes lastMaterializedRev. Tests that mean "I loaded this story" must too. */
  async function persistKnown(projectId: string, doc: Y.Doc) {
    const row = await storyRow(projectId);
    if (!row) return persistStoryDoc(projectId, groupId, doc, editor);
    return persistStoryDoc(projectId, groupId, doc, editor, {
      expectedRev: row.rev,
      baselineContent: row.content,
    });
  }

  beforeAll(async () => {
    await db.insert(schema.users).values({ id: editor, email: `e-${editor}@t.local`, name: "Bruce", passwordHash: "x" });
  });

  afterAll(async () => {
    if (projectIds.length) {
      await db.delete(schema.collabDocuments).where(inArray(schema.collabDocuments.projectId, projectIds));
      await db.delete(schema.stories).where(inArray(schema.stories.projectId, projectIds));
      await db.delete(schema.projects).where(inArray(schema.projects.id, projectIds));
    }
    await db.delete(schema.users).where(eq(schema.users.id, editor));
  });

  it("O1. 既有專案第一次開共編：從 stories.content 種初值——夥伴看到的是現在的故事，不是空白", async () => {
    const projectId = await newProject("下雨了。淡水好容易下雨呀。");
    const doc = await loadStoryDoc(projectId);
    expect(doc.getText(STORY_TEXT_KEY).toString()).toBe("下雨了。淡水好容易下雨呀。");
  });

  it("O2. 快照落盤 → 重載 → 內容正確（document reload 的 persisted content）", async () => {
    const projectId = await newProject("起點");
    const doc = await loadStoryDoc(projectId);
    doc.getText(STORY_TEXT_KEY).insert(2, "——韋澔加的一段");
    await persistKnown(projectId, doc);

    const reloaded = await loadStoryDoc(projectId);
    expect(reloaded.getText(STORY_TEXT_KEY).toString()).toBe("起點——韋澔加的一段");
    // 重載走的是快照（不是 stories.content 的字串）：CRDT 歷史還在，之後的合併仍正確
    const [row] = await db
      .select()
      .from(schema.collabDocuments)
      .where(eq(schema.collabDocuments.projectId, projectId));
    expect(row).toBeDefined();
    expect(row.kind).toBe("story");
  });

  it("P. materialize：stories.content 與 canonical document 一致、rev 前進、updatedBy 記最後改動者", async () => {
    const projectId = await newProject("原文");
    const [before] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));

    const doc = await loadStoryDoc(projectId);
    doc.getText(STORY_TEXT_KEY).insert(2, "，經過共編");
    await persistKnown(projectId, doc);

    const [after] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    // 一致性：parser／AI／export／搜尋讀到的就是共編的最新內容
    expect(after.content).toBe(doc.getText(STORY_TEXT_KEY).toString());
    expect(after.content).toBe("原文，經過共編");
    // rev 前進：舊 autosave 客戶端拿著舊 rev 再存會撞衝突卡，不會蓋掉共編內容
    expect(after.rev).toBe(before.rev + 1);
    expect(after.updatedBy).toBe(editor);
  });

  it("P2. 內容沒變的落盤不動 stories（不空轉 rev——否則純快照心跳會讓別人一直撞假衝突）", async () => {
    const projectId = await newProject("穩定內容");
    const doc = await loadStoryDoc(projectId);
    await persistKnown(projectId, doc);
    const [first] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    await persistKnown(projectId, doc);
    const [second] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    expect(second.rev).toBe(first.rev);
  });

  it("O3. 沒有 stories 列的新專案：persist 會建列——共編不是只能開在已有故事的專案上", async () => {
    const projectId = await newProject(); // 不建 stories
    const doc = await loadStoryDoc(projectId);
    expect(doc.getText(STORY_TEXT_KEY).toString()).toBe("");
    doc.getText(STORY_TEXT_KEY).insert(0, "從零開始的故事");
    await persistKnown(projectId, doc);
    const [row] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    expect(row.content).toBe("從零開始的故事");
  });

  it("壞快照 fail-open：退回 stories.content 重種，共編照樣開得起來", async () => {
    const projectId = await newProject("備援內容");
    await db.insert(schema.collabDocuments).values({
      groupId, projectId, kind: "story", refId: projectId, snapshot: "not-valid-base64-yjs!!!",
    });
    const doc = await loadStoryDoc(projectId);
    expect(doc.getText(STORY_TEXT_KEY).toString()).toBe("備援內容");
  });

  it("flushStoryDocNow returns the materialized story instead of a pre-persist snapshot", async () => {
    const projectId = await newProject("尚未落盤前");
    const doc = await loadStoryDoc(projectId);
    doc.getText(STORY_TEXT_KEY).insert(doc.getText(STORY_TEXT_KEY).length, "＋已改");
    await persistKnown(projectId, doc);
    const flushed = await flushStoryDocNow(projectId);
    expect(flushed.content).toBe("尚未落盤前＋已改");
    expect(flushed.rev).toBeGreaterThan(0);
  });

  it("overlapping persist with a stale expectedRev does not clobber a newer blur save", async () => {
    const projectId = await newProject("起點");
    const seed = await loadStoryDoc(projectId);
    await persistKnown(projectId, seed);
    const [before] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    await db
      .update(schema.stories)
      .set({ content: "blur 存檔", rev: before.rev + 1, updatedBy: editor, updatedAt: new Date() })
      .where(eq(schema.stories.id, before.id));

    const doc = new Y.Doc();
    doc.getText(STORY_TEXT_KEY).insert(0, "Yjs 想蓋過去的字");

    const result = await persistStoryDoc(projectId, groupId, doc, editor, {
      expectedRev: before.rev,
      baselineContent: "起點",
    });
    expect(result.conflict).toBe(true);
    expect(result.materialized).toBe(false);

    const [after] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    expect(after.content).toBe("blur 存檔");
    expect(after.rev).toBe(before.rev + 1);

    // 重開房間不可靠衝突快照把 blur 蓋回去（延遲 LWW）
    const reloaded = await loadStoryDoc(projectId);
    expect(reloaded.getText(STORY_TEXT_KEY).toString()).toBe("blur 存檔");
  });

  it("two concurrent persistStoryDoc cannot silently drop the other side", async () => {
    const projectId = await newProject("起點");
    const [before] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));

    const docA = await loadStoryDoc(projectId);
    const docB = await loadStoryDoc(projectId);
    const textA = docA.getText(STORY_TEXT_KEY);
    textA.delete(0, textA.length);
    textA.insert(0, "A 分頁的字");
    const textB = docB.getText(STORY_TEXT_KEY);
    textB.delete(0, textB.length);
    textB.insert(0, "B 分頁的字");

    const [resA, resB] = await Promise.all([
      persistStoryDoc(projectId, groupId, docA, editor, {
        expectedRev: before.rev,
        baselineContent: before.content,
      }),
      persistStoryDoc(projectId, groupId, docB, editor, {
        expectedRev: before.rev,
        baselineContent: before.content,
      }),
    ]);

    const [after] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    expect(["A 分頁的字", "B 分頁的字"]).toContain(after.content);
    expect(after.rev).toBeGreaterThan(before.rev);

    if (resA.conflict !== resB.conflict) {
      const winner = resA.conflict ? resB : resA;
      expect(winner.materialized).toBe(true);
      expect(resA.conflict ? resA.materialized : resB.materialized).toBe(false);
      expect(after.content).toBe(winner.content);
      expect(after.content).not.toBe(resA.conflict ? "A 分頁的字" : "B 分頁的字");
    } else {
      // 序列化成兩次成功 CAS：後寫者讀到新 rev，不是靜默跳過 OCC
      expect(resA.conflict).toBe(false);
      expect(resB.conflict).toBe(false);
      expect(resA.materialized || resB.materialized).toBe(true);
    }

    const reloaded = await loadStoryDoc(projectId);
    expect(reloaded.getText(STORY_TEXT_KEY).toString()).toBe(after.content);
  });

  it("story.save OCC then persistStoryDoc without expectedRev cannot silent-LWW", async () => {
    const projectId = await newProject("起點");
    const story = storyCaller(editor, groupId);
    const first = await story.get({ projectId });
    const saved = await story.save({
      projectId,
      content: "OCC 已存",
      expectedRev: first.story?.rev,
      baseline: "起點",
    });
    expect(saved.rev).toBeGreaterThan(first.story?.rev ?? -1);

    const doc = new Y.Doc();
    doc.getText(STORY_TEXT_KEY).insert(0, "Yjs 想蓋過去");
    const result = await persistStoryDoc(projectId, groupId, doc, editor);
    expect(result.conflict).toBe(true);
    expect(result.materialized).toBe(false);

    const after = await story.get({ projectId });
    expect(after.story?.content).toBe("OCC 已存");
    expect(after.story?.rev).toBe(saved.rev);

    await expect(story.save({
      projectId,
      content: "OCC 再存一次",
      expectedRev: saved.rev,
      baseline: "OCC 已存",
    })).resolves.toMatchObject({ rev: saved.rev + 1 });
  });

  it("persistStoryDoc with last-known rev after OCC story.save conflicts; losing client is told", async () => {
    const projectId = await newProject("起點");
    const before = await storyRow(projectId);
    const story = storyCaller(editor, groupId);
    const saved = await story.save({
      projectId,
      content: "OCC 已存",
      expectedRev: before!.rev,
      baseline: "起點",
    });

    const doc = new Y.Doc();
    doc.getText(STORY_TEXT_KEY).insert(0, "Yjs 舊視圖");
    const result = await persistStoryDoc(projectId, groupId, doc, editor, {
      expectedRev: before!.rev,
      baselineContent: "起點",
    });
    expect(result.conflict).toBe(true);
    expect(result.materialized).toBe(false);

    const after = await story.get({ projectId });
    expect(after.story?.content).toBe("OCC 已存");
    expect(after.story?.rev).toBe(saved.rev);

    await expect(story.save({
      projectId,
      content: "失焦舊稿",
      expectedRev: before!.rev,
      baseline: "起點",
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("Yjs persist first, then stale story.save is told (reverse two-writer)", async () => {
    const projectId = await newProject("起點");
    const before = await storyRow(projectId);
    const doc = await loadStoryDoc(projectId);
    const text = doc.getText(STORY_TEXT_KEY);
    text.delete(0, text.length);
    text.insert(0, "共編已落盤");
    const persisted = await persistStoryDoc(projectId, groupId, doc, editor, {
      expectedRev: before!.rev,
      baselineContent: "起點",
    });
    expect(persisted.conflict).toBe(false);
    expect(persisted.materialized).toBe(true);
    expect(persisted.rev).toBeGreaterThan(before!.rev);

    const story = storyCaller(editor, groupId);
    await expect(story.save({
      projectId,
      content: "失焦舊稿",
      expectedRev: before!.rev,
      baseline: "起點",
    })).rejects.toMatchObject({ code: "CONFLICT" });

    const after = await story.get({ projectId });
    expect(after.story?.content).toBe("共編已落盤");
    expect(after.story?.rev).toBe(persisted.rev);
  });
});
