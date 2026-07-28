/**
 * 筆記核心積木：讓 tRPC、Agent Runner、MCP 與後續自動化共用同一組資料與權限守門。
 * 路由只負責傳輸層驗證；這裡仍會做完整的 transport-independent validation。
 */
import { and, desc, eq, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { validateMentions } from "./mentions";
import { assertProjectNotArchived } from "./projectAcl";

export const NOTE_TITLE_MAX = 120;
export const NOTE_CONTENT_MAX = 40_000;
export const NOTE_MENTIONS_MAX = 20;
const NOTE_VERSION_KEEP = 20;

export type NoteRow = typeof schema.notes.$inferSelect;

export interface NoteSummary {
  id: string;
  projectId: string | null;
  title: string;
  chars: number;
  excerpt: string;
  updatedAt: Date;
  createdBy: string;
  creatorName: string;
  sourceMessageId: string | null;
  mentions: string[] | null;
}

function titleChecked(value: string): string {
  const title = value.trim();
  if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "請填標題" });
  if (title.length > NOTE_TITLE_MAX) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `標題太長（最多 ${NOTE_TITLE_MAX} 字）` });
  }
  return title;
}

function contentChecked(value: string): string {
  if (!value.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "內容不可為空" });
  if (value.length > NOTE_CONTENT_MAX) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `內容過長（上限 ${NOTE_CONTENT_MAX} 字）` });
  }
  return value;
}

async function projectChecked(
  auth: AuthState,
  groupId: string,
  projectId: string,
  requireActive: boolean,
): Promise<typeof schema.projects.$inferSelect> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project || project.groupId !== groupId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
  }
  requireGroup(auth, project.groupId);
  if (requireActive) assertProjectNotArchived(project);
  return project;
}

async function sourceMessageChecked(groupId: string, sourceMessageId?: string | null): Promise<void> {
  if (!sourceMessageId) return;
  const [message] = await db
    .select({ groupId: schema.messages.groupId })
    .from(schema.messages)
    .where(eq(schema.messages.id, sourceMessageId));
  if (!message || message.groupId !== groupId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "來源留言不屬於此組" });
  }
}

async function snapshotNote(row: NoteRow, createdBy: string): Promise<void> {
  await db.insert(schema.textVersions).values({
    projectId: row.projectId ?? row.id,
    groupId: row.groupId,
    kind: "note",
    refId: row.id,
    title: row.title,
    content: row.content,
    createdBy,
  });
  const keep = await db
    .select({ id: schema.textVersions.id })
    .from(schema.textVersions)
    .where(and(eq(schema.textVersions.kind, "note"), eq(schema.textVersions.refId, row.id)))
    .orderBy(desc(schema.textVersions.createdAt))
    .limit(NOTE_VERSION_KEEP);
  if (keep.length >= NOTE_VERSION_KEEP) {
    await db
      .delete(schema.textVersions)
      .where(and(
        eq(schema.textVersions.kind, "note"),
        eq(schema.textVersions.refId, row.id),
        notInArray(schema.textVersions.id, keep.map((entry) => entry.id)),
      ));
  }
}

/** 作者本人或組長以上才能改寫／追加／刪除既有筆記。 */
export function noteWriteDenied(
  createdBy: string,
  actorId: string,
  role: ReturnType<typeof requireGroup>,
): boolean {
  return createdBy !== actorId && role === "member";
}

function assertCanWriteNote(auth: AuthState, row: NoteRow, action: "編輯" | "刪除"): void {
  const role = requireGroup(auth, row.groupId);
  if (noteWriteDenied(row.createdBy, auth.user.id, role)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `只有作者本人或組長以上可以${action}筆記`,
    });
  }
}

