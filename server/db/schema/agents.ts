/**
 * Agent domain schema（AI 代理執行、事件、副作用、人類任務）
 */
import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { CompletePlanSummary } from "../../../shared/plan";
import type { AgentPlannerTelemetry } from "../../../shared/agentPlanner";
import type {
  AgentContextSlots,
  AgentQuestionAnswer,
  AgentQuestionContext,
  AgentQuestionOption,
  AgentQuestionType,
} from "../../../shared/agentQuestions";

/**
 * AI 代理執行紀錄（代理系統核心）：一句目標 → LLM 規劃多步計畫 → 使用者核准 → 伺服器背景逐步執行。
 * 慣例與 workflowRuns 對齊：steps jsonb 快照、runner 是 steps 的單一寫者、停止只改 run 狀態。
 * 與工作流的差別：步驟由 LLM 針對目標動態規劃（非固定 preset），且要「核准後」才開始花點數。
 */
export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Null only while a group-scoped Assistant run is asking which project to use. */
  projectId: uuid("project_id"),
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
  traceSessionId: uuid("trace_session_id"),
  status: text("status", { enum: [
    "awaiting_approval", "running", "waiting", "waiting_user_input",
    "waiting_confirmation", "waiting_permission", "paused", "user_controlled",
    "done", "failed", "stopped", "discarded",
  ] })
    .notNull()
    .default("awaiting_approval"),
  currentStep: integer("current_step").notNull().default(0),
  /** Durable values resolved from URL/context or a validated human answer. */
  contextSlots: jsonb("context_slots").$type<AgentContextSlots>().notNull().default({}),
  /** The single pending clarification/confirmation currently suspending this run. */
  activeQuestionId: uuid("active_question_id"),
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
  // 組級查詢（teamAssistant.agentOverview 的清單＋整組計數、list_agent_runs 工具）原本沒有任何
  // group_id 前綴索引 → 每次打開作業台都全表掃描 agent_runs。加上 updated_at 後綴讓清單的
  // 「近期優先」排序也能靠索引取前幾筆。
  groupUpdatedIdx: index("agent_runs_group_updated_idx").on(t.groupId, t.updatedAt),
}));

/** Persistent Assistant WATCH registrations. Evaluation reuses existing project data and notifications. */
export const assistantWatches = pgTable("assistant_watches", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  projectId: uuid("project_id").notNull(),
  userId: uuid("user_id").notNull(),
  kind: text("kind", { enum: [
    "deadline_approaching", "overdue_task", "generation_failed", "missing_asset",
    "approval_waiting", "agent_blocked", "storyboard_incomplete",
  ] }).notNull(),
  label: text("label").notNull(),
  active: boolean("active").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
  lastFingerprint: text("last_fingerprint"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  userProjectKindUq: uniqueIndex("assistant_watches_user_project_kind_uq").on(t.userId, t.projectId, t.kind),
  activeCheckedIdx: index("assistant_watches_active_checked_idx").on(t.active, t.lastCheckedAt),
  projectIdx: index("assistant_watches_project_idx").on(t.projectId),
}));

/**
 * 組代理計畫（campaign）：組代理自己的多步調度計畫——派工到各專案、盯著子計畫、
 * 在授權內補救、找人、下結論。與 agent_runs 的關係是「指揮 vs 執行」：
 * 這裡一步 dispatch 會產生一份 agent_runs（子計畫），子計畫仍走該專案全部既有守門。
 *
 * 沒有 projectId：組代理的作用域是整個組，一份 campaign 通常橫跨多案。
 */
export const groupAgentRuns = pgTable("group_agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  userId: uuid("user_id").notNull(),
  /** 使用者的一句組級目標（例：把三個待審案子推到可交付，人力不夠就找人） */
  goal: text("goal").notNull(),
  /** 計畫摘要（核准畫面顯示） */
  summary: text("summary").notNull().default(""),
  /** 規劃器的結論式說明（1–3 句；不保存 chain-of-thought） */
  rationale: text("rationale"),
  status: text("status", { enum: ["awaiting_approval", "running", "waiting", "done", "failed", "stopped", "discarded"] })
    .notNull()
    .default("awaiting_approval"),
  /** 每步：見 shared/groupAgent 的 GroupCampaignStep */
  steps: jsonb("steps").notNull(),
  /**
   * 本次授權組代理可自動核准的點數上限。組代理能自動核准子計畫＝能在無人盯著時自動花錢，
   * 所以授權額度隨計畫走、不吃組的總額度；0＝不授權自動核准（每份子計畫都要人按）。
   */
  budgetPoints: integer("budget_points").notNull().default(0),
  /** 已被本 campaign 自動核准出去的估點累計（與 budgetPoints 比對） */
  spentPoints: integer("spent_points").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  groupStatusUpdatedIdx: index("group_agent_runs_group_status_updated_idx").on(t.groupId, t.status, t.updatedAt),
  statusUpdatedIdx: index("group_agent_runs_status_updated_idx").on(t.status, t.updatedAt),
}));

