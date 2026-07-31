import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { listProjectAgentEvents, recordAgentEvent } from "./agentEventCore";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!RUN_PG).sequential("agent event trace (real PostgreSQL)", () => {
  const runId = randomUUID();
  const actorId = randomUUID();
  const groupId = randomUUID();
  const projectId = randomUUID();
  const auth: AuthState = {
    user: {
      id: actorId,
      name: "Event test",
      email: "event-test@example.test",
      isSuperAdmin: false,
      mustChangePassword: false, uiDensity: null,
    },
    groups: [{
      groupId,
      groupName: "Event group",
      teamId: randomUUID(),
      teamName: "Event team",
      role: "leader",
    }],
    adminTeamIds: [],
  };

  afterAll(async () => {
    await db.delete(schema.agentEvents).where(eq(schema.agentEvents.runId, runId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });

  it("deduplicates the same lifecycle event across concurrent replicas", async () => {
    const input = {
      runId,
      groupId,
      projectId,
      eventKey: "step:research:completed",
      eventType: "step_completed" as const,
      stepId: "research",
      stepIndex: 0,
      actorType: "ai" as const,
      summary: "完成：整理研究筆記",
      data: { outputRefs: [{ type: "note", id: randomUUID() }] },
    };
    await Promise.all([
      recordAgentEvent(input),
      recordAgentEvent(input),
      recordAgentEvent(input),
    ]);

    const rows = await db.select().from(schema.agentEvents).where(eq(schema.agentEvents.runId, runId));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventKey: input.eventKey,
      eventType: "step_completed",
      stepId: "research",
      summary: input.summary,
    });
  });

  it("paginates equal-time events with a stable time+UUID cursor", async () => {
    await db.insert(schema.projects).values({
      id: projectId,
      groupId,
      ownerId: actorId,
      title: "Event pagination",
      kind: "campaign",
      platform: "test",
      format: "plan",
      worldview: {},
    });
    await recordAgentEvent({
      runId,
      groupId,
      projectId,
      eventKey: "run:approved",
      eventType: "approved",
      actorType: "human",
      actorId,
      summary: "已核准",
    });
    await recordAgentEvent({
      runId,
      groupId,
      projectId,
      eventKey: "run:done",
      eventType: "run_completed",
      summary: "已完成",
    });

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 3; pageNo += 1) {
      const page = await listProjectAgentEvents(auth, projectId, { cursor, limit: 1 });
      expect(page.items).toHaveLength(1);
      expect(seen.has(page.items[0].id)).toBe(false);
      seen.add(page.items[0].id);
      cursor = page.nextCursor ?? undefined;
    }
    expect(seen.size).toBe(3);
  });

  /**
   * 回歸鎖：同一毫秒內寫入的事件必須逐筆翻頁，一筆都不能少、也不能重複。
   *
   * 這正是 CI 抓到的實況：背景執行器一次 tick 連寫好幾筆事件，它們的 created_at
   * 只差微秒。舊實作把游標時間戳用 Date.toISOString() 序列化（只有毫秒），
   * 條件 `created_at < 該毫秒` 會把同毫秒內的其餘事件整批跳過；跳過後該頁筆數
   * 不足以判定 truncated，nextCursor 變 null，呼叫端把 null 當「從頭開始」就拿到
   * 重複的第一頁——於是稽核軌跡同時「漏事件」又「重複顯示」。
   *
   * 這裡不靠時間競賽碰運氣，直接寫入六筆刻意落在同一毫秒、只差微秒的事件。
   */
  it("同一毫秒內的多筆事件仍能逐筆翻頁（微秒精度游標）", async () => {
    const denseRunId = randomUUID();
    const denseProjectId = randomUUID();
    await db.insert(schema.projects).values({
      id: denseProjectId,
      groupId,
      ownerId: actorId,
      title: "Dense pagination",
      kind: "campaign",
      platform: "test",
      format: "plan",
      worldview: {},
    });
    // 同一毫秒（.123）內的六個微秒刻度，外加一筆更早的，證明跨毫秒邊界也對
    const micros = ["123100", "123200", "123300", "123400", "123500", "123900"];
    const ids = micros.map(() => randomUUID());
    for (const [i, us] of micros.entries()) {
      await db.insert(schema.agentEvents).values({
        id: ids[i],
        runId: denseRunId,
        groupId,
        projectId: denseProjectId,
        eventKey: `dense:${i}`,
        eventType: "observation",
        summary: `第 ${i + 1} 筆`,
        createdAt: sql`timestamptz '2026-07-30 10:00:00.${sql.raw(us)}+00'`,
      });
    }
    try {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let pageNo = 0; pageNo < micros.length; pageNo += 1) {
        const page = await listProjectAgentEvents(auth, denseProjectId, { cursor, limit: 1 });
        expect(page.items).toHaveLength(1);
        seen.push(page.items[0].id);
        cursor = page.nextCursor ?? undefined;
        // 最後一頁才可以沒有下一頁游標
        if (pageNo < micros.length - 1) expect(cursor).toBeTruthy();
      }
      // 六筆全數到齊、無重複，且順序是由新到舊
      expect(new Set(seen).size).toBe(micros.length);
      expect(seen).toEqual([...ids].reverse());
      expect(cursor).toBeUndefined();

      // 一次抓完也要是同一組，不會少
      const all = await listProjectAgentEvents(auth, denseProjectId, { limit: 100 });
      expect(all.items).toHaveLength(micros.length);
      expect(all.nextCursor).toBeNull();
    } finally {
      await db.delete(schema.agentEvents).where(eq(schema.agentEvents.runId, denseRunId));
      await db.delete(schema.projects).where(eq(schema.projects.id, denseProjectId));
    }
  });

  it("壞掉的游標一律擋下（不會退化成「從頭開始」而重複整頁）", async () => {
    await expect(listProjectAgentEvents(auth, projectId, { cursor: "沒有分隔符" })).rejects.toThrow();
    await expect(listProjectAgentEvents(auth, projectId, { cursor: "not-a-date|abc" })).rejects.toThrow();
    await expect(listProjectAgentEvents(auth, projectId, { cursor: "|" })).rejects.toThrow();
  });
});