export async function getNoteChecked(auth: AuthState, id: string): Promise<NoteRow> {
  const [row] = await db.select().from(schema.notes).where(eq(schema.notes.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則筆記" });
  requireGroup(auth, row.groupId);
  return row;
}

export async function listNotesCore(
  auth: AuthState,
  groupId: string,
  projectId?: string,
): Promise<NoteSummary[]> {
  requireGroup(auth, groupId);
  if (projectId) await projectChecked(auth, groupId, projectId, false);
  const conditions = [eq(schema.notes.groupId, groupId)];
  if (projectId) conditions.push(eq(schema.notes.projectId, projectId));
  const rows = await db
    .select({
      id: schema.notes.id,
      projectId: schema.notes.projectId,
      title: schema.notes.title,
      content: schema.notes.content,
      updatedAt: schema.notes.updatedAt,
      createdBy: schema.notes.createdBy,
      creatorName: schema.users.name,
      sourceMessageId: schema.notes.sourceMessageId,
      mentions: schema.notes.mentions,
    })
    .from(schema.notes)
    .leftJoin(schema.users, eq(schema.users.id, schema.notes.createdBy))
    .where(and(...conditions))
    .orderBy(desc(schema.notes.updatedAt))
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    chars: row.content.length,
    excerpt: row.content.slice(0, 120),
    updatedAt: row.updatedAt,
    createdBy: row.createdBy,
    creatorName: row.creatorName ?? "?",
    sourceMessageId: row.sourceMessageId,
    mentions: row.mentions,
  }));
}

export async function listNotesForProject(auth: AuthState, projectId: string): Promise<NoteSummary[]> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  return listNotesCore(auth, project.groupId, project.id);
}

export async function addNoteCore(input: {
  auth: AuthState;
  groupId: string;
  projectId?: string | null;
  title: string;
  content: string;
  sourceMessageId?: string | null;
  mentions?: string[];
}): Promise<NoteRow> {
  requireGroup(input.auth, input.groupId);
  if (input.projectId) await projectChecked(input.auth, input.groupId, input.projectId, true);
  await sourceMessageChecked(input.groupId, input.sourceMessageId);
  if ((input.mentions?.length ?? 0) > NOTE_MENTIONS_MAX) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `@提及最多 ${NOTE_MENTIONS_MAX} 人` });
  }
  const mentions = await validateMentions(input.groupId, input.mentions);
  const [row] = await db
    .insert(schema.notes)
    .values({
      groupId: input.groupId,
      projectId: input.projectId ?? null,
      title: titleChecked(input.title),
      content: contentChecked(input.content),
      createdBy: input.auth.user.id,
      sourceMessageId: input.sourceMessageId ?? null,
      mentions: mentions ?? null,
    })
    .returning();
  return row;
}

export async function updateNoteCore(input: {
  auth: AuthState;
  id: string;
  title?: string;
  content?: string;
  mentions?: string[];
}): Promise<NoteRow> {
  const row = await getNoteChecked(input.auth, input.id);
  assertCanWriteNote(input.auth, row, "編輯");
  if (row.projectId) await projectChecked(input.auth, row.groupId, row.projectId, true);
  if ((input.mentions?.length ?? 0) > NOTE_MENTIONS_MAX) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `@提及最多 ${NOTE_MENTIONS_MAX} 人` });
  }
  const content = input.content === undefined ? row.content : contentChecked(input.content);
  const contentChanges = content !== row.content;
  if (contentChanges) await snapshotNote(row, input.auth.user.id);
  const mentions = input.mentions === undefined
    ? row.mentions
    : (await validateMentions(row.groupId, input.mentions)) ?? null;
  const [updated] = await db
    .update(schema.notes)
    .set({
      title: input.title === undefined ? row.title : titleChecked(input.title),
      content,
      mentions,
      updatedAt: new Date(),
    })
    .where(eq(schema.notes.id, row.id))
    .returning();
  return updated;
}

export async function appendNoteCore(input: {
  auth: AuthState;
  id: string;
  content: string;
  separator?: string;
}): Promise<NoteRow> {
  const row = await getNoteChecked(input.auth, input.id);
  const addition = contentChecked(input.content);
  const separator = input.separator ?? "\n\n";
  return updateNoteCore({
    auth: input.auth,
    id: row.id,
    content: `${row.content}${separator}${addition}`,
  });
}

export async function removeNoteCore(auth: AuthState, id: string): Promise<{ ok: true }> {
  const row = await getNoteChecked(auth, id);
  assertCanWriteNote(auth, row, "刪除");
  await db.transaction(async (tx) => {
    await tx.delete(schema.textVersions).where(and(
      eq(schema.textVersions.kind, "note"),
      eq(schema.textVersions.refId, row.id),
    ));
    await tx.delete(schema.notes).where(eq(schema.notes.id, row.id));
  });
  return { ok: true };
}
