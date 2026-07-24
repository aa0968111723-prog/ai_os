import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import {
  addApiConnection,
  fetchApiConnection,
  listIntegrations,
  removeIntegration,
  removeIntegrationByKind,
  setNotionIntegration,
} from "../services/integrations";

/**
 * 個人整合連接自助管理：Google 雲端（OAuth 進入點與 callback 是瀏覽器重導流程，
 * 走 Express——見 server/index.ts 的 /api/integrations/google-drive/*，這裡只管登入後的 API）、
 * Notion 個人 token、外部資料庫/API 連接。
 * 全走 authedProcedure：mutation 自動落審計，且只能操作「自己的」連線。
 * 敏感輸入欄位命名為 token/secret——sanitizeAuditInput 依鍵名整鍵剔除，原文不落 audit_log。
 */
export const integrationsRouter = router({
  /** 我的整合清單（絕不回憑證原文——只給 email/workspace/末四碼等顯示資訊） */
  list: authedProcedure.query(({ ctx }) => listIntegrations(ctx.auth.user.id)),

  /** 設定/更換自己的 Notion integration token（先打 Notion API 驗證有效才收） */
  setNotion: authedProcedure
    .input(z.object({ token: z.string().min(1).max(300) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await setNotionIntegration(ctx.auth.user.id, input.token);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Notion token 設定失敗" });
      }
    }),

  /** 新增外部資料庫/API 連接（Airtable/Supabase/自建服務…；金鑰加密落庫） */
  addApi: authedProcedure
    .input(z.object({
      name: z.string().min(1).max(60),
      baseUrl: z.string().min(8).max(500),
      headerName: z.string().max(64).optional(),
      secret: z.string().min(1).max(2000),
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await addApiConnection(ctx.auth.user.id, input);
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "連接建立失敗" });
      }
    }),

  /**
   * 從外部連接抓資料（測試連線與匯入面板共用）：path 相對於連接的基底網址，
   * 最終網址強制同源——憑證不會被送去別的主機。回文字內容（上限與 importData 同口徑）。
   */
  fetchApi: authedProcedure
    .input(z.object({ id: z.string().uuid(), path: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await fetchApiConnection(ctx.auth.user.id, input.id, input.path ?? "");
      } catch (err) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "抓取失敗" });
      }
    }),

  /** 移除外部 API 連線（依 id；只能移自己的） */
  remove: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      try {
        await removeIntegration(ctx.auth.user.id, input.id);
        return { ok: true };
      } catch (err) {
        throw new TRPCError({ code: "NOT_FOUND", message: err instanceof Error ? err.message : "找不到這條連接" });
      }
    }),

  /** 中斷 Google 雲端連結（撤銷授權＋刪本地紀錄；冪等） */
  removeGoogleDrive: authedProcedure.mutation(async ({ ctx }) => {
    await removeIntegrationByKind(ctx.auth.user.id, "google-drive");
    return { ok: true };
  }),

  /** 移除自己的 Notion token（之後退回站方 NOTION_TOKEN，若有設） */
  removeNotion: authedProcedure.mutation(async ({ ctx }) => {
    await removeIntegrationByKind(ctx.auth.user.id, "notion");
    return { ok: true };
  }),
});
