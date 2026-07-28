/**
 * executeTaskCommand：人類任務建立的正式 Command 入口。
 *
 * 固定順序：
 * 1. 載入 actor／租戶（AuthState）
 * 2. 專案狀態機（assertProjectAllows write）— 任務一律 project-bound
 * 3. Policy Engine task.create
 * 4. 委託 addProjectTaskCore
 *
 * Agent Runner／未來 tRPC 建立入口應優先走本 Command；不改 core 行為。
 */
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { getProjectRole } from "./projectAcl";
import { assertProjectAllows } from "./projectState";
import {
  assertPolicy,
  policyContextFromAuth,
  type PolicySource,
} from "./policyEngine";
import {
  addProjectTaskCore,
  type ProjectTaskRow,
  type ProjectTaskStatus,
} from "./taskCore";

export type ExecuteTaskInput = {
  auth: AuthState;
  source: PolicySource;
  id?: string;
  groupId: string;
  projectId: string;
  planRunId?: string | null;
  planStepId?: string | null;
  taskType?: "task" | "approval";
  title: string;
  description?: string | null;
  assigneeId?: string | null;
  approverRole?: "project_owner" | "group_leader" | "admin" | null;
  status?: ProjectTaskStatus;
  priority?: "low" | "normal" | "high" | "urgent";
  startsAt?: string | null;
  dueAt?: string | null;
  sourceMessageId?: string | null;
  mentions?: string[];
};

/**
 * 建立人類任務／核准節點。
 * 一律 project-bound：狀態機 write + policy task.create。
 */
export async function executeTaskCommand(input: ExecuteTaskInput): Promise<ProjectTaskRow> {
  const { auth, source, ...core } = input;

  requireGroup(auth, core.groupId);

  const [project] = await db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, core.projectId));
  if (!project || project.groupId !== core.groupId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
  }
  assertProjectAllows(project, "write");
  const projectRole = await getProjectRole(auth, project);

  assertPolicy(
    "task.create",
    policyContextFromAuth(auth, {
      groupId: core.groupId,
      projectId: core.projectId,
      source,
      projectRole,
    }),
  );

  return addProjectTaskCore({ auth, ...core });
}
