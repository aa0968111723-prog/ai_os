import { describe, expect, it } from "vitest";
import {
  assembleAgentInsights,
  assembleGroupAgentInsights,
  type AgentInsightRun,
  type AgentInsightTask,
  classifyAgentHealth,
  collectAgentResults,
  type ProjectAgentBlocker,
} from "./agentEventCore";

describe("agent project insights", () => {
  it("deduplicates outputs emitted by a replayed step", () => {
    const ref = { type: "note", id: "note-1", label: "研究筆記" };
    const results = collectAgentResults([
      {
        id: "run-1",
        steps: [
          { id: "research", note: "研究", status: "done", outputRefs: [ref] },
          { id: "replay", note: "重播", status: "done", outputRefs: [ref] },
        ],
      },
    ]);
    expect(results).toEqual([{
      type: "note",
      id: "note-1",
      label: "研究筆記",
      runId: "run-1",
      stepId: "research",
    }]);
  });

  it("classifies critical blockers, warnings, risks and clean projects", () => {
    const warning: ProjectAgentBlocker = {
      severity: "warning",
      type: "waiting_human",
      label: "等待確認",
    };
    const critical: ProjectAgentBlocker = {
      severity: "critical",
      type: "overdue_task",
      label: "高優先任務逾期",
    };
    expect(classifyAgentHealth([critical], 0)).toBe("blocked");
    expect(classifyAgentHealth([warning], 0)).toBe("attention");
    expect(classifyAgentHealth([], 1)).toBe("attention");
    expect(classifyAgentHealth([], 0)).toBe("healthy");
  });
});

/**
 * S2 抽出 assembleAgentInsights 時的回歸鎖。
 *
 * 這段判斷原本埋在 getProjectAgentInsights 的函式體內，抽成純函式供組級共用；
 * 抽取本身不該改變任何一個欄位，所以這裡逐欄比對一份涵蓋全部分支的 fixture：
 * 逾期（高／低優先 → critical／warning）、等待人員、等待核准、近期失敗、
 * 過舊失敗（不算）、待補資訊、風險、AI 步驟與人類任務的工作項、產出去重。
 */
