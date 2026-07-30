/**
 * Agent domain schema（AI 代理執行、事件、副作用、人類任務）
 */
import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { CompletePlanSummary } from "../../../shared/plan";
import type { AgentPlannerTelemetry } from "../../../shared/agentPlanner";

/**
 * AI 代理執行紀錄（代理系統核心）：一句目標 → LLM 規劃多步計畫 → 使用者核准 → 伺服器背景逐步執行。
 * 慣例與 workflowRuns 對齊：steps jsonb 快照、runner 是 steps 的單一寫者、停止只改 run 狀態。
 * 與工作流的差別：步驟由 LLM 針對目標動態規劃（非固定 preset），且要「核准後」才開始花點數。
 */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  /** 使用者的一句目標（例：把知識庫的腳本拆成分鏡並逐鏡出圖） */
  goal: text("goal").notNull(),
  /** LLM 的計畫摘要（核准畫面顯示） */
  summary: text("summary").notNull().default(""),
  /** 結構化完整計畫摘要：成功條件、缺少資訊、假設、風險、里程碑、成本與時程。 */
  planSummary: jsonb("plan_summary").$type<CompletePlanSummary>(),
  /** 規劃供應商／模型／實際 token 與費用；不保存提示詞、原始輸出或 chain-of-thought。 */
  plannerTelemetry: jsonb("planner_telemetry").$type<AgentPlannerTelemetry>(),
  status: text("status", { enum: ["awaiting_approval", "running", "waiting", "done", "failed", "stopped", "discarded"] })
    .notNull()
    .default("awaiting_approval"),
  currentStep: integer("current_step").notNull().default(0),
  /** 每步：見 services/agentRunner 的 AgentStep（kind/note/status/估點/執行期 generationId 等） */
  steps: jsonb("steps").notNull(),
  /** 核准畫面顯示的估點總額；實際扣點仍由各步驟既有守門逐筆進行 */
  estPoints: integer("est_points").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  projectStatusCreatedIdx: index("agent_runs_project_status_created_idx").on(t.projectId, t.status, t.createdAt),
  statusUpdatedIdx: index("agent_runs_status_updated_idx").on(t.status, t.updatedAt),
  userStatusIdx: index("agent_runs_user_status_idx").on(t.userId, t.status),
}));

/** 可稽核代理事件：記錄可驗證的來源、動作、等待、裁決與成果，不保存私密 chain-of-thought。 */
export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id").notNull(),
  stepId: text("step_id"),
  stepIndex: integer("step_index"),
  eventKey: text("event_key").notNull(),
  eventType: text("event_type", {
    enum: [
      "planned",
      "approved",
      "step_started",
      "step_waiting",
      "step_completed",
      "step_failed",
      "human_resumed",
      "approval_rejected",
      "run_completed",
      "run_failed",
      "stopped",
      "discarded",
      "observation",
    ],
  }).notNull(),
  actorType: text("actor_type", { enum: ["ai", "human", "system"] }).notNull().default("system"),
  actorId: uuid("actor_id"),
  summary: text("summary").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  runEventUq: uniqueIndex("agent_events_run_event_uq").on(t.runId, t.eventKey),
  runCreatedIdx: index("agent_events_run_created_idx").on(t.runId, t.createdAt),
  projectCreatedIdx: index("agent_events_project_created_idx").on(t.projectId, t.createdAt),
}));

/**
 * 非建立型代理副作用的永久冪等憑證。
 * create_note/create_schedule 直接以 effectId 當目標資料列 UUID；append_note/update_schedule
 * 則把「內容變更」與此紀錄放在同一交易，避免 COMMIT 後、step 寫回前崩潰造成重複追加／修改。
 */
export const agentStepEffects = pgTable("agent_step_effects", {
  id: uuid("id").primaryKey(),
  runId: uuid("run_id").notNull(),
  stepId: text("step_id").notNull(),
  kind: text("kind").notNull(),
  outputType: text("output_type").notNull(),
  outputId: uuid("output_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  runStepUq: uniqueIndex("agent_step_effects_run_step_uq").on(t.runId, t.stepId),
  runIdx: index("agent_step_effects_run_idx").on(t.runId),
}));

/** AI 與團隊共用的正式人類任務；不是只存在 agent_runs.steps JSON 裡的顯示文字。 */
export const projectTasks = pgTable("project_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id").notNull(),
  planRunId: uuid("plan_run_id"),
  planStepId: text("plan_step_id"),
  /** wait_for_human/request_approval 掛上後，完成／核准會以此喚醒指定步驟。 */
  wakeRunId: uuid("wake_run_id"),
  wakeStepId: text("wake_step_id"),
  taskType: text("task_type", { enum: ["task", "approval"] }).notNull().default("task"),
  title: text("title").notNull(),
  description: text("description"),
  assigneeId: uuid("assignee_id"),
  approverRole: text("approver_role", { enum: ["project_owner", "group_leader", "admin"] }),
  status: text("status", { enum: ["todo", "doing", "waiting", "review", "done", "cancelled"] })
    .notNull()
    .default("todo"),
  priority: text("priority", { enum: ["low", "normal", "high", "urgent"] }).notNull().default("normal"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  dueAt: timestamp("due_at", { withTimezone: true }),
  createdBy: uuid("created_by").notNull(),
  completedBy: uuid("completed_by"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  sourceMessageId: uuid("source_message_id"),
  mentions: jsonb("mentions").$type<string[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  planStepUq: uniqueIndex("project_tasks_plan_step_uq").on(t.planRunId, t.planStepId),
  projectStatusIdx: index("project_tasks_project_status_idx").on(t.projectId, t.status),
  groupStatusIdx: index("project_tasks_group_status_idx").on(t.groupId, t.status),
  assigneeStatusIdx: index("project_tasks_assignee_status_idx").on(t.assigneeId, t.status),
  wakeRunIdx: index("project_tasks_wake_run_idx").on(t.wakeRunId),
}));
