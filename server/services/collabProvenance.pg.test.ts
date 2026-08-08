/**
 * 留言生命週期 provenance 鏈的真資料庫測試（場景 4）：
 *
 *   Bruce 留言「這一格節奏再慢一點」
 *   → 轉成任務、指派韋澔（sourceMessageId 記錄）
 *   → 韋澔被通知（task_assigned，收件匣先落列）
 *   → 韋澔完成
 *   → Bruce 被通知（task_completed，深連結**跳回原討論串**）
 *   → Bruce 定案進 Decision Log（sourceMessageId 記錄、原留言標成「決策」）
 *
 * 資料鏈的每一環都在 DB 裡驗——鏈斷了 UI 看不出來，只有這裡看得出來。
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { addProjectTaskCore, completeProjectTaskCore } from "./taskCore";
import type { AuthState } from "./auth";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("協作 provenance 鏈（真 PostgreSQL）", () => {
  const teamId = randomUUID();
  const groupId = randomUUID();
  const bruce = randomUUID();
  const weihao = randomUUID();
  const projectId = randomUUID();
  let messageId = "";

  const authOf = (userId: string, name: string): AuthState => ({
    user: { id: userId, name, email: `${name}@t.local`, isSuperAdmin: false } as AuthState["user"],
    groups: [{ groupId, groupName: "組", role: "member" }] as AuthState["groups"],
  } as AuthState);

  beforeAll(async () => {
    await db.insert(schema.teams).values({ id: teamId, name: "驗證團隊" });
    await db.insert(schema.groups).values({ id: groupId, teamId, name: "provenance 組" });
    await db.insert(schema.users).values([
      { id: bruce, email: `bruce-${bruce}@t.local`, name: "Bruce", passwordHash: "x" },
      { id: weihao, email: `wei-${weihao}@t.local`, name: "韋澔", passwordHash: "x" },
    ]);
    await db.insert(schema.groupMembers).values([
      { groupId, userId: bruce, role: "leader" },
      { groupId, userId: weihao, role: "member" },
    ]);
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: bruce, title: "挑戰營回顧影片",
      kind: "video", platform: "youtube", format: "16:9",
    });
    const [msg] = await db.insert(schema.messages).values({
      groupId, projectId, userId: bruce, kind: "text", body: "這一格節奏再慢一點",
    }).returning();
    messageId = msg.id;
  });

  afterAll(async () => {
    await db.delete(schema.notifications).where(inArray(schema.notifications.userId, [bruce, weihao]));
    await db.delete(schema.projectTasks).where(eq(schema.projectTasks.projectId, projectId));
    await db.delete(schema.decisions).where(eq(schema.decisions.projectId, projectId));
    await db.delete(schema.messages).where(eq(schema.messages.projectId, projectId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    await db.delete(schema.groupMembers).where(eq(schema.groupMembers.groupId, groupId));
    await db.delete(schema.users).where(inArray(schema.users.id, [bruce, weihao]));
    await db.delete(schema.groups).where(eq(schema.groups.id, groupId));
    await db.delete(schema.teams).where(eq(schema.teams.id, teamId));
  });

  /** notify 是 fire-and-forget（不 await）——輪詢收件匣直到落列，不用固定 sleep 賭時序 */
  async function waitNotification(userId: string, eventKey: string) {
    for (let i = 0; i < 40; i++) {
      const rows = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.userId, userId));
      const hit = rows.find((r) => r.eventKey === eventKey);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  let taskId = "";

  it("留言 → 任務：sourceMessageId 記錄 provenance，韋澔收到 task_assigned", async () => {
    const task = await addProjectTaskCore({
      auth: authOf(bruce, "Bruce"),
      groupId,
      projectId,
      title: "這一格節奏再慢一點",
      assigneeId: weihao,
      sourceMessageId: messageId,
    });
    taskId = task.id;
    // 鏈的第一環：任務指得回原留言
    expect(task.sourceMessageId).toBe(messageId);
    // 韋澔的收件匣（先落列——推播只是加速通道）
    const n = await waitNotification(weihao, `task_assigned:${task.id}`);
    expect(n).not.toBeNull();
    expect(n!.kind).toBe("task_assigned");
    expect(n!.title).toContain("Bruce");
  });

  it("韋澔完成 → Bruce 收到 task_completed，深連結**跳回原討論串**", async () => {
    await completeProjectTaskCore(authOf(weihao, "韋澔"), taskId);
    const n = await waitNotification(bruce, `task_settled:${taskId}`);
    expect(n).not.toBeNull();
    expect(n!.kind).toBe("task_completed");
    expect(n!.title).toContain("韋澔");
    // 這一環是整條鏈的回程：原提議者要回去按「✓ 解決」，
    // 深連結若只到專案首頁，鏈就在倒數第二步斷掉
    expect(n!.url).toBe(`/p/${projectId}?focus=messages&mid=${messageId}`);
  });

  it("自己完成自己建的任務不通知——那是待辦清單，不是協作", async () => {
    const own = await addProjectTaskCore({
      auth: authOf(bruce, "Bruce"),
      groupId, projectId,
      title: "自己的待辦",
      assigneeId: bruce,
    });
    // 指派給自己也不該有 task_assigned
    await new Promise((r) => setTimeout(r, 300));
    const assigned = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, bruce));
    expect(assigned.some((n) => n.eventKey === `task_assigned:${own.id}`)).toBe(false);
    await completeProjectTaskCore(authOf(bruce, "Bruce"), own.id);
    await new Promise((r) => setTimeout(r, 300));
    const settled = await db.select().from(schema.notifications).where(eq(schema.notifications.userId, bruce));
    expect(settled.some((n) => n.eventKey === `task_settled:${own.id}`)).toBe(false);
  });

  it("定案：decisions 列存 sourceMessageId，原留言的 intent 被回寫成「決策」", async () => {
    const [decision] = await db.insert(schema.decisions).values({
      groupId, projectId,
      title: "這一格節奏放慢，用 V4",
      refType: "scene", refId: randomUUID(),
      sourceMessageId: messageId,
      decidedBy: bruce,
    }).returning();
    // router 的 create 會做這一步；這裡驗 schema 允許整條鏈存在
    await db.update(schema.messages).set({ intent: "decision" }).where(eq(schema.messages.id, messageId));

    const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId));
    expect(msg.intent).toBe("decision");
    expect(decision.sourceMessageId).toBe(messageId);
    // 撤銷是標記不是刪除
    await db.update(schema.decisions).set({ revokedAt: new Date(), revokedBy: weihao }).where(eq(schema.decisions.id, decision.id));
    const [after] = await db.select().from(schema.decisions).where(eq(schema.decisions.id, decision.id));
    expect(after).toBeDefined();
    expect(after.revokedAt).not.toBeNull();
    expect(after.title).toBe("這一格節奏放慢，用 V4");
  });
});