describe("assembleAgentInsights（抽取後的回歸鎖：逐欄比對）", () => {
  const NOW = Date.parse("2026-07-30T12:00:00Z");
  const at = (days: number) => new Date(NOW - days * 86_400_000);

  const run = (over: Partial<AgentInsightRun>): AgentInsightRun => ({
    id: "run-x", projectId: "p1", goal: "目標", status: "running",
    error: null, updatedAt: at(1), steps: [], planSummary: null, ...over,
  });
  const task = (over: Partial<AgentInsightTask>): AgentInsightTask => ({
    id: "task-x", projectId: "p1", title: "任務", status: "open", priority: "normal",
    taskType: "todo", dueAt: null, planRunId: null, wakeRunId: null, assigneeId: null, ...over,
  });

  const runs: AgentInsightRun[] = [
    run({
      id: "run-active", status: "running",
      steps: [
        { id: "s1", title: "產出分鏡", status: "running", actorType: "ai", outputRefs: [{ type: "scene", id: "sc-1", label: "第一鏡" }] },
        { id: "s2", title: "等待審核", status: "waiting", actorType: "human" },
        { id: "s3", title: "已完成", status: "done", actorType: "ai", outputRefs: [{ type: "scene", id: "sc-1", label: "重複產出" }] },
      ],
      planSummary: { goal: "g", missingInformation: ["缺角色設定"], risks: ["風險一", "風險二"] } as never,
    }),
    run({ id: "run-waiting", status: "waiting", goal: "等人的計畫" }),
    run({ id: "run-failed-recent", status: "failed", error: "供應商逾時", updatedAt: at(2) }),
    run({ id: "run-failed-old", status: "failed", error: "很久以前", updatedAt: at(30) }),
    run({ id: "run-done", status: "done", updatedAt: at(1) }),
  ];
  const tasks: AgentInsightTask[] = [
    task({ id: "t-overdue-urgent", title: "急件逾期", priority: "urgent", dueAt: at(3), planRunId: "run-active" }),
    task({ id: "t-overdue-normal", title: "一般逾期", priority: "normal", dueAt: at(1) }),
    task({ id: "t-wake-approval", title: "等你核准", taskType: "approval", wakeRunId: "run-waiting", dueAt: new Date(NOW + 86_400_000) }),
    task({ id: "t-done", title: "已完成", status: "done" }),
    task({ id: "t-cancelled", title: "已取消", status: "cancelled" }),
  ];

  const insights = assembleAgentInsights(runs, tasks, { nowMs: NOW });

  it("計數欄位逐一固定", () => {
    expect(insights.status).toBe("blocked");        // 有 critical（急件逾期＋近期失敗）
    expect(insights.activeRuns).toBe(2);            // running + waiting（awaiting_approval 也算，本例沒有）
    expect(insights.waitingRuns).toBe(1);
    expect(insights.openTasks).toBe(3);             // done/cancelled 不算
    expect(insights.overdueTasks).toBe(2);
    expect(insights.recentFailures).toBe(1);        // 過舊那筆不算
    expect(insights.unresolvedInformation).toBe(1);
    expect(insights.risks).toBe(2);
  });

  it("阻塞清單的順序、分級與關聯 id 固定", () => {
    expect(insights.blockers).toEqual([
      { severity: "critical", type: "overdue_task", label: "任務逾期：急件逾期", taskId: "t-overdue-urgent", runId: "run-active" },
      { severity: "warning", type: "overdue_task", label: "任務逾期：一般逾期", taskId: "t-overdue-normal", runId: undefined },
      { severity: "warning", type: "waiting_human", label: "等待核准：等你核准", taskId: "t-wake-approval", runId: "run-waiting" },
      { severity: "critical", type: "failed_run", label: "代理失敗：供應商逾時", runId: "run-failed-recent" },
      { severity: "warning", type: "missing_information", label: "計畫仍有待補資訊：目標", runId: "run-active" },
    ]);
  });

  it("產出去重（同一 type:id 只留第一次），且涵蓋非 active 的 run", () => {
    expect(insights.results).toEqual([
      { type: "scene", id: "sc-1", label: "第一鏡", runId: "run-active", stepId: "s1" },
    ]);
  });

  it("工作項＝未結任務 ＋ active run 的未完成 AI 步驟（human 步驟不重複列）", () => {
    expect(insights.workItems.map((w) => w.id)).toEqual([
      "human:t-overdue-urgent", "human:t-overdue-normal", "human:t-wake-approval",
      "ai:run-active:s1",
    ]);
    expect(insights.workItems[0]).toEqual({
      id: "human:t-overdue-urgent", kind: "human", title: "急件逾期", status: "open",
      runId: "run-active", taskId: "t-overdue-urgent", assigneeId: undefined, dueAt: at(3),
    });
  });

  it("截斷旗標由呼叫端傳入，未截斷時全 false", () => {
    expect(insights.truncated).toEqual({ runs: false, tasks: false, results: false, workItems: false });
    expect(assembleAgentInsights(runs, tasks, { nowMs: NOW, runsTruncated: true }).truncated.runs).toBe(true);
  });

  it("空輸入 → healthy、全 0（專案頁空狀態的既有語意不變）", () => {
    const empty = assembleAgentInsights([], [], { nowMs: NOW });
    expect(empty.status).toBe("healthy");
    expect(empty.activeRuns + empty.openTasks + empty.recentFailures + empty.risks).toBe(0);
    expect(empty.blockers).toEqual([]);
  });
});

/**
 * S2：組級洞察。判斷完全交給 assembleAgentInsights（同一套「什麼算阻塞」的規則），
 * 這裡只驗多出來的兩層歸屬：阻塞歸專案、未結任務歸人，以及等人裁決的核准節點明列。
 */
