import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  NOTE_CONTENT_MAX,
  NOTE_MENTIONS_MAX,
  NOTE_TITLE_MAX,
  addNoteCore,
  getNoteChecked,
  listNotesCore,
  removeNoteCore,
  updateNoteCore,
} from "../services/notesCore";

/**
 * 筆記傳輸層：輸入外形由 zod 提早回報；ACL、歸屬、封存、提及與版本快照
 * 一律由 notesCore 執行，確保 tRPC／Agent／MCP 未來共用時不會分岔。
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
    .mutation(({ ctx, input }) => addNoteCore({ auth: ctx.auth, ...input })),

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
});
