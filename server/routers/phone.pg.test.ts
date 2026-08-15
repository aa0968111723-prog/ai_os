/**
 * 手機唯讀彙總（真 PostgreSQL）。
 *
 * 為什麼要接真資料庫：這支 router 的每一條保證都落在 SQL 上——回收桶要濾掉、
 * `count(nullable)` 要真的只算非 null、`filter (where …)` 的語法要 PostgreSQL 吃得下、
 * 群組隔離要真的擋得住。用假的 db 寫這些等於在測我自己寫的 stub。
 *
 * 這裡實測過的一個真缺陷：分鏡計數原本沒有濾 `scenes.deletedAt`，使用者把一鏡
 * 丟進回收桶之後，手機顯示的分母比專案頁多一鏡——不會報錯、不會有人發現。
 *
 * RUN_PG_INTEGRATION=1 DATABASE_URL=… npx vitest run server/routers/phone.pg.test.ts
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { markBootReady } from "../services/boot";
import { phoneRouter } from "./phone";
import type { AuthState } from "../services/auth";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);
const d = RUN_PG ? describe : describe.skip;

// authedProcedure 在 boot 就緒前一律回 PRECONDITION_FAILED（避免使用者看到
// raw「relation does not exist」）。測試程序沒有跑過 server/index.ts 的開機流程，
// 得自己把旗標打開，否則測到的全是那道閘門而不是 router 本身。
if (RUN_PG) markBootReady();

function authFor(userId: string, groupId: string): AuthState {
  return {
    user: { id: userId, name: "phone", email: `${userId}@t.test`, isSuperAdmin: false, mustChangePassword: false },
    groups: [{ groupId, groupName: "g", teamId: randomUUID(), teamName: "t", role: "leader" }],
    adminTeamIds: [],
  };
}

/** 與其他 pg 測試同一套：不建 group/team 列，直接用隨機 id（這幾張表沒有 FK 約束） */
async function seedProject(title = "手機彙總測試") {
  const userId = randomUUID();
  const groupId = randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    name: "Phone test",
    email: `phone-${userId}@example.test`,
    passwordHash: "test-only",
  });
  const [project] = await db
    .insert(schema.projects)
    .values({ groupId, ownerId: userId, title, kind: "video", platform: "test", format: "9:16" })
    .returning();
  return { project, userId, groupId, ctx: { auth: authFor(userId, groupId) } };
}

async function addAsset(projectId: string, groupId: string, kind: string, title: string) {
  const [asset] = await db
    .insert(schema.assets)
    .values({ projectId, groupId, kind, title, url: `/api/assets/${randomUUID()}.bin` })
    .returning();
  return asset;
}

