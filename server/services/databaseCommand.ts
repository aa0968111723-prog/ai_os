/**
 * executeDatabaseWriteCommand：資料庫列寫入的正式 Command 入口。
 *
 * 固定順序：
 * 1. 載入 table + resolveTableAccess（canWriteRows；人向入口）
 * 2. 專案狀態機（assertProjectAllows write）— 僅 project-bound（input.projectId）
 * 3. Policy Engine database.write（有組脈絡時：組庫或專案綁定）
 * 4. 委託 databaseCore（addDataRowValidated / updateDataRowValidated）
 *
 * Router 應優先走本 Command；不改 core 行為。
 * MCP／agent 若用 resolveAgentAccess 收斂 AI 權限，可於呼叫前另驗後再進本 Command，
 * 或下一 PR 再統一 agent 路徑。
 */
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { resolveTableAccess, type DataTableRow } from "./databaseAcl";
import {
  addDataRowValidated,
  updateDataRowValidated,
  type DataRowRow,
} from "./databaseCore";
import { getProjectRole } from "./projectAcl";
import { assertProjectAllows } from "./projectState";
import {
  assertPolicy,
  policyContextFromAuth,
  type PolicySource,
} from "./policyEngine";

type AddRowInput = {
  auth: AuthState;
  source: PolicySource;
  action: "addRow";
  tableId: string;
  data: Record<string, unknown>;
  /** 可選：專案綁定（狀態機 + policy 上下文）；web addRow 可不帶 */
  projectId?: string | null;
  /** 可選：穩定列 id（agent effect 重放） */
  id?: string;
};

type UpdateRowInput = {
  auth: AuthState;
  source: PolicySource;
  action: "updateRow";
  rowId: string;
  data: Record<string, unknown>;
  /** 可選：專案綁定 */
  projectId?: string | null;
};

export type ExecuteDatabaseWriteInput = AddRowInput | UpdateRowInput;

/**
 * 新增或更新一列。
 * project-bound（帶 projectId）時先跑狀態機；有組脈絡時 assertPolicy database.write。
 */
export async function executeDatabaseWriteCommand(
  input: ExecuteDatabaseWriteInput,
): Promise<DataRowRow> {
  if (input.action === "updateRow") {
    return executeUpdateRow(input);
  }
  return executeAddRow(input);
}

async function loadWritableTable(auth: AuthState, tableId: string): Promise<DataTableRow> {
  const [table] = await db
    .select()
    .from(schema.dataTables)
    .where(and(eq(schema.dataTables.id, tableId), isNull(schema.dataTables.deletedAt)));
  if (!table) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個資料庫" });
  }
  const access = resolveTableAccess(auth, table);
  // 無讀取權回 NOT_FOUND：不向外洩漏「存在但你看不到」
  if (!access.canRead) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個資料庫" });
  }
  if (!access.canWriteRows) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "這個資料庫目前只開放管理者寫入",
    });
  }
  return table;
}

/**
 * 專案狀態機 + Policy：有 projectId 時擋封存／暫停與 viewer；
 * 有 groupId（表或專案）時 assertPolicy database.write。
 * 個人庫且無專案綁定：僅 table ACL，不強制組政策（個人空間無 groupRole）。
 */
async function assertWritePolicy(
  auth: AuthState,
  source: PolicySource,
  table: DataTableRow,
  projectId: string | null | undefined,
): Promise<void> {
  let projectRole: "editor" | "viewer" | null = "editor";
  let groupId: string | undefined = table.groupId ?? undefined;

  if (projectId) {
    const [project] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    if (!project) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
    }
    if (table.groupId && project.groupId !== table.groupId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
    }
    assertProjectAllows(project, "write");
    projectRole = await getProjectRole(auth, project);
    groupId = table.groupId ?? project.groupId;
  }

  if (!groupId) {
    // personal / team / global 無組脈絡：table ACL 已守門
    return;
  }

  assertPolicy(
    "database.write",
    policyContextFromAuth(auth, {
      groupId,
      projectId: projectId ?? undefined,
      source,
      projectRole,
    }),
  );
}

async function executeAddRow(input: AddRowInput): Promise<DataRowRow> {
  const { auth, source, tableId, data, projectId, id } = input;
  const table = await loadWritableTable(auth, tableId);
  await assertWritePolicy(auth, source, table, projectId);
  return addDataRowValidated(table, auth.user.id, data, id);
}

async function executeUpdateRow(input: UpdateRowInput): Promise<DataRowRow> {
  const { auth, source, rowId, data, projectId } = input;

  const [row] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, rowId));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "找不到這一列" });
  }
  const table = await loadWritableTable(auth, row.tableId);
  await assertWritePolicy(auth, source, table, projectId);
  return updateDataRowValidated(table, row.id, auth.user.id, data);
}
