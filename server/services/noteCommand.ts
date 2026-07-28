/**
 * executeNoteCommand：筆記寫入的正式 Command 入口。
 *
 * 固定順序：
 * 1. 載入 actor／租戶（AuthState）
 * 2. 專案狀態機（assertProjectAllows write）— 僅 project-bound
 * 3. Policy Engine note.create | note.append
 * 4. 委託 notesCore（addNoteCore / appendNoteCore）
 *
 * Router／agent 應優先走本 Command；不改 core 行為。
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
  addNoteCore,
  appendNoteCore,
  getNoteChecked,
  type NoteRow,
} from "./notesCore";

type CreateNoteInput = {
  auth: AuthState;
  source: PolicySource;
  action: "create";
  id?: string;
  groupId: string;
  projectId?: string | null;
  title: string;
  content: string;
  sourceMessageId?: string | null;
  mentions?: string[];
  planRunId?: string | null;
  planStepId?: string | null;
};

type AppendNoteInput = {
  auth: AuthState;
  source: PolicySource;
  action: "append";
  id: string;
  content: string;
  separator?: string;
};

export type ExecuteNoteInput = CreateNoteInput | AppendNoteInput;

/**
 * 建立或追加筆記。
 * project-bound（create 帶 projectId，或 append 的既有筆記掛專案）時先跑狀態機。
 */
export async function executeNoteCommand(input: ExecuteNoteInput): Promise<NoteRow> {
  if (input.action === "append") {
    return executeNoteAppend(input);
  }
  return executeNoteCreate(input);
}

async function executeNoteCreate(input: CreateNoteInput): Promise<NoteRow> {
  const { auth, source, action: _action, ...core } = input;
  void _action;

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
    "note.create",
    policyContextFromAuth(auth, {
      groupId: core.groupId,
      projectId: core.projectId ?? undefined,
      source,
      projectRole,
    }),
  );

  return addNoteCore({ auth, ...core });
}

async function executeNoteAppend(input: AppendNoteInput): Promise<NoteRow> {
  const { auth, source, id, content, separator } = input;

  const row = await getNoteChecked(auth, id);

  let projectRole: "editor" | "viewer" | null = "editor";
  if (row.projectId) {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, row.projectId));
    if (!project || project.groupId !== row.groupId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
    }
    assertProjectAllows(project, "write");
    projectRole = await getProjectRole(auth, project);
  }

  assertPolicy(
    "note.append",
    policyContextFromAuth(auth, {
      groupId: row.groupId,
      projectId: row.projectId ?? undefined,
      source,
      projectRole,
    }),
  );

  return appendNoteCore({ auth, id, content, separator });
}