d("phone router（真 PostgreSQL）", () => {
  it("分鏡計數濾掉回收桶裡的鏡", async () => {
    const { project, groupId, ctx } = await seedProject();
    const visual = await addAsset(project.id, groupId, "image", "畫面");
    // 三鏡：兩鏡有畫面，其中一鏡稍後丟進回收桶
    const rows = await db.insert(schema.scenes).values([
      { projectId: project.id, orderIndex: 1, title: "一", assetId: visual.id },
      { projectId: project.id, orderIndex: 2, title: "二", assetId: visual.id },
      { projectId: project.id, orderIndex: 3, title: "三" },
    ]).returning();
    await db.update(schema.scenes).set({ deletedAt: new Date() }).where(eq(schema.scenes.id, rows[1].id));

    const caller = phoneRouter.createCaller(ctx as never);
    const detail = await caller.project({ projectId: project.id });
    // 刪掉的那一鏡不能出現在任何一個數字裡
    expect(detail.progress.shots).toBe(2);
    expect(detail.progress.shotsWithVisual).toBe(1);

    const home = await caller.home({ groupId });
    const listed = home.projects.find((p) => p.id === project.id);
    expect(listed?.shots).toBe(2);
    expect(listed?.shotsWithVisual).toBe(1);
  });

  it("最近素材只回圖片，也不回收回收桶裡的", async () => {
    const { project, groupId, ctx } = await seedProject();
    await addAsset(project.id, groupId, "image", "留著的圖");
    await addAsset(project.id, groupId, "audio", "旁白音檔");
    await addAsset(project.id, groupId, "video", "毛片");
    const trashed = await addAsset(project.id, groupId, "image", "丟掉的圖");
    await db.update(schema.assets).set({ deletedAt: new Date() }).where(eq(schema.assets.id, trashed.id));

    const detail = await phoneRouter.createCaller(ctx as never).project({ projectId: project.id });
    // 這些值直接餵進 <img>：混進音檔就是一格永遠載不出來的破圖
    expect(detail.recentAssets.map((a) => a.title)).toEqual(["留著的圖"]);
    // 但「素材總數」算的是全部未刪素材，不只圖片
    expect(detail.progress.assets).toBe(3);
  });

  it("階段推導吃的是真的資料（沒有故事、沒有畫面 → 視覺）", async () => {
    const { project, groupId, ctx } = await seedProject();
    await db.insert(schema.scenes).values([
      { projectId: project.id, orderIndex: 1, title: "一" },
      { projectId: project.id, orderIndex: 2, title: "二" },
    ]);
    const caller = phoneRouter.createCaller(ctx as never);
    expect((await caller.project({ projectId: project.id })).stage).toBe("visual");

    const home = await caller.home({ groupId });
    expect(home.projects.find((p) => p.id === project.id)?.stage).toBe("visual");
  });

  it("待裁決的生成會被算出來", async () => {
    const { project, groupId, userId, ctx } = await seedProject();
    await db.insert(schema.generations).values([
      { projectId: project.id, groupId, userId, modelId: "m", kind: "image", prompt: "p", status: "awaiting_approval" },
      { projectId: project.id, groupId, userId, modelId: "m", kind: "image", prompt: "p", status: "awaiting_approval" },
      { projectId: project.id, groupId, userId, modelId: "m", kind: "image", prompt: "p", status: "done" },
    ]);
    const caller = phoneRouter.createCaller(ctx as never);
    const detail = await caller.project({ projectId: project.id });
    expect(detail.progress.awaitingGenerations).toBe(2);
    expect(detail.progress.generationsDone).toBe(1);

    const home = await caller.home({ groupId });
    expect(home.totalAwaiting).toBe(2);
  });

  it("換一個組的人拿不到這個專案（隔離不是靠前端）", async () => {
    const { project } = await seedProject();
    const outsider = { auth: authFor(randomUUID(), randomUUID()) };
    await expect(
      phoneRouter.createCaller(outsider as never).project({ projectId: project.id }),
    ).rejects.toThrow();
  });

  it("拿別組的 groupId 呼叫 home 會被擋下", async () => {
    const { ctx } = await seedProject();
    await expect(
      phoneRouter.createCaller(ctx as never).home({ groupId: randomUUID() }),
    ).rejects.toThrow();
  });

  it("找不到的專案回 NOT_FOUND，而不是空殼", async () => {
    const { ctx } = await seedProject();
    await expect(
      phoneRouter.createCaller(ctx as never).project({ projectId: randomUUID() }),
    ).rejects.toThrow(/找不到專案/);
  });

  it("封存的專案不列在首頁，但仍打得開", async () => {
    const { project, groupId, ctx } = await seedProject("要封存的");
    await db.update(schema.projects).set({ status: "archived" }).where(eq(schema.projects.id, project.id));
    const caller = phoneRouter.createCaller(ctx as never);
    expect((await caller.home({ groupId })).projects.map((p) => p.id)).not.toContain(project.id);
    // 直接開網址仍要看得到（封存不是刪除）
    expect((await caller.project({ projectId: project.id })).stage).toBe("deliver");
  });

  it("limit 真的限制筆數，且預設是首屏的一小撮", async () => {
    const { groupId, userId, ctx } = await seedProject("第一個");
    for (let i = 0; i < 7; i++) {
      await db.insert(schema.projects).values({
        groupId, ownerId: userId, title: `專案 ${i}`, kind: "video", platform: "test", format: "9:16",
      });
    }
    const caller = phoneRouter.createCaller(ctx as never);
    expect((await caller.home({ groupId })).projects.length).toBe(5);
    expect((await caller.home({ groupId, limit: 8 })).projects.length).toBe(8);
  });
});
