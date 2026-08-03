import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  NOTE_CONTENT_MAX,
  NOTE_MENTIONS_MAX,
  NOTE_TITLE_MAX,
  getNoteChecked,
  listNotesCore,
  removeNoteCore,
  updateNoteCore,
} from "../services/notesCore";
import { executeNoteCommand } from "../services/noteCommand";
import {
  NOTE_COMMENT_BODY_MAX,
  NOTE_COMMENT_MENTIONS_MAX,
  addNoteCommentCore,
  listNoteCommentsCore,
  removeNoteCommentCore,
} from "../services/noteCommentsCore";

/**
 * 筆記傳輸層：輸入外形由 zod 提早回報；ACL、歸屬、封存、提及與版本快照
 * 一律由 notesCore 執行，確保 tRPC／Agent／MCP 未來共用時不會分岔。
 * 留言（討論串）掛同一 router，核心在 noteCommentsCore。
 */
export const notesRouter = router({
  list: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), projectId: z.string().uuid().optional() }))
    .query(({ ctx, input }) => listNotesCore(ctx.auth, input.groupId, input.projectId)),

  get: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(({ ctx, input }) => getNoteChecked(ctx.auth, input.id)),

  add: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      title: z.string().min(1, "請填標題").max(NOTE_TITLE_MAX),
      content: z.string().min(1, "內容不可為空").max(
        NOTE_CONTENT_MAX,
        `內容過長（上限 ${NOTE_CONTENT_MAX} 字）`,
      ),
      sourceMessageId: z.string().uuid().optional(),
      mentions: z.array(z.string().uuid()).max(NOTE_MENTIONS_MAX).optional(),
    }))
    .mutation(({ ctx, input }) =>
      // Command：政策 note.create + 專案狀態機 write + addNoteCore
      executeNoteCommand({ auth: ctx.auth, source: "web", action: "create", ...input }),
    ),

  update: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(NOTE_TITLE_MAX).optional(),
      content: z.string().min(1).max(NOTE_CONTENT_MAX).optional(),
    }))
    .mutation(({ ctx, input }) => updateNoteCore({ auth: ctx.auth, ...input })),

  remove: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => removeNoteCore(ctx.auth, input.id)),

  /* ── 筆記留言（討論串） ─────────────────────────────── */

  listComments: authedProcedure
    .input(z.object({ noteId: z.string().uuid() }))
    .query(({ ctx, input }) => listNoteCommentsCore(ctx.auth, input.noteId)),

  postComment: authedProcedure
    .input(z.object({
      noteId: z.string().uuid(),
      body: z.string().min(1).max(NOTE_COMMENT_BODY_MAX),
      replyToId: z.string().uuid().optional(),
      mentions: z.array(z.string().uuid()).max(NOTE_COMMENT_MENTIONS_MAX).optional(),
    }))
    .mutation(({ ctx, input }) =>
      addNoteCommentCore({
        auth: ctx.auth,
        noteId: input.noteId,
        body: input.body,
        replyToId: input.replyToId,
        mentions: input.mentions,
      }),
    ),

  removeComment: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => removeNoteCommentCore(ctx.auth, input.id)),
});
