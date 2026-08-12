import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { requireGroup } from "../trpc";
import { listVisibleTables, resolveAgentAccess } from "./databaseAcl";

const MAX_FILES = 100;
const MAX_READ_CHARS = 24_000;
const MAX_RESULTS = 30;
export type ProjectFileCitation = { fileId: string; fileName: string; tableId: string; sourceProvider: string | null; sourceUrl: string | null; excerpt?: string; startChar?: number; endChar?: number };

async function resolveProjectTables(auth: AuthState, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  const bindings = await db.select({ tableId: schema.projectDataBindings.resourceId }).from(schema.projectDataBindings).where(and(eq(schema.projectDataBindings.projectId, projectId), eq(schema.projectDataBindings.resourceKind, "table")));
  if (!bindings.length) return [];
  const bound = new Set(bindings.map((item) => item.tableId));
  return (await listVisibleTables(auth)).filter((table) => bound.has(table.id) && resolveAgentAccess(auth, table).canRead);
}

export async function listProjectFiles(auth: AuthState, projectId: string) {
  const tables = await resolveProjectTables(auth, projectId); if (!tables.length) return [];
  const rows = await db.select({ id: schema.dataFiles.id, tableId: schema.dataFiles.tableId, name: schema.dataFiles.name, mime: schema.dataFiles.mime, sizeBytes: schema.dataFiles.sizeBytes, sourceProvider: schema.dataFiles.sourceProvider, readableChars: sql<number>`coalesce(length(${schema.dataFiles.textContent}), 0)`, createdAt: schema.dataFiles.createdAt }).from(schema.dataFiles).where(inArray(schema.dataFiles.tableId, tables.map((table) => table.id))).orderBy(desc(schema.dataFiles.createdAt)).limit(MAX_FILES);
  return rows.map((row) => ({ ...row, readableChars: Number(row.readableChars), citation: { fileId: row.id, fileName: row.name, tableId: row.tableId, sourceProvider: row.sourceProvider, sourceUrl: null } satisfies ProjectFileCitation }));
}

export async function readProjectFile(auth: AuthState, projectId: string, clientFileId: string, offset = 0, limit = MAX_READ_CHARS) {
  // Client ids are never trusted: resolve project + bound table + AI ACL on every call.
  const tables = await resolveProjectTables(auth, projectId); if (!tables.length) throw new TRPCError({ code: "NOT_FOUND", message: "找不到可讀檔案" });
  const [file] = await db.select({ id: schema.dataFiles.id, tableId: schema.dataFiles.tableId, name: schema.dataFiles.name, mime: schema.dataFiles.mime, text: schema.dataFiles.textContent, description: schema.dataFiles.aiDescription, sourceProvider: schema.dataFiles.sourceProvider, sourceUrl: schema.dataFiles.sourceUrl }).from(schema.dataFiles).where(and(eq(schema.dataFiles.id, clientFileId), inArray(schema.dataFiles.tableId, tables.map((table) => table.id))));
  if (!file) throw new TRPCError({ code: "NOT_FOUND", message: "找不到可讀檔案" });
  const source = file.text ?? file.description ?? ""; const start = Math.max(0, Math.trunc(offset)); const end = Math.min(source.length, start + Math.min(MAX_READ_CHARS, Math.max(1, Math.trunc(limit))));
  return { fileId: file.id, name: file.name, mime: file.mime, text: source.slice(start, end), truncated: end < source.length, nextOffset: end < source.length ? end : null, citation: { fileId: file.id, fileName: file.name, tableId: file.tableId, sourceProvider: file.sourceProvider, sourceUrl: file.sourceUrl, excerpt: source.slice(start, Math.min(end, start + 240)), startChar: start, endChar: end } satisfies ProjectFileCitation };
}

export async function searchProjectFiles(auth: AuthState, projectId: string, rawQuery: string, limit = 10) {
  const query = rawQuery.trim().slice(0, 200); if (!query) throw new TRPCError({ code: "BAD_REQUEST", message: "搜尋文字不可為空" });
  const tables = await resolveProjectTables(auth, projectId); if (!tables.length) return [];
  const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`; const safeLimit = Math.min(MAX_RESULTS, Math.max(1, Math.trunc(limit)));
  const rows = await db.select({ id: schema.dataFiles.id, tableId: schema.dataFiles.tableId, name: schema.dataFiles.name, sourceProvider: schema.dataFiles.sourceProvider, sourceUrl: schema.dataFiles.sourceUrl, text: schema.dataFiles.textContent, description: schema.dataFiles.aiDescription }).from(schema.dataFiles).where(and(inArray(schema.dataFiles.tableId, tables.map((table) => table.id)), or(sql`${schema.dataFiles.name} ilike ${like} escape ${"\\"}`, sql`coalesce(${schema.dataFiles.textContent}, '') ilike ${like} escape ${"\\"}`, sql`coalesce(${schema.dataFiles.aiDescription}, '') ilike ${like} escape ${"\\"}`)!)).orderBy(desc(schema.dataFiles.createdAt)).limit(safeLimit);
  return rows.map((row) => { const source = row.text ?? row.description ?? row.name; const position = source.toLocaleLowerCase().indexOf(query.toLocaleLowerCase()); const start = Math.max(0, position - 120); const excerpt = source.slice(start, start + 360); return { fileId: row.id, name: row.name, excerpt, citation: { fileId: row.id, fileName: row.name, tableId: row.tableId, sourceProvider: row.sourceProvider, sourceUrl: row.sourceUrl, excerpt, startChar: start, endChar: start + excerpt.length } satisfies ProjectFileCitation }; });
}
