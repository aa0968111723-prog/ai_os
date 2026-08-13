/**
 * Server-owned Agent database tools.
 *
 * Reads reuse databaseMcp / assistantDatabaseEvidence.
 * Writes go through executeDatabaseWriteCommand + authoritative read-back.
 * Agents never insert/update rows directly.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db";
import { validateRowData, type DataField, type DataRowData } from "../../shared/databaseFields";
import type { AuthState } from "./auth";
import {
  getAgentReadableTable,
  listMcpDatabases,
  mergeProjectIntoRowData,
  queryMcpDatabase,
} from "./databaseMcp";
import { executeDatabaseWriteCommand } from "./databaseCommand";
import {
  retrieveAssistantDatabaseEvidence,
  type AssistantReadableDatabase,
} from "./assistantDatabaseEvidence";
import {
  canonicalRowValuesEqual,
  resolveAuthorizedDatabase,
  resolveDatabaseFieldValues,
  resolveRecentDatabaseRow,
  type DatabaseRecentRef,
  type DatabaseResolveHint,
} from "./databaseResourceResolver";
import type { ToolContext, ToolDefinition, ToolResult } from "./practicalAutonomy";

const tableHint = z.object({
  tableId: z.string().uuid().optional(),
  table: z.string().trim().min(1).max(80).optional(),
  tableRef: z.string().trim().min(1).max(16).optional(),
  selectedTableId: z.string().uuid().optional(),
  linkedOnly: z.boolean().optional(),
});

const recentRefSchema = z.object({
  tableId: z.string().uuid(),
  tableName: z.string().max(80),
  rowIds: z.array(z.string().uuid()).max(20),
  query: z.string().max(80).optional(),
  timestamp: z.string().max(40),
});

export const databaseListInput = tableHint.pick({ linkedOnly: true });
export const databaseSchemaInput = tableHint;
export const databaseQueryInput = tableHint.extend({
  keyword: z.string().max(80).optional(),
  equals: z.record(z.string().min(1).max(80), z.string().max(200)).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(20_000).optional(),
  includeFields: z.boolean().optional(),
  recent: z.array(recentRefSchema).max(5).optional(),
});
export const databaseRowGetInput = tableHint.extend({
  rowId: z.string().uuid().optional(),
  recent: z.array(recentRefSchema).max(5).optional(),
  recentPhrase: z.string().max(40).optional(),
});
export const databaseRowWriteInput = tableHint.extend({
  rowId: z.string().uuid().optional(),
  data: z.record(z.string().min(1).max(80), z.unknown()),
  recent: z.array(recentRefSchema).max(5).optional(),
  recentPhrase: z.string().max(40).optional(),
});

export function databaseToolAvailability(): { available: boolean; reason?: string; provider: string } {
  if (!process.env.DATABASE_URL?.trim()) {
    return { available: false, reason: "DATABASE_UNAVAILABLE", provider: "postgresql" };
  }
  return { available: true, provider: "postgresql" };
}

function citation(ref: string, excerpt?: string, trust: "VERIFIED_INTERNAL" | "EXTERNAL_UNTRUSTED" = "VERIFIED_INTERNAL") {
  return {
    type: "citation" as const,
    ref,
    excerpt,
    verifiedAt: new Date().toISOString(),
    trust,
  };
}

function effect(ref: string) {
  return {
    type: "effect" as const,
    ref,
    verifiedAt: new Date().toISOString(),
    trust: "VERIFIED_INTERNAL" as const,
  };
}

function ok<T>(value: T, evidence: ToolResult["evidence"], verified = true): ToolResult<T> {
  return { value, evidence, actualPoints: 0, verified };
}

function hintFrom(input: z.infer<typeof tableHint>, context: ToolContext, recent?: DatabaseRecentRef[]): DatabaseResolveHint {
  return {
    tableId: input.tableId,
    table: input.table,
    tableRef: input.tableRef,
    selectedTableId: input.selectedTableId,
    projectId: context.projectId,
    linkedOnly: input.linkedOnly,
    recent,
  };
}

function readableFromListed(
  listed: Awaited<ReturnType<typeof listMcpDatabases>>,
): AssistantReadableDatabase[] {
  return listed.map((table, index) => ({
    ref: `db${index + 1}`,
    id: table.tableId,
    name: table.name,
    fields: table.fields,
    rowCount: table.rowCount,
    canWrite: table.canWriteRows,
  }));
}

export async function executeDatabaseListTool(
  auth: AuthState,
  context: ToolContext,
  input: z.infer<typeof databaseListInput>,
): Promise<ToolResult> {
  const value = await listMcpDatabases(auth, {
    projectId: context.projectId,
    linkedOnly: input.linkedOnly === true,
  });
  return ok(
    {
      status: "resolved",
      tables: value,
      count: value.length,
    },
    value.map((table) => citation(`database:${table.tableId}`, table.name)),
  );
}

export async function executeDatabaseSchemaTool(
  auth: AuthState,
  context: ToolContext,
  input: z.infer<typeof databaseSchemaInput>,
): Promise<ToolResult> {
  const resolved = await resolveAuthorizedDatabase(auth, hintFrom(input, context));
  if (resolved.status !== "resolved") {
    return ok(resolved, [], resolved.status !== "not_found");
  }
  const hit = await getAgentReadableTable(auth, resolved.table.tableId);
  if (!hit) return ok({ status: "not_found", message: "找不到這個資料庫" }, []);
  return ok(
    {
      status: "resolved",
      tableId: hit.table.id,
      name: hit.table.name,
      fields: hit.table.fields,
      rowCount: resolved.table.rowCount,
      canWriteRows: hit.access.canWriteRows,
      agentAccess: hit.table.agentAccess ?? "write",
    },
    [citation(`database:${hit.table.id}`, hit.table.name)],
  );
}

export async function executeDatabaseQueryTool(
  auth: AuthState,
  context: ToolContext,
  input: z.infer<typeof databaseQueryInput>,
): Promise<ToolResult> {
  const keyword = input.keyword?.trim() ?? "";
  const wantsCrossDb = !input.tableId && !input.table && !input.tableRef && !input.selectedTableId && !!keyword;

  if (wantsCrossDb) {
    const listed = await listMcpDatabases(auth, {
      projectId: context.projectId,
      linkedOnly: input.linkedOnly === true,
    });
    const rows = await retrieveAssistantDatabaseEvidence(readableFromListed(listed), keyword, {
      limit: Math.min(16, input.limit ?? 16),
      candidateLimit: 120,
    });
    const recent: DatabaseRecentRef | undefined = rows.length
      ? {
          tableId: rows[0]!.tableId,
          tableName: rows[0]!.tableName,
          rowIds: [...new Set(rows.map((row) => row.rowId))].slice(0, 20),
          query: keyword,
          timestamp: new Date().toISOString(),
        }
      : undefined;
    return ok(
      {
        status: "resolved",
        mode: "cross_database",
        keyword,
        returned: rows.length,
        rows: rows.map((row) => ({
          databaseId: row.tableId,
          databaseName: row.tableName,
          tableRef: row.tableRef,
          rowId: row.rowId,
          score: row.score,
          snippet: row.text,
        })),
        recentRef: recent,
      },
      rows.length
        ? rows.slice(0, 8).map((row) => citation(`database-row:${row.rowId}`, `${row.tableName}:${row.score}`, "EXTERNAL_UNTRUSTED"))
        : [citation("database-search:empty", keyword)],
    );
  }

  const resolved = await resolveAuthorizedDatabase(auth, hintFrom(input, context, input.recent));
  if (resolved.status !== "resolved") {
    return ok(resolved, [], resolved.status !== "not_found");
  }
  const hit = await getAgentReadableTable(auth, resolved.table.tableId);
  if (!hit) return ok({ status: "not_found", message: "找不到這個資料庫" }, []);

  let equals: Record<string, string> | undefined;
  if (input.equals) {
    const mappedEquals = resolveDatabaseFieldValues(hit.table.fields as DataField[], input.equals);
    if (mappedEquals.status === "unknown_fields" || mappedEquals.status === "ambiguous_fields") {
      return ok(mappedEquals, [citation(`database:${hit.table.id}`, hit.table.name)], true);
    }
    equals = Object.fromEntries(
      Object.entries(mappedEquals.data).map(([key, value]) => [key, String(value)]),
    );
  }
  const value = await queryMcpDatabase(hit.table, {
    keyword,
    equals,
    limit: input.limit,
    offset: input.offset,
    includeFields: input.includeFields,
  });
  const recent: DatabaseRecentRef = {
    tableId: hit.table.id,
    tableName: hit.table.name,
    rowIds: value.rows.map((row) => row.id).slice(0, 20),
    query: keyword || undefined,
    timestamp: new Date().toISOString(),
  };
  return ok(
    {
      status: "resolved",
      mode: "table",
      ...value,
      recentRef: recent,
    },
    [
      citation(`database:${hit.table.id}`, `${hit.table.name}:${value.returned}`),
      ...value.rows.slice(0, 8).map((row) => citation(`database-row:${row.id}`, undefined, "EXTERNAL_UNTRUSTED")),
    ],
  );
}

export async function executeDatabaseRowGetTool(
  auth: AuthState,
  context: ToolContext,
  input: z.infer<typeof databaseRowGetInput>,
): Promise<ToolResult> {
  let tableId = input.tableId;
  let rowId = input.rowId;
  if (!rowId && input.recentPhrase) {
    const recent = resolveRecentDatabaseRow(input.recent, input.recentPhrase);
    if (recent.status !== "resolved") return ok(recent, [], recent.status !== "not_found");
    tableId = recent.tableId;
    rowId = recent.rowId;
  }
  if (!rowId) return ok({ status: "not_found", message: "找不到這一列" }, []);

  const resolved = await resolveAuthorizedDatabase(
    auth,
    hintFrom({ ...input, tableId }, context, input.recent),
  );
  if (resolved.status !== "resolved") return ok(resolved, [], false);

  const hit = await getAgentReadableTable(auth, resolved.table.tableId);
  if (!hit) return ok({ status: "not_found", message: "找不到這個資料庫" }, []);
  const [row] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, rowId));
  if (!row || row.tableId !== hit.table.id) return ok({ status: "not_found", message: "找不到這一列" }, []);
  return ok(
    {
      status: "resolved",
      tableId: hit.table.id,
      tableName: hit.table.name,
      rowId: row.id,
      data: row.data,
      recentRef: {
        tableId: hit.table.id,
        tableName: hit.table.name,
        rowIds: [row.id],
        timestamp: new Date().toISOString(),
      } satisfies DatabaseRecentRef,
    },
    [citation(`database-row:${row.id}`, hit.table.name, "EXTERNAL_UNTRUSTED")],
  );
}

async function authorizeWritableTable(auth: AuthState, tableId: string) {
  const hit = await getAgentReadableTable(auth, tableId);
  if (!hit) {
    const error = new Error("NOT_FOUND");
    (error as Error & { code?: string }).code = "NOT_FOUND";
    throw error;
  }
  if (!hit.access.canWriteRows) {
    const error = new Error("FORBIDDEN");
    (error as Error & { code?: string }).code = "FORBIDDEN";
    throw error;
  }
  return hit;
}

export async function executeDatabaseRowAddTool(
  auth: AuthState,
  context: ToolContext,
  input: z.infer<typeof databaseRowWriteInput>,
): Promise<ToolResult> {
  const resolved = await resolveAuthorizedDatabase(auth, hintFrom(input, context, input.recent));
  if (resolved.status !== "resolved") return ok(resolved, [], false);

  const hit = await authorizeWritableTable(auth, resolved.table.tableId);
  const fields = hit.table.fields as DataField[];
  const mapped = resolveDatabaseFieldValues(fields, input.data);
  if (mapped.status !== "resolved") return ok(mapped, [citation(`database:${hit.table.id}`, hit.table.name)], false);

  const merged = mergeProjectIntoRowData(fields, mapped.data, context.projectId);
  const checked = validateRowData(fields, merged);
  if (!checked.ok) {
    return ok(
      { status: "invalid_fields", message: checked.error },
      [citation(`database:${hit.table.id}`, hit.table.name)],
      false,
    );
  }

  const row = await executeDatabaseWriteCommand({
    auth,
    source: "agent",
    action: "addRow",
    tableId: hit.table.id,
    data: checked.data,
    projectId: context.projectId,
  });
  const [found] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, row.id));
  const verified = !!found
    && found.tableId === hit.table.id
    && canonicalRowValuesEqual(found.data as DataRowData, checked.data);
  return {
    value: {
      status: verified ? "verified" : "unverified",
      operation: "add",
      tableId: hit.table.id,
      tableName: hit.table.name,
      rowId: row.id,
      requested: checked.data,
      actual: found?.data ?? null,
      recentRef: {
        tableId: hit.table.id,
        tableName: hit.table.name,
        rowIds: [row.id],
        timestamp: new Date().toISOString(),
      } satisfies DatabaseRecentRef,
    },
    evidence: [effect(`database-row:${row.id}`)],
    actualPoints: 0,
    verified,
  };
}

export async function executeDatabaseRowUpdateTool(
  auth: AuthState,
  context: ToolContext,
  input: z.infer<typeof databaseRowWriteInput>,
): Promise<ToolResult> {
  let tableId = input.tableId;
  let rowId = input.rowId;
  if (!rowId && input.recentPhrase) {
    const recent = resolveRecentDatabaseRow(input.recent, input.recentPhrase);
    if (recent.status !== "resolved") return ok(recent, [], false);
    tableId = recent.tableId;
    rowId = recent.rowId;
  }
  if (!rowId) return ok({ status: "not_found", message: "找不到這一列" }, [], false);

  const resolved = await resolveAuthorizedDatabase(auth, hintFrom({ ...input, tableId }, context, input.recent));
  if (resolved.status !== "resolved") return ok(resolved, [], false);

  const hit = await authorizeWritableTable(auth, resolved.table.tableId);
  const [existing] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, rowId));
  if (!existing || existing.tableId !== hit.table.id) {
    return ok({ status: "not_found", message: "找不到這一列" }, [], false);
  }

  const fields = hit.table.fields as DataField[];
  const mapped = resolveDatabaseFieldValues(fields, input.data);
  if (mapped.status !== "resolved") return ok(mapped, [citation(`database:${hit.table.id}`, hit.table.name)], false);

  const merged = mergeProjectIntoRowData(
    fields,
    { ...(existing.data as Record<string, unknown>), ...mapped.data },
    context.projectId,
  );
  const checked = validateRowData(fields, merged);
  if (!checked.ok) {
    return ok(
      { status: "invalid_fields", message: checked.error },
      [citation(`database:${hit.table.id}`, hit.table.name)],
      false,
    );
  }

  const row = await executeDatabaseWriteCommand({
    auth,
    source: "agent",
    action: "updateRow",
    rowId,
    data: checked.data,
    projectId: context.projectId,
  });
  const [found] = await db.select().from(schema.dataRows).where(eq(schema.dataRows.id, row.id));
  const verified = !!found
    && found.tableId === hit.table.id
    && canonicalRowValuesEqual(found.data as DataRowData, mapped.data);
  return {
    value: {
      status: verified ? "verified" : "unverified",
      operation: "update",
      tableId: hit.table.id,
      tableName: hit.table.name,
      rowId: row.id,
      requested: mapped.data,
      actual: found?.data ?? null,
      recentRef: {
        tableId: hit.table.id,
        tableName: hit.table.name,
        rowIds: [row.id],
        timestamp: new Date().toISOString(),
      } satisfies DatabaseRecentRef,
    },
    evidence: [effect(`database-row:${row.id}`)],
    actualPoints: 0,
    verified,
  };
}

const readPolicy = { maxAttempts: 3, baseDelayMs: 250, allowProviderFallback: false };
const writePolicy = { maxAttempts: 1, baseDelayMs: 0, allowProviderFallback: false };
const verifiedRead = (result: ToolResult) => result.verified;

function wrap<I>(
  handler: (auth: AuthState, context: ToolContext, input: I) => Promise<ToolResult>,
  loadAuth: (context: ToolContext) => Promise<AuthState>,
) {
  return async (input: I, context: ToolContext) => handler(await loadAuth(context), context, input);
}

export function agentDatabaseToolDefinitions(
  loadAuth: (context: ToolContext) => Promise<AuthState>,
): Array<ToolDefinition<any, any>> {
  const availability = databaseToolAvailability;
  return [
    {
      id: "database.list",
      label: "List readable databases",
      category: "project",
      access: "READ",
      input: databaseListInput,
      output: z.unknown(),
      requiredContext: ["userId", "groupId", "projectId"],
      risk: "low",
      confirmation: "never",
      idempotency: "keyed",
      cost: { paid: false, estimatePoints: () => 0 },
      retry: readPolicy,
      verify: verifiedRead,
      verificationStage: "VERIFIED",
      verificationMethod: "authoritative_database_acl_read_back",
      evidenceScope: "project",
      availability,
      required: false,
      handlerIdentity: "databaseMcp.listMcpDatabases",
      handler: wrap(executeDatabaseListTool, loadAuth),
    },
    {
      id: "database.schema",
      label: "Read database schema",
      category: "project",
      access: "READ",
      input: databaseSchemaInput,
      output: z.unknown(),
      requiredContext: ["userId", "groupId", "projectId"],
      risk: "low",
      confirmation: "never",
      idempotency: "keyed",
      cost: { paid: false, estimatePoints: () => 0 },
      retry: readPolicy,
      verify: verifiedRead,
      verificationStage: "VERIFIED",
      verificationMethod: "authoritative_database_acl_read_back",
      evidenceScope: "project",
      availability,
      required: false,
      handlerIdentity: "databaseMcp.getAgentReadableTable",
      handler: wrap(executeDatabaseSchemaTool, loadAuth),
    },
    {
      id: "database.query",
      label: "Query database rows",
      category: "project",
      access: "READ",
      input: databaseQueryInput,
      output: z.unknown(),
      requiredContext: ["userId", "groupId", "projectId"],
      risk: "low",
      confirmation: "never",
      idempotency: "keyed",
      cost: { paid: false, estimatePoints: () => 0 },
      retry: readPolicy,
      verify: verifiedRead,
      verificationStage: "VERIFIED",
      verificationMethod: "authoritative_database_acl_read_back",
      evidenceScope: "project",
      availability,
      required: false,
      handlerIdentity: "databaseMcp.queryMcpDatabase",
      handler: wrap(executeDatabaseQueryTool, loadAuth),
    },
    {
      id: "database.row.get",
      label: "Get database row",
      category: "project",
      access: "READ",
      input: databaseRowGetInput,
      output: z.unknown(),
      requiredContext: ["userId", "groupId", "projectId"],
      risk: "low",
      confirmation: "never",
      idempotency: "keyed",
      cost: { paid: false, estimatePoints: () => 0 },
      retry: readPolicy,
      verify: verifiedRead,
      verificationStage: "VERIFIED",
      verificationMethod: "authoritative_database_acl_read_back",
      evidenceScope: "project",
      availability,
      required: false,
      handlerIdentity: "databaseMcp.getAgentReadableTable",
      handler: wrap(executeDatabaseRowGetTool, loadAuth),
    },
    {
      id: "database.row.add",
      label: "Add database row",
      category: "project",
      access: "WRITE",
      input: databaseRowWriteInput,
      output: z.unknown(),
      requiredContext: ["userId", "groupId", "projectId"],
      risk: "medium",
      confirmation: "always",
      idempotency: "effect_receipt",
      cost: { paid: false, estimatePoints: () => 0 },
      retry: writePolicy,
      verify: (result) => result.verified,
      verificationStage: "VERIFIED",
      verificationMethod: "authoritative_database_row_read_back",
      evidenceScope: "project",
      availability,
      required: false,
      handlerIdentity: "databaseCommand.executeDatabaseWriteCommand",
      handler: wrap(executeDatabaseRowAddTool, loadAuth),
    },
    {
      id: "database.row.update",
      label: "Update database row",
      category: "project",
      access: "WRITE",
      input: databaseRowWriteInput,
      output: z.unknown(),
      requiredContext: ["userId", "groupId", "projectId"],
      risk: "medium",
      confirmation: "always",
      idempotency: "effect_receipt",
      cost: { paid: false, estimatePoints: () => 0 },
      retry: writePolicy,
      verify: (result) => result.verified,
      verificationStage: "VERIFIED",
      verificationMethod: "authoritative_database_row_read_back",
      evidenceScope: "project",
      availability,
      required: false,
      handlerIdentity: "databaseCommand.executeDatabaseWriteCommand",
      handler: wrap(executeDatabaseRowUpdateTool, loadAuth),
    },
  ];
}
