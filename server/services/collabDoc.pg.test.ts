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
import { loadStoryDoc, persistStoryDoc, STORY_TEXT_KEY } from "./collabDoc";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

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
    await persistStoryDoc(projectId, groupId, doc, editor);

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
    await persistStoryDoc(projectId, groupId, doc, editor);

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
    await persistStoryDoc(projectId, groupId, doc, editor);
    const [first] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    await persistStoryDoc(projectId, groupId, doc, editor);
    const [second] = await db.select().from(schema.stories).where(eq(schema.stories.projectId, projectId));
    expect(second.rev).toBe(first.rev);
  });

  it("O3. 沒有 stories 列的新專案：persist 會建列——共編不是只能開在已有故事的專案上", async () => {
    const projectId = await newProject(); // 不建 stories
    const doc = await loadStoryDoc(projectId);
    expect(doc.getText(STORY_TEXT_KEY).toString()).toBe("");
    doc.getText(STORY_TEXT_KEY).insert(0, "從零開始的故事");
    await persistStoryDoc(projectId, groupId, doc, editor);
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
});