/**
 * 組代理事件軌跡。不共用 agent_events：那張表的 project_id 是 NOT NULL，
 * 而組代理最重要的幾件事（下令、超預算停手、跳過整條支線）根本不屬於任何單一專案。
 * 硬塞一個假的 projectId 會讓專案頁的事件流出現不屬於它的紀錄。
 */
export const groupAgentEvents = pgTable("group_agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  groupId: uuid("group_id").notNull(),
  /** 屬於某份 campaign 的事件；單發指令（ask 提議後人按的那種）此欄為 null */
  runId: uuid("run_id"),
  /** 事件牽涉到的專案／子計畫（有才填） */
  projectId: uuid("project_id"),
  childRunId: uuid("child_run_id"),
  stepId: text("step_id"),
  /** 同一 (runId, eventKey) 只記一次；單發指令的 runId 為 null 不套用唯一鍵 */
  eventKey: text("event_key").notNull(),
  eventType: text("event_type", {
    enum: ["planned", "approved", "command", "step_started", "step_waiting", "step_completed", "step_failed", "run_completed", "run_failed", "stopped", "discarded", "observation"],
  }).notNull(),
  actorType: text("actor_type", { enum: ["ai", "human", "system"] }).notNull().default("system"),
  actorId: uuid("actor_id"),
  summary: text("summary").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  runEventUq: uniqueIndex("group_agent_events_run_event_uq").on(t.runId, t.eventKey),
  groupCreatedIdx: index("group_agent_events_group_created_idx").on(t.groupId, t.createdAt),
  runCreatedIdx: index("group_agent_events_run_created_idx").on(t.runId, t.createdAt),
}));

/** 可稽核代理事件：記錄可驗證的來源、動作、等待、裁決與成果，不保存私密 chain-of-thought。 */
export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  groupId: uuid("group_id").notNull(),
  /** Pre-project clarification events intentionally belong to the conversation, not a fake project. */
  projectId: uuid("project_id"),
  stepId: text("step_id"),
  stepIndex: integer("step_index"),
  eventKey: text("event_key").notNull(),
  eventType: text("event_type", {
    enum: [
      "planned",
      "approved",
      "step_started",
      "step_waiting",
      "waiting_user_input",
      "question_answered",
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
 * Formal, durable Human-in-the-loop question. Options are resolved by the
 * backend and frozen here so the answer API never trusts a client-supplied
 * entity id. A run has at most one pending question.
 */
export const agentQuestions = pgTable("agent_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull(),
  groupId: uuid("group_id").notNull(),
  /** Filled when a project-picker answer binds the owning run. */
  projectId: uuid("project_id"),
  userId: uuid("user_id").notNull(),
  stepId: text("step_id"),
  questionType: text("question_type").$type<AgentQuestionType>().notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  required: boolean("required").notNull().default(true),
  options: jsonb("options").$type<AgentQuestionOption[]>().notNull().default([]),
  allowCustom: boolean("allow_custom").notNull().default(false),
  defaultOption: text("default_option"),
  context: jsonb("context").$type<AgentQuestionContext>().notNull(),
  resumeToken: uuid("resume_token").notNull().defaultRandom(),
  status: text("status", { enum: ["pending", "answered", "cancelled"] }).notNull().default("pending"),
  answer: jsonb("answer").$type<AgentQuestionAnswer>(),
  answeredBy: uuid("answered_by"),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  pendingRunUq: uniqueIndex("agent_questions_pending_run_uq").on(t.runId).where(sql`${t.status} = 'pending'`),
  projectStatusCreatedIdx: index("agent_questions_project_status_created_idx").on(t.projectId, t.status, t.createdAt),
  userStatusCreatedIdx: index("agent_questions_user_status_created_idx").on(t.userId, t.status, t.createdAt),
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
