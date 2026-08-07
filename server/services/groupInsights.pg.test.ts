import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { getGroupAgentInsights, AGENT_INSIGHT_LIMITS } from "./agentEventCore";

const RUN_PG = process.env.RUN_PG_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

/**
 * 組級洞察在「任務史很長」的組裡不能失效。
 *
 * 這是對抗式稽核抓到的缺陷：getGroupAgentInsights 取任務時沒帶 openOnly，而
 * listGroupTasks 依 due_at ASC 排序——最早到期的幾乎必然是早就完成的歷史任務。
 * 於是 300 筆預算被 done 佔滿，下游一律先過濾掉它們，結果 openTasks=0、people=[]、
 * pendingApprovalTasks=[]：「誰卡住了」整段不渲染、收件匣漏掉所有人員核准節點。
 *
 * 這個缺陷只在真的有規模時現形，純函式測不出來（純函式收到的是已經取好的列），
 * 所以鎖在真 PostgreSQL 上：塞 320 筆早就完成的任務，再放 3 筆未結的進去。
 */
describe.skipIf(!RUN_PG).sequential("組級洞察：任務史很長的組（real PostgreSQL）", () => {
  const groupId = randomUUID();
  const projectId = randomUUID();
  const userId = randomUUID();
  const runId = randomUUID();
  const auth: AuthState = {
    user: {
      id: userId, name: "Group insight test", email: "group-insight@example.test",
      isSuperAdmin: false, mustChangePassword: false,
    },
    groups: [{ groupId, groupName: "Insight group", teamId: randomUUID(), teamName: "Insight team", role: "leader" }],
    adminTeamIds: [],
  };

  afterAll(async () => {
    await db.delete(schema.projectTasks).where(eq(schema.projectTasks.groupId, groupId));
    await db.delete(schema.agentRuns).where(eq(schema.agentRuns.groupId, groupId));
    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
  });

  it("已完成的舊任務再多，未結任務與人員核准節點都不能被擠掉", async () => {
    await db.insert(schema.projects).values({
      id: projectId, groupId, ownerId: userId,
      title: "任務史很長的專案", kind: "campaign", platform: "test", format: "plan", worldview: {},
    });
    await db.insert(schema.agentRuns).values({
      id: runId, projectId, groupId, userId,
      goal: "等人核准的計畫", status: "waiting", steps: [], estPoints: 0,
    });

    // 超過上限的已完成任務，due_at 全部很舊 → 依 due_at ASC 會排在最前面
    const oldDone = Array.from({ length: AGENT_INSIGHT_LIMITS.tasks + 20 }, (_, i) => ({
      groupId, projectId, createdBy: userId,
      taskType: "task" as const,
      title: `早就做完的任務 ${i}`,
      status: "done" as const,
      priority: "normal" as const,
      dueAt: new Date(Date.UTC(2020, 0, 1) + i * 60_000),
      completedBy: userId,
      completedAt: new Date(Date.UTC(2020, 0, 2)),
    }));
    // 分批插入避免單次參數過多
    for (let i = 0; i < oldDone.length; i += 100) {
      await db.insert(schema.projectTasks).values(oldDone.slice(i, i + 100));
    }

    // 真正該被看見的三件：一件逾期、一件等人核准（掛 wakeRunId）、一件沒設期限
    await db.insert(schema.projectTasks).values([
      {
        groupId, projectId, createdBy: userId, assigneeId: userId,
        taskType: "task", title: "逾期的未結任務", status: "todo", priority: "urgent",
        dueAt: new Date(Date.now() - 3 * 86_400_000),
      },
      {
        groupId, projectId, createdBy: userId, assigneeId: userId,
        wakeRunId: runId, wakeStepId: "step-approval",
        taskType: "approval", title: "等你核准才往下走", status: "waiting", priority: "high",
        dueAt: new Date(Date.now() - 86_400_000),
      },
      {
        groupId, projectId, createdBy: userId,
        taskType: "task", title: "沒設期限的未結任務", status: "todo", priority: "normal",
      },
    ]);

    const insight = await getGroupAgentInsights(auth, groupId);

    // 缺陷版本下這些全都是 0／空——300 筆預算被 2020 年完成的任務吃光
    expect(insight.openTasks).toBe(3);
    expect(insight.overdueTasks).toBe(2);
    expect(insight.pendingApprovalTasks.map((t) => t.title)).toEqual(["等你核准才往下走"]);
    expect(insight.people.some((p) => p.userId === userId && p.openTasks === 2)).toBe(true);
    // 未指派的那件也要獨立成一列，不能被吞掉
    expect(insight.people.some((p) => p.userId === null && p.openTasks === 1)).toBe(true);
    expect(insight.status).toBe("blocked"); // urgent 逾期 → critical
    // 只取未結任務後，300 筆的上限不再被歷史資料吃掉
    expect(insight.truncated.tasks).toBe(false);
  });
});
