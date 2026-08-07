import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import { listAttachmentsCore, removeAttachmentCore } from "../services/attachmentsCore";

/**
 * 筆記／知識庫附件的傳輸層：查詢與刪除走 tRPC，上傳走 REST（multipart 不經 tRPC，
 * 與素材庫 /api/upload、資料庫文件 /api/databases/upload 同一條線）。
 * 權限、上限與連帶刪除一律在 attachmentsCore，避免 REST 與 tRPC 兩邊分岔。
 */
export const attachmentsRouter = router({
  list: authedProcedure
    .input(z.object({
      kind: z.enum(["note", "knowledge"]),
      refId: z.string().uuid(),
    }))
    .query(({ ctx, input }) => listAttachmentsCore(ctx.auth, input.kind, input.refId)),

  remove: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(({ ctx, input }) => removeAttachmentCore(ctx.auth, input.id)),
});
