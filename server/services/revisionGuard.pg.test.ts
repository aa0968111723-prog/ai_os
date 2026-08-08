/**
 * 樂觀併發的真資料庫回歸測試（P0：不讓任何人的修改靜默消失）。
 *
 * 這一組**必須打真的 PostgreSQL**：要證明的事情正是「兩個並行的 UPDATE 只有一個會中」，
 * 而那是資料庫列鎖的行為，任何 in-memory 替身都只會測到我們自己寫的 if。
 * 走與其他 *.pg.test.ts 相同的閘門（RUN_PG_INTEGRATION=1 + DATABASE_URL）。
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { applyWithRevision, isRevisionConflictError, RevisionConflictError } from "./revisionGuard";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("revision guard（真 PostgreSQL 併發）", () => {
  const groupId = randomUUID();
  const projectId = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const sceneIds: string[] = [];

  beforeAll(async () => {
    await db.insert(schema.users).values([
      { id: userA, email: `a-${userA}@test.local`, name: "Bruce", passwordHash: "x" },
      { id: userB, email: `b-${userB}@test.local`, name: "韋澔", passwordHash: "x" },
    ]);
    await db.insert(schema.projects).values({
      id: projectId,
      groupId,
      ownerId: userA,
      title: "併發測試專案",
      kind: "video",
      platform: "youtube",
      format: "16:9",
    });
  });

  afterAll(async () => {
    if (sceneIds.length) await db.delete(schema.scenes).where(inArray(schema.scenes.id, sceneIds));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.users).where(inArray(schema.users.id, [userA, userB]));
  });

  async function newScene(fields: Partial<typeof schema.scenes.$inferInsert> = {}) {
    const id = randomUUID();
    sceneIds.push(id);
    const [row] = await db
      .insert(schema.scenes)
      .values({ id, projectId, title: "SHOT 08", prompt: "原始提示詞", voiceover: "原始旁白", ...fields })
      .returning();
    return row;
  }

  const reloadScene = (id: string) => async () => {
    const [fresh] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, id));
    return fresh;
  };

  function edit(row: typeof schema.scenes.$inferSelect, patch: Record<string, unknown>, baseline: Record<string, unknown>) {
    return applyWithRevision({
      entity: "scene" as const,
      table: schema.scenes,
      idColumn: schema.scenes.id,
      revColumn: schema.scenes.rev,
      row,
      patch,
      expectedRev: row.rev,
      baseline,
      reload: reloadScene(row.id),
    });
  }

  it("新列的 rev 從 0 起算，每次更新 +1", async () => {
    const scene = await newScene();
    expect(scene.rev).toBe(0);
    const { row } = await edit(scene, { prompt: "第一次修改" }, { prompt: scene.prompt });
    expect(row.rev).toBe(1);
    const { row: again } = await edit(row, { prompt: "第二次修改" }, { prompt: row.prompt });
    expect(again.rev).toBe(2);
  });

  /* ── 驗收 A：兩人同時改同一格 → 第二個不能靜默覆蓋 ───────────── */

  it("A. 兩人同時改同一欄：第二個人拿到結構化 CONFLICT，第一個人的字還在", async () => {
    const scene = await newScene({ prompt: "共同起點" });
    // 兩人都在 rev=0 時載入這一格，各自打了不同的提示詞。
    const bruceView = scene;
    const weihaoView = scene;

    const { row: afterBruce } = await edit(bruceView, { prompt: "Bruce 寫的提示詞" }, { prompt: "共同起點" });
    expect(afterBruce.prompt).toBe("Bruce 寫的提示詞");

    // 韋澔手上還是 rev=0 的世界觀——這一發**不可以**默默蓋掉 Bruce 的字。
    await expect(
      edit(weihaoView, { prompt: "韋澔寫的提示詞" }, { prompt: "共同起點" }),
    ).rejects.toThrow(RevisionConflictError);

    // 資料庫裡仍然是 Bruce 的版本：沒有任何人的修改被靜默丟掉。
    const [now] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id));
    expect(now.prompt).toBe("Bruce 寫的提示詞");
    expect(now.rev).toBe(1);
  });

  it("A2. 衝突 payload 帶得出「誰改的、改成什麼、哪一欄撞了」——UI 才畫得出人話", async () => {
    const scene = await newScene({ prompt: "共同起點" });
    await edit(scene, { prompt: "Bruce 的版本" }, { prompt: "共同起點" });

    const err = await edit(scene, { prompt: "韋澔的版本" }, { prompt: "共同起點" }).catch((e) => e);
    expect(isRevisionConflictError(err)).toBe(true);
    const { conflict } = err as RevisionConflictError;
    expect(conflict.reason).toBe("REVISION_CONFLICT");
    expect(conflict.entity).toBe("scene");
    expect(conflict.entityId).toBe(scene.id);
    expect(conflict.expectedRev).toBe(0);
    expect(conflict.currentRev).toBe(1);
    expect(conflict.contestedFields).toEqual(["prompt"]);
    // currentData 是現值——前端不必再打一支查詢就能顯示「別人改成什麼」
    expect((conflict.currentData as { prompt: string }).prompt).toBe("Bruce 的版本");
  });

  /* ── 驗收 B：兩人改不同欄位 → 能安全 merge 的不要誤判成整體失敗 ── */

  it("B. 兩人改不同欄位：自動合併，兩份修改都留下來，不拿假衝突煩人", async () => {
    const scene = await newScene({ prompt: "原始提示詞", voiceover: "原始旁白" });
    const bruceView = scene;
    const weihaoView = scene;

    // Bruce 只改提示詞
    await edit(bruceView, { prompt: "Bruce 改的畫面" }, { prompt: "原始提示詞" });
    // 韋澔（仍在 rev=0）只改旁白——rev 撞了，但兩人碰的根本不是同一欄
    const { row, merged } = await edit(weihaoView, { voiceover: "韋澔改的旁白" }, { voiceover: "原始旁白" });

    expect(merged).toBe(true);
    // 關鍵：兩個人的修改**同時**存在。這正是「不要誤判為整體失敗」的意思。
    expect(row.prompt).toBe("Bruce 改的畫面");
    expect(row.voiceover).toBe("韋澔改的旁白");
    expect(row.rev).toBe(2);
  });

  it("B2. 部分可合併、部分真衝突 → 整筆擋下並指出撞在哪一欄（不做半套寫入）", async () => {
    const scene = await newScene({ prompt: "原始提示詞", voiceover: "原始旁白" });
    await edit(scene, { prompt: "Bruce 改的畫面" }, { prompt: "原始提示詞" });

    // 韋澔同時要改 prompt（撞）與 voiceover（沒撞）
    const err = await edit(
      scene,
      { prompt: "韋澔改的畫面", voiceover: "韋澔改的旁白" },
      { prompt: "原始提示詞", voiceover: "原始旁白" },
    ).catch((e) => e);

    expect(isRevisionConflictError(err)).toBe(true);
    const { conflict } = err as RevisionConflictError;
    expect(conflict.contestedFields).toEqual(["prompt"]);
    expect(conflict.mergeableFields).toEqual(["voiceover"]);

    // 沒有半套寫入：既然要問人，就一個欄位都不先寫進去。
    const [now] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id));
    expect(now.prompt).toBe("Bruce 改的畫面");
    expect(now.voiceover).toBe("原始旁白");
  });

  it("B3. 別人已經改成跟我一樣：視為 noop，不製造無謂的衝突卡", async () => {
    const scene = await newScene({ prompt: "原始提示詞" });
    await edit(scene, { prompt: "殊途同歸" }, { prompt: "原始提示詞" });
    const { row, merged } = await edit(scene, { prompt: "殊途同歸" }, { prompt: "原始提示詞" });
    expect(merged).toBe(true);
    expect(row.prompt).toBe("殊途同歸");
  });

  /* ── 併發與相容性 ──────────────────────────────────────── */

  it("真正並行送出同一欄：恰好一個成功、一個拿到衝突（不會兩個都成功）", async () => {
    const scene = await newScene({ prompt: "起點" });
    const results = await Promise.allSettled([
      edit(scene, { prompt: "A 版" }, { prompt: "起點" }),
      edit(scene, { prompt: "B 版" }, { prompt: "起點" }),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(isRevisionConflictError((failed[0] as PromiseRejectedResult).reason)).toBe(true);

    const [now] = await db.select().from(schema.scenes).where(eq(schema.scenes.id, scene.id));
    expect(["A 版", "B 版"]).toContain(now.prompt);
    expect(now.rev).toBe(1); // 只有一次寫入落地
  });

  it("不帶 expectedRev（舊客戶端／背景 runner）行為不變，但 rev 仍會遞增", async () => {
    const scene = await newScene();
    const { row } = await applyWithRevision({
      entity: "scene",
      table: schema.scenes,
      idColumn: schema.scenes.id,
      revColumn: schema.scenes.rev,
      row: scene,
      patch: { prompt: "背景流程寫入" },
      reload: reloadScene(scene.id),
    });
    expect(row.prompt).toBe("背景流程寫入");
    // rev 一定要動：否則有帶 expectedRev 的呼叫端會拿著一個永遠不變的數字，防護等於沒開
    expect(row.rev).toBe(1);
  });

  it("列已被刪除時回 NOT_FOUND 而不是衝突——那是不同一件事，訊息也該不同", async () => {
    const scene = await newScene();
    await db.delete(schema.scenes).where(eq(schema.scenes.id, scene.id));
    const err = await edit(scene, { prompt: "寫給已刪除的格" }, { prompt: scene.prompt }).catch((e) => e);
    expect(isRevisionConflictError(err)).toBe(false);
    expect(String((err as Error).message)).toContain("刪除");
  });

  it("bookkeeping 欄（updatedAt 這類）不參與衝突判定——否則第二次儲存起就永遠跳假衝突", async () => {
    const [story] = await db
      .insert(schema.stories)
      .values({ projectId, groupId, content: "從前從前", updatedBy: userA })
      .returning();
    try {
      const first = await applyWithRevision({
        entity: "story",
        table: schema.stories,
        idColumn: schema.stories.id,
        revColumn: schema.stories.rev,
        row: story,
        patch: { content: "從前從前，有一場雨" },
        bookkeeping: { updatedBy: userA, updatedAt: new Date() },
        expectedRev: story.rev,
        baseline: { content: story.content },
        reload: async () => {
          const [fresh] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
          return fresh;
        },
      });
      // updatedBy/updatedAt 都已經被改過了，但下一次以正確 rev 儲存仍然順利通過
      const second = await applyWithRevision({
        entity: "story",
        table: schema.stories,
        idColumn: schema.stories.id,
        revColumn: schema.stories.rev,
        row: first.row,
        patch: { content: "從前從前，有一場很大的雨" },
        bookkeeping: { updatedBy: userB, updatedAt: new Date() },
        expectedRev: first.row.rev,
        baseline: { content: first.row.content },
        reload: async () => {
          const [fresh] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
          return fresh;
        },
      });
      expect(second.merged).toBe(false);
      expect(second.row.content).toBe("從前從前，有一場很大的雨");
      expect(second.row.rev).toBe(2);
    } finally {
      await db.delete(schema.stories).where(eq(schema.stories.id, story.id));
    }
  });

  it("故事衝突帶得出「是誰改的」——衝突卡要說得出名字", async () => {
    const [story] = await db
      .insert(schema.stories)
      .values({ projectId, groupId, content: "起點", updatedBy: userA })
      .returning();
    try {
      const reload = async () => {
        const [fresh] = await db.select().from(schema.stories).where(eq(schema.stories.id, story.id));
        return fresh;
      };
      const base = {
        entity: "story" as const,
        table: schema.stories,
        idColumn: schema.stories.id,
        revColumn: schema.stories.rev,
        row: story,
        expectedRev: story.rev,
        baseline: { content: "起點" },
        reload,
        updatedByField: "updatedBy" as const,
        updatedAtField: "updatedAt" as const,
      };
      // 韋澔先存
      await applyWithRevision({ ...base, patch: { content: "韋澔的版本" }, bookkeeping: { updatedBy: userB } });
      // Bruce 拿著舊 rev 再存 → 衝突卡要指名是韋澔
      const err = await applyWithRevision({
        ...base,
        patch: { content: "Bruce 的版本" },
        bookkeeping: { updatedBy: userA },
      }).catch((e) => e);
      expect(isRevisionConflictError(err)).toBe(true);
      expect((err as RevisionConflictError).conflict.updatedBy).toMatchObject({ name: "韋澔" });
    } finally {
      await db.delete(schema.stories).where(eq(schema.stories.id, story.id));
    }
  });
});