describe("assembleGroupAgentInsights（組級歸屬）", () => {
  const NOW = Date.parse("2026-07-30T12:00:00Z");
  const at = (days: number) => new Date(NOW - days * 86_400_000);
  const titles = new Map([["p1", "招生短片"], ["p2", "社課回顧"]]);

  const runs: AgentInsightRun[] = [
    { id: "r1", projectId: "p1", goal: "拆分鏡", status: "running", error: null, updatedAt: at(1), steps: [], planSummary: null },
    { id: "r2", projectId: "p2", goal: "等人的計畫", status: "waiting", error: null, updatedAt: at(1), steps: [], planSummary: null },
    { id: "r3", projectId: "p2", goal: "掛了", status: "failed", error: "供應商逾時", updatedAt: at(1), steps: [], planSummary: null },
    { id: "r4", projectId: "p1", goal: "早就完成", status: "done", error: null, updatedAt: at(1), steps: [], planSummary: null },
  ];
  const task = (over: Partial<AgentInsightTask & { assigneeName: string; projectTitle: string }>) => ({
    id: "t", projectId: "p1", title: "任務", status: "todo", priority: "normal", taskType: "task",
    dueAt: null as Date | null, planRunId: null, wakeRunId: null, assigneeId: null,
    assigneeName: null as string | null, projectTitle: "招生短片", ...over,
  });
  const tasks = [
    task({ id: "t1", assigneeId: "u1", assigneeName: "阿光", dueAt: at(3), priority: "urgent" }),
    task({ id: "t2", assigneeId: "u1", assigneeName: "阿光", dueAt: at(1) }),
    task({ id: "t3", assigneeId: "u2", assigneeName: "小美", dueAt: new Date(NOW + 86_400_000) }),
    task({ id: "t4", assigneeId: null, projectId: "p2", projectTitle: "社課回顧" }),
    task({ id: "t5", projectId: "p2", projectTitle: "社課回顧", taskType: "approval", wakeRunId: "r2", assigneeId: "u2", assigneeName: "小美", dueAt: at(2), title: "確認旁白稿" }),
    task({ id: "t6", status: "done", assigneeId: "u1", assigneeName: "阿光" }),
  ];
  const g = assembleGroupAgentInsights(runs, tasks, titles, { nowMs: NOW });

  it("基底計數與專案級同一套規則", () => {
    expect(g.openTasks).toBe(5);       // t6 已完成不算
    expect(g.overdueTasks).toBe(3);    // t1/t2/t5
    expect(g.recentFailures).toBe(1);
    expect(g.status).toBe("blocked");  // t1 是 urgent 逾期 → critical
  });

  it("依人員歸屬：逾期多的排前面，未指派獨立成一列（不被吞掉）", () => {
    expect(g.people).toEqual([
      { userId: "u1", name: "阿光", openTasks: 2, overdueTasks: 2, earliestDueAt: at(3) },
      { userId: "u2", name: "小美", openTasks: 2, overdueTasks: 1, earliestDueAt: at(2) },
      { userId: null, name: null, openTasks: 1, overdueTasks: 0, earliestDueAt: null },
    ]);
    expect(g.peopleTruncated).toBe(false);
  });

  it("依專案歸屬：嚴重阻塞多的排前面，計數與 blockers 對得上", () => {
    const p1 = g.byProject.find((p) => p.projectId === "p1")!;
    const p2 = g.byProject.find((p) => p.projectId === "p2")!;
    expect(p1.criticalBlockers).toBe(1);              // t1 urgent 逾期
    expect(p1.openTasks).toBe(3);                     // t1/t2/t3
    expect(p1.activeRuns).toBe(1);                    // r1 running（r4 done 不算）
    expect(p2.criticalBlockers).toBe(1);              // r3 近期失敗
    expect(p2.overdueTasks).toBe(1);                  // t5
    // 嚴重數相同（各 1）時比阻塞總數：p2 有 3 項（t5 逾期＋t5 等核准＋r3 失敗），p1 有 2 項
    expect(p1.blockers).toBe(2);
    expect(p2.blockers).toBe(3);
    expect(g.byProject.map((p) => p.projectId)).toEqual(["p2", "p1"]);
    // 每一項阻塞都要歸得到專案，總和不能少
    expect(g.byProject.reduce((s, p) => s + p.blockers, 0)).toBe(g.blockers.length);
  });

  it("等人裁決的核准節點明列（只收 taskType=approval 且掛著 wakeRunId 的）", () => {
    expect(g.pendingApprovalTasks).toEqual([{
      taskId: "t5", projectId: "p2", projectTitle: "社課回顧", title: "確認旁白稿",
      dueAt: at(2), assigneeId: "u2", assigneeName: "小美", runId: "r2",
    }]);
  });

  it("查不到標題的專案用 id 前綴當替代，不會整列消失", () => {
    const orphan = assembleGroupAgentInsights(
      [{ id: "rx", projectId: "p9", goal: "g", status: "running", error: null, updatedAt: at(1), steps: [], planSummary: null }],
      [task({ id: "tx", projectId: "p9", projectTitle: undefined as never, dueAt: at(1) })],
      new Map(),
      { nowMs: NOW },
    );
    expect(orphan.byProject[0].projectTitle).toBe("專案 p9");
  });

  it("空組 → 兩層歸屬都是空陣列，不是 undefined", () => {
    const empty = assembleGroupAgentInsights([], [], new Map(), { nowMs: NOW });
    expect(empty.people).toEqual([]);
    expect(empty.byProject).toEqual([]);
    expect(empty.pendingApprovalTasks).toEqual([]);
    expect(empty.status).toBe("healthy");
  });
});

