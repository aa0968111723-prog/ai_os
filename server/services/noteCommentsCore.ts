/**
 * 筆記留言核心：會議紀錄／決策文件上的討論串。
 * 獨立於專案 messages——組層級筆記（projectId null）也能討論。
 * 組內全員可留言（含 viewer）；刪除＝作者本人或組長以上。
 */
import { asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { validateMentions } from "./mentions";
import { getNoteChecked } from "./notesCore";
import { pushToUsers } from "./webPush";
import { dmSnippet } from "./dmCore";

export const NOTE_COMMENT_BODY_MAX = 2000;
export const NOTE_COMMENT_MENTIONS_MAX = 20;
export const NOTE_COMMENT_LIST_LIMIT = 200;

export type NoteCommentRow = typeof schema.noteComments.$inferSelect;

export interface NoteCommentItem {
  id: string;
  noteId: string;
  userId: string;
  userName: string;
  body: string;
  replyToId: string | null;
  replyTo: { userName: string | null; snippet: string } | null;
  mentions: string[] | null;
  createdAt: Date;
}

function bodyChecked(value: string): string {
  const body = value.trim();
  if (!body) throw new TRPCError({ code: "BAD_REQUEST", message: "留言不可為空" });
  if (body.length > NOTE_COMMENT_BODY_MAX) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `留言過長（上限 ${NOTE_COMMENT_BODY_MAX} 字）`,
    });
  }
  return body;
}

export async function listNoteCommentsCore(
  auth: AuthState,
  noteId: string,
): Promise<NoteCommentItem[]> {
  const note = await getNoteChecked(auth, noteId);
  const rows = await db
    .select({
      id: schema.noteComments.id,
      noteId: schema.noteComments.noteId,
      userId: schema.noteComments.userId,
      userName: schema.users.name,
      body: schema.noteComments.body,
      replyToId: schema.noteComments.replyToId,
      mentions: schema.noteComments.mentions,
      createdAt: schema.noteComments.createdAt,
    })
    .from(schema.noteComments)
    .leftJoin(schema.users, eq(schema.users.id, schema.noteComments.userId))
    .where(eq(schema.noteComments.noteId, note.id))
    .orderBy(asc(schema.noteComments.createdAt))
    .limit(NOTE_COMMENT_LIST_LIMIT);

  const replyIds = [
    ...new Set(rows.map((r) => r.replyToId).filter((v): v is string => !!v)),
  ];
  const replyMap = new Map<string, { userName: string | null; snippet: string }>();
  if (replyIds.length) {
    const parents = await db
      .select({
        id: schema.noteComments.id,
        body: schema.noteComments.body,
        userName: schema.users.name,
      })
      .from(schema.noteComments)
      .leftJoin(schema.users, eq(schema.users.id, schema.noteComments.userId))
      .where(inArray(schema.noteComments.id, replyIds));
    for (const p of parents) {
      replyMap.set(p.id, { userName: p.userName, snippet: p.body.slice(0, 60) });
    }
  }

  return rows.map((r) => ({
    id: r.id,
    noteId: r.noteId,
    userId: r.userId,
    userName: r.userName ?? "?",
    body: r.body,
    replyToId: r.replyToId,
    replyTo: r.replyToId ? (replyMap.get(r.replyToId) ?? null) : null,
    mentions: r.mentions,
    createdAt: r.createdAt,
  }));
}

export async function addNoteCommentCore(input: {
  auth: AuthState;
  noteId: string;
  body: string;
  replyToId?: string;
  mentions?: string[];
}): Promise<NoteCommentRow> {
  const note = await getNoteChecked(input.auth, input.noteId);
  const body = bodyChecked(input.body);

  if (input.replyToId) {
    const [parent] = await db
      .select({ id: schema.noteComments.id, noteId: schema.noteComments.noteId })
      .from(schema.noteComments)
      .where(eq(schema.noteComments.id, input.replyToId));
    if (!parent || parent.noteId !== note.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "只能回覆同一則筆記的留言" });
    }
  }

  if ((input.mentions?.length ?? 0) > NOTE_COMMENT_MENTIONS_MAX) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `@提及最多 ${NOTE_COMMENT_MENTIONS_MAX} 人`,
    });
  }
  const mentions = await validateMentions(note.groupId, input.mentions);

  const [row] = await db
    .insert(schema.noteComments)
    .values({
      noteId: note.id,
      groupId: note.groupId,
      userId: input.auth.user.id,
      body,
      replyToId: input.replyToId ?? null,
      mentions: mentions ?? null,
    })
    .returning();

  const mentionTargets = (mentions ?? []).filter((id) => id !== input.auth.user.id);
  if (mentionTargets.length) {
    void pushToUsers(mentionTargets, {
      title: `${input.auth.user.name} 在筆記「${note.title}」提及你`,
      body: dmSnippet(body),
      url: `/planner?focus=note-${note.id}&cid=${row.id}`,
      tag: `note-comment-mention-${row.id}`,
    }).catch((err) =>
      console.warn(
        "[noteComments] @提及推播失敗：",
        err instanceof Error ? err.message : err,
      ),
    );
  }

  return row;
}

export async function removeNoteCommentCore(
  auth: AuthState,
  id: string,
): Promise<{ ok: true }> {
  const [row] = await db
    .select()
    .from(schema.noteComments)
    .where(eq(schema.noteComments.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則留言" });
  const role = requireGroup(auth, row.groupId);
  if (row.userId !== auth.user.id && role === "member") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只有作者本人或組長以上可以刪除留言",
    });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.noteComments)
      .set({ replyToId: null })
      .where(eq(schema.noteComments.replyToId, row.id));
    await tx.delete(schema.noteComments).where(eq(schema.noteComments.id, row.id));
  });
  return { ok: true };
}
