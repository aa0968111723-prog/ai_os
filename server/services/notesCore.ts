/**
 * 筆記核心積木：讓 tRPC、Agent Runner、MCP 與後續自動化共用同一組資料與權限守門。
 * 路由只負責傳輸層驗證；這裡仍會做完整的 transport-independent validation。
 */
import { and, desc, eq, gte, isNull, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { validateMentions } from "./mentions";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { executeAgentEffectOnce } from "./agentEffectCore";

export const NOTE_TITLE_MAX = 120;
export const NOTE_CONTENT_MAX = 40_000;
export const NOTE_MENTIONS_MAX = 20;
export const NOTE_LIST_LIMIT = 200;
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
  planRunId: string | null;
  planStepId: string | null;
  /** 夾了幾個附件（照片／PDF…）：清單直接看得出來，不必逐則展開 */
  attachmentCount: number;
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
  /** 寫入路徑預設與 requireActive 同開：封存擋 + 專案檢視者（viewer）擋 */
  requireEditable: boolean = requireActive,
): Promise<typeof schema.projects.$inferSelect> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project || project.groupId !== groupId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
  }
  requireGroup(auth, project.groupId);
  if (requireActive) assertProjectNotArchived(project);
  // 2.3：專案綁定筆記的寫入（新增／改／刪／追加）檢視者不可改——僅作者身分不夠
  if (requireEditable) await assertProjectEditable(auth, project);
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

export interface NoteListInventory {
  items: NoteSummary[];
  total: number;
  truncated: boolean;
  cap: number;
}

export async function listNotesCore(
  auth: AuthState,
  groupId: string,
  projectId?: string,
): Promise<NoteListInventory> {
  requireGroup(auth, groupId);
  if (projectId) await projectChecked(auth, groupId, projectId, false);
  const conditions = [eq(schema.notes.groupId, groupId)];
  if (projectId) conditions.push(eq(schema.notes.projectId, projectId));
  const where = and(...conditions);
  const [rows, countRows] = await Promise.all([
    db
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
        planRunId: schema.notes.planRunId,
        planStepId: schema.notes.planStepId,
      })
      .from(schema.notes)
      .leftJoin(schema.users, eq(schema.users.id, schema.notes.createdBy))
      .where(where)
      .orderBy(desc(schema.notes.updatedAt))
      .limit(NOTE_LIST_LIMIT),
    db.select({ n: sql<number>`count(*)` }).from(schema.notes).where(where),
  ]);
  // 動態 import 避開與 attachmentsCore 的循環相依（它要 noteWriteDenied 做權限判定）
  const { countAttachmentsByRef } = await import("./attachmentsCore");
  const attachmentCounts = await countAttachmentsByRef("note", rows.map((row) => row.id));
  const items = rows.map((row) => ({
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
    planRunId: row.planRunId,
    planStepId: row.planStepId,
    attachmentCount: attachmentCounts.get(row.id) ?? 0,
  }));
  const total = Number(countRows[0]?.n ?? 0);
  return {
    items,
    total,
    truncated: total > items.length,
    cap: NOTE_LIST_LIMIT,
  };
}

export async function listNotesForProject(auth: AuthState, projectId: string): Promise<NoteSummary[]> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  return (await listNotesCore(auth, project.groupId, project.id)).items;
}

