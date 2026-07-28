/**
 * executeScheduleCommand：排程寫入的正式 Command 入口。
 *
 * 固定順序：
 * 1. 載入 actor／租戶（AuthState）
 * 2. 專案狀態機（assertProjectAllows write）— 僅 project-bound
 * 3. Policy Engine schedule.create
 * 4. 委託 addScheduleItemCore（組隔離、歸屬、@提及、時間）
 *
 * Router／MCP／agent 應優先走本 Command；不改 core 行為。
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
  addScheduleItemCore,
  type ScheduleRow,
} from "./scheduleCore";

export type ExecuteScheduleInput = {
  auth: AuthState;
  source: PolicySource;
  id?: string;
  groupId: string;
  projectId?: string | null;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  note?: string | null;
  ownerId?: string | null;
  sourceMessageId?: string | null;
  mentions?: string[];
  planRunId?: string | null;
  planStepId?: string | null;
};

/**
 * 新增一筆行程（會議／交付死線…）。
 * project-bound 時先擋封存／暫停與專案 viewer，再進 core。
 */
export async function executeScheduleCommand(input: ExecuteScheduleInput): Promise<ScheduleRow> {
  const { auth, source, ...core } = input;

  requireGroup(auth, core.groupId);

  let projectRole: "editor" | "viewer" | null = "editor";
  if (core.projectId) {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, core.projectId));
    if (!project || project.groupId !== core.groupId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
    }
    assertProjectAllows(project, "write");
    projectRole = await getProjectRole(auth, project);
  }

  assertPolicy(
    "schedule.create",
    policyContextFromAuth(auth, {
      groupId: core.groupId,
      projectId: core.projectId ?? undefined,
      source,
      projectRole,
    }),
  );

  return addScheduleItemCore({ auth, ...core });
}
