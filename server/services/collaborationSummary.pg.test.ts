/**
 * 協作聚合的真資料庫測試。
 *
 * 重點不是「有沒有回傳欄位」，而是三件會讓首頁說謊的事：
 *  1. 組隔離——別組的討論、標注、任務一個字都不能漏進來。
 *  2. 排序——「找我」的順序必須是阻塞程度而不是時間，否則首頁只是另一條 feed。
 *  3. 未解決標注是一支 group-by 算完整組，不是逐專案 N+1。
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import { collaborationSummary } from "./collaborationSummary";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("collaborationSummary（真 PostgreSQL）", () => {
  const groupId = randomUUID();
  const otherGroupId = randomUUID();
  const bruce = randomUUID();
  const weihao = randomUUID();
  const projectA = randomUUID();
  const projectB = randomUUID();
  const otherProject = randomUUID();
  const sceneA = randomUUID();

  beforeAll(async () => {
    await db.insert(schema.users).values([
      { id: bruce, email: `bruce-${bruce}@t.local`, name: "Bruce", passwordHash: "x" },
      { id: weihao, email: `wei-${weihao}@t.local`, name: "韋澔", passwordHash: "x" },
    ]);
    const proj = (id: string, gid: string, title: string) => ({
      id, groupId: gid, ownerId: bruce, title, kind: "video", platform: "youtube", format: "16:9",
    });
    await db.insert(schema.projects).values([
      proj(projectA, groupId, "挑戰營回顧影片"),
      proj(projectB, groupId, "招生短片"),
      proj(otherProject, otherGroupId, "別組的專案"),
    ]);
    await db.insert(schema.scenes).values({ id: sceneA, projectId: projectA, title: "SHOT 08" });

    const msg = (over: Partial<typeof schema.messages.$inferInsert>) => ({
      groupId, userId: weihao, kind: "text" as const, body: "討論", ...over,
    });
    await db.insert(schema.messages).values([
      // 本組：兩則綁到 Shot 08 的未解決標注 + 一則已解決 + 一則一般留言
      msg({ projectId: projectA, kind: "annotation", body: "這裡人物眼神不自然", refType: "scene", refId: sceneA }),
      msg({ projectId: projectA, kind: "annotation", body: "字幕 typo", refType: "scene", refId: sceneA }),
      msg({ projectId: projectA, kind: "annotation", body: "已經改好了", refType: "scene", refId: sceneA, resolvedAt: new Date(), resolvedBy: bruce }),
      msg({ projectId: projectA, body: "開場保留雨聲" }),
      // 別組：一則未解決標注——絕對不可以被算進來
      msg({ groupId: otherGroupId, projectId: otherProject, kind: "annotation", body: "別組的標注" }),
    ]);

    const notif = (over: Partial<typeof schema.notifications.$inferInsert>) => ({
      userId: bruce, groupId, kind: "mention", title: "t", body: "b", url: "/x",
      eventKey: randomUUID(), ...over,
    });
    await db.insert(schema.notifications).values([
      notif({ kind: "mention", actorId: weihao, projectId: projectA, title: "韋澔 @ 了你" }),
      notif({ kind: "reply", actorId: weihao, projectId: projectA, title: "韋澔回覆了你" }),
      notif({ kind: "annotation", actorId: weihao, projectId: projectA, title: "新的標注" }),
      notif({ kind: "generation_done", projectId: projectA, title: "生成完成" }),
      // 已讀的不該進未讀計數
      notif({ kind: "mention", actorId: weihao, title: "看過了", readAt: new Date() }),
    ]);

    await db.insert(schema.projectTasks).values([
      { groupId, projectId: projectA, taskType: "task", title: "重做 Shot 08", assigneeId: bruce, status: "todo", createdBy: weihao },
      { groupId, projectId: projectA, taskType: "approval", title: "核准 V4", assigneeId: bruce, status: "waiting", createdBy: weihao },
      // 指派給別人的不算我的
      { groupId, projectId: projectB, taskType: "task", title: "別人的任務", assigneeId: weihao, status: "todo", createdBy: bruce },
      // 已完成的不算
      { groupId, projectId: projectA, taskType: "task", title: "早就做完", assigneeId: bruce, status: "done", createdBy: bruce },
    ]);
  });

  afterAll(async () => {
    const pids = [projectA, projectB, otherProject];
    await db.delete(schema.projectTasks).where(inArray(schema.projectTasks.projectId, pids));
    await db.delete(schema.messages).where(inArray(schema.messages.projectId, pids));
    await db.delete(schema.notifications).where(inArray(schema.notifications.userId, [bruce, weihao]));
    await db.delete(schema.scenes).where(eq(schema.scenes.id, sceneA));
    await db.delete(schema.projects).where(inArray(schema.projects.id, pids));
    await db.delete(schema.users).where(inArray(schema.users.id, [bruce, weihao]));
  });

  it("首頁的四個數字：未讀提及／回覆、未解決標注、我的任務、待我核准", async () => {
    const s = await collaborationSummary(bruce, groupId);
    expect(s.unreadMentions).toBe(1);
    expect(s.unreadReplies).toBe(1);
    // 兩則未解決；已解決的那則不算，別組的那則也不算
    expect(s.openAnnotations).toBe(2);
    expect(s.myTasks).toBe(1);
    expect(s.pendingApprovals).toBe(1);
  });

  it("組隔離：別組的專案、討論、標注一個字都不會漏進來", async () => {
    const s = await collaborationSummary(bruce, groupId);
    const ids = s.activeProjects.map((p) => p.projectId);
    expect(ids).not.toContain(otherProject);
    expect(s.threads.every((t) => t.projectId !== otherProject)).toBe(true);
    expect(s.recentActivity.every((a) => a.projectId !== otherProject)).toBe(true);
  });

  it("「找我」依阻塞程度排序，不是依時間——待我核准要排在一般提及前面", async () => {
    const s = await collaborationSummary(bruce, groupId);
    const kinds = s.attention.map((a) => a.kind);
    expect(kinds[0]).toBe("approval"); // 我不動，別人就動不了
    // 權重必須是單調遞減的：這就是「阻塞程度優先」的定義
    const weights = s.attention.map((a) => a.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    // 標注（有人指出問題）要排在一般提及與回覆前面
    expect(kinds.indexOf("annotation")).toBeLessThan(kinds.indexOf("mention"));
    expect(kinds.indexOf("mention")).toBeLessThan(kinds.indexOf("generation_done"));
  });

  it("每一則「找我」都帶得出深連結與專案名——點下去要到得了現場", async () => {
    const s = await collaborationSummary(bruce, groupId);
    for (const item of s.attention) {
      expect(item.url.startsWith("/")).toBe(true);
      if (item.projectId === projectA) expect(item.projectTitle).toBe("挑戰營回顧影片");
    }
    // 觸發者的名字要查得出來，否則畫面上只剩下一句沒有主詞的通知
    expect(s.attention.some((a) => a.actorName === "韋澔")).toBe(true);
  });

  it("討論依「專案 × 內容物件」分組，不是一條混在一起的全專案 feed", async () => {
    const s = await collaborationSummary(bruce, groupId);
    const shot = s.threads.find((t) => t.refId === sceneA);
    expect(shot).toBeDefined();
    expect(shot!.label).toBe("分鏡");
    expect(shot!.count).toBe(3); // 三則標注（含已解決）都在這一串裡
    expect(shot!.openAnnotations).toBe(2); // 但只有兩則還沒解決
    // 沒綁內容物件的一般留言自成一串，不會混進 Shot 08
    expect(s.threads.some((t) => t.refId === null && t.projectId === projectA)).toBe(true);
  });

  it("活躍專案帶每專案的未解決標注數——分鏡列的「⚑ N」與首頁同一個來源", async () => {
    const s = await collaborationSummary(bruce, groupId);
    const a = s.activeProjects.find((p) => p.projectId === projectA);
    expect(a?.openAnnotations).toBe(2);
    expect(a?.title).toBe("挑戰營回顧影片");
    // 完全沒有討論、沒有標注、沒有人在的專案不佔首頁版面
    expect(s.activeProjects.some((p) => p.projectId === projectB)).toBe(false);
  });

  it("動態是「發生過什麼」，與收件匣的「有什麼等我處理」分開", async () => {
    const s = await collaborationSummary(bruce, groupId);
    expect(s.recentActivity.length).toBeGreaterThan(0);
    expect(s.recentActivity.every((a) => a.actorName === "韋澔")).toBe(true);
    // 標注在動態裡看得出它是標注，而不是一則普通留言
    expect(s.recentActivity.some((a) => a.summary.startsWith("標注："))).toBe(true);
  });

  it("沒有任何專案的組回空摘要，不炸也不報錯", async () => {
    const emptyGroup = randomUUID();
    const s = await collaborationSummary(bruce, emptyGroup);
    expect(s.openAnnotations).toBe(0);
    expect(s.activeProjects).toEqual([]);
    expect(s.attention).toEqual([]);
  });
});