export async function addNoteCore(input: {
  auth: AuthState;
  id?: string;
  groupId: string;
  projectId?: string | null;
  title: string;
  content: string;
  sourceMessageId?: string | null;
  mentions?: string[];
  planRunId?: string | null;
  planStepId?: string | null;
}): Promise<NoteRow> {
  requireGroup(input.auth, input.groupId);
  if (input.projectId) await projectChecked(input.auth, input.groupId, input.projectId, true);
  await sourceMessageChecked(input.groupId, input.sourceMessageId);
  if ((input.mentions?.length ?? 0) > NOTE_MENTIONS_MAX) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `@提及最多 ${NOTE_MENTIONS_MAX} 人` });
  }
  const mentions = await validateMentions(input.groupId, input.mentions);
  const title = titleChecked(input.title);
  const content = contentChecked(input.content);
  const existing = await findExistingNote(input);
  if (existing) return existing;
  if (!input.id && !input.planRunId) {
    const [recent] = await db.select().from(schema.notes).where(and(
      eq(schema.notes.groupId, input.groupId),
      eq(schema.notes.createdBy, input.auth.user.id),
      eq(schema.notes.title, title),
      eq(schema.notes.content, content),
      input.projectId ? eq(schema.notes.projectId, input.projectId) : isNull(schema.notes.projectId),
      gte(schema.notes.createdAt, new Date(Date.now() - 120_000)),
    )).orderBy(desc(schema.notes.createdAt)).limit(1);
    if (recent) return recent;
  }
  const [inserted] = await db
    .insert(schema.notes)
    .values({
      id: input.id,
      groupId: input.groupId,
      projectId: input.projectId ?? null,
      title,
      content,
      createdBy: input.auth.user.id,
      sourceMessageId: input.sourceMessageId ?? null,
      mentions: mentions ?? null,
      planRunId: input.planRunId ?? null,
      planStepId: input.planStepId ?? null,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return inserted;
  const raced = await findExistingNote(input);
  if (raced) return raced;
  throw new TRPCError({ code: "CONFLICT", message: "筆記寫入發生衝突，已停止以避免重複建立" });
}

async function findExistingNote(input: {
  id?: string;
  groupId: string;
  projectId?: string | null;
  planRunId?: string | null;
  planStepId?: string | null;
}): Promise<NoteRow | undefined> {
  const [byId] = input.id
    ? await db.select().from(schema.notes).where(eq(schema.notes.id, input.id))
    : [];
  const [byPlan] = !byId && input.planRunId && input.planStepId
    ? await db.select().from(schema.notes).where(and(
      eq(schema.notes.planRunId, input.planRunId),
      eq(schema.notes.planStepId, input.planStepId),
    ))
    : [];
  const row = byId ?? byPlan;
  if (!row) return undefined;
  if (
    row.groupId !== input.groupId
    || (input.projectId && row.projectId !== input.projectId)
    || (input.planRunId && row.planRunId !== input.planRunId)
    || (input.planStepId && row.planStepId !== input.planStepId)
  ) {
    throw new TRPCError({ code: "CONFLICT", message: "筆記冪等識別碼碰撞，已停止以避免覆寫" });
  }
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

/**
 * 代理專用的 exactly-once 追加：筆記內容、版本快照與 agent_step_effects
 * 在同一交易提交。程序若在提交後、step 狀態寫回前死亡，重播只回放結果，不會再追加一次。
 */
export async function appendNoteOnceCore(input: {
  auth: AuthState;
  id: string;
  content: string;
  separator?: string;
  effectId: string;
  runId: string;
  stepId: string;
}): Promise<{ row: NoteRow; replayed: boolean }> {
  const addition = contentChecked(input.content);
  const separator = input.separator ?? "\n\n";
  const result = await executeAgentEffectOnce({
    effectId: input.effectId,
    runId: input.runId,
    stepId: input.stepId,
    kind: "append_note",
    outputType: "note",
  }, async (tx) => {
    const [row] = await tx.select().from(schema.notes).where(eq(schema.notes.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則筆記" });
    const role = requireGroup(input.auth, row.groupId);
    if (noteWriteDenied(row.createdBy, input.auth.user.id, role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有作者本人或組長以上可以編輯筆記" });
    }
    if (row.projectId) {
      const [project] = await tx.select().from(schema.projects).where(eq(schema.projects.id, row.projectId));
      if (!project || project.groupId !== row.groupId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
      }
      assertProjectNotArchived(project);
      await assertProjectEditable(input.auth, project);
    }
    const content = contentChecked(`${row.content}${separator}${addition}`);
    await tx.insert(schema.textVersions).values({
      projectId: row.projectId ?? row.id,
      groupId: row.groupId,
      kind: "note",
      refId: row.id,
      title: row.title,
      content: row.content,
      createdBy: input.auth.user.id,
    });
    const keep = await tx
      .select({ id: schema.textVersions.id })
      .from(schema.textVersions)
      .where(and(eq(schema.textVersions.kind, "note"), eq(schema.textVersions.refId, row.id)))
      .orderBy(desc(schema.textVersions.createdAt))
      .limit(NOTE_VERSION_KEEP);
    if (keep.length >= NOTE_VERSION_KEEP) {
      await tx.delete(schema.textVersions).where(and(
        eq(schema.textVersions.kind, "note"),
        eq(schema.textVersions.refId, row.id),
        notInArray(schema.textVersions.id, keep.map((entry) => entry.id)),
      ));
    }
    await tx
      .update(schema.notes)
      .set({
        content,
        planRunId: input.runId,
        planStepId: input.stepId,
        updatedAt: new Date(),
      })
      .where(eq(schema.notes.id, row.id));
    return row.id;
  });
  if (result.outputId !== input.id) {
    throw new TRPCError({ code: "CONFLICT", message: "代理追加筆記的執行結果指向不同筆記" });
  }
  return { row: await getNoteChecked(input.auth, input.id), replayed: result.replayed };
}

export async function removeNoteCore(auth: AuthState, id: string): Promise<{ ok: true }> {
  const row = await getNoteChecked(auth, id);
  assertCanWriteNote(auth, row, "刪除");
  if (row.projectId) await projectChecked(auth, row.groupId, row.projectId, true);
  // 附件（照片／PDF）跟著筆記一起走：列在同一交易刪，原檔等交易提交後才 unlink——
  // 交易 rollback 救得回列，救不回已刪的檔案（動態 import 避開與 attachmentsCore 的循環相依）
  const { purgeAttachmentsFor, removeStoredFiles } = await import("./attachmentsCore");
  let orphanFiles: string[] = [];
  await db.transaction(async (tx) => {
    await tx.delete(schema.textVersions).where(and(
      eq(schema.textVersions.kind, "note"),
      eq(schema.textVersions.refId, row.id),
    ));
    orphanFiles = await purgeAttachmentsFor("note", row.id, tx);
    await tx.delete(schema.notes).where(eq(schema.notes.id, row.id));
  });
  await removeStoredFiles(orphanFiles);
  return { ok: true };
}