/**
 * S3：代理產出與計畫疑慮。兩者都由既有欄位（collectAgentResults 的輸出與
 * planSummary）折出來，不新增任何查詢——這裡驗的是歸屬與篩選是否正確。
 */
describe("assembleGroupAgentInsights：代理產出與計畫疑慮（S3）", () => {
  const NOW = Date.parse("2026-07-30T12:00:00Z");
  const at = (days: number) => new Date(NOW - days * 86_400_000);
  const titles = new Map([["p1", "招生短片"], ["p2", "社課回顧"]]);
  const mkRun = (over: Partial<AgentInsightRun>): AgentInsightRun => ({
    id: "r", projectId: "p1", goal: "目標", status: "running",
    error: null, updatedAt: at(1), steps: [], planSummary: null, ...over,
  });

  it("產出帶回專案歸屬，點得回產生它的那一步", () => {
    const g = assembleGroupAgentInsights(
      [
        mkRun({ id: "r1", projectId: "p1", steps: [
          { id: "s1", title: "拆分鏡", status: "done", outputRefs: [{ type: "scene", id: "sc-1", label: "第一鏡" }] },
        ] }),
        mkRun({ id: "r2", projectId: "p2", status: "done", steps: [
          { id: "s9", title: "寫筆記", status: "done", outputRefs: [{ type: "note", id: "n-1", label: "訪談重點" }] },
        ] }),
      ],
      [],
      titles,
      { nowMs: NOW },
    );
    expect(g.groupResults).toEqual([
      { type: "scene", id: "sc-1", label: "第一鏡", runId: "r1", stepId: "s1", projectId: "p1", projectTitle: "招生短片" },
      { type: "note", id: "n-1", label: "訪談重點", runId: "r2", stepId: "s9", projectId: "p2", projectTitle: "社課回顧" },
    ]);
  });

  it("計畫疑慮只看進行中的計畫，且依總數排序", () => {
    const g = assembleGroupAgentInsights(
      [
        mkRun({ id: "r1", projectId: "p1", status: "running", goal: "少一點",
          planSummary: { goal: "g", missingInformation: ["a"], risks: [] } as never }),
        mkRun({ id: "r2", projectId: "p2", status: "awaiting_approval", goal: "多一點",
          planSummary: { goal: "g", missingInformation: ["a", "b"], risks: ["x"] } as never }),
        // 已完成的計畫即使留著待補資訊也不再是待辦
        mkRun({ id: "r3", projectId: "p1", status: "done", goal: "已完成",
          planSummary: { goal: "g", missingInformation: ["c"], risks: ["y"] } as never }),
        // 沒有疑慮的不列
        mkRun({ id: "r4", projectId: "p1", status: "running", goal: "很乾淨",
          planSummary: { goal: "g", missingInformation: [], risks: [] } as never }),
      ],
      [],
      titles,
      { nowMs: NOW },
    );
    expect(g.planConcerns.map((c) => c.runId)).toEqual(["r2", "r1"]);
    expect(g.planConcerns[0]).toEqual({
      runId: "r2", projectId: "p2", projectTitle: "社課回顧", goal: "多一點",
      missingInformation: 2, risks: 1,
    });
    // 與基底的兩個數字對得上（都只算進行中的計畫）
    expect(g.unresolvedInformation).toBe(3);
    expect(g.risks).toBe(1);
  });

  it("查不到來源 run 的產出不會憑空生出專案歸屬", () => {
    const g = assembleGroupAgentInsights([], [], titles, { nowMs: NOW });
    expect(g.groupResults).toEqual([]);
    expect(g.planConcerns).toEqual([]);
  });
});
