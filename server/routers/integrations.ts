import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import {
  addApiConnection,
  fetchApiConnection,
  listDriveFiles,
  listIntegrations,
  removeIntegration,
  removeIntegrationByKind,
  searchNotionPages,
  setNotionIntegration,
} from "../services/integrations";
import {
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  RateLimitConfigurationError,
  RateLimitUnavailableError,
} from "../services/rateLimit";
import { recordAudit } from "../services/audit";

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

  /**
   * 選檔器（PR-E1）：列自己雲端裡的檔案（名稱搜尋＋分頁）。只回中繼資料，不抓內容——
   * 內容要等使用者明確選中、按匯入才抓（連接 ≠ 授權 AI 讀全雲端）。
   * 未連結回 { ok:false, reason:'not-connected' } 由前端顯示 CTA，不當錯誤丟。
   */
  listDriveFiles: authedProcedure
    .input(z.object({
      query: z.string().trim().max(200).optional(),
      // Google pageToken 常為 opaque base64，實測可 >600 字；500 會擋第二頁分頁
      pageToken: z.string().min(1).max(8192).optional(),
      folderId: z.string().trim().max(200).optional(),
    }))
    .query(async ({ ctx, input }) => {
      try {
        const rate = await consumeRateLimit(RATE_LIMIT_SCOPES.driveList, ctx.auth.user.id, RATE_LIMIT_POLICIES.driveList);
        if (!rate.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "瀏覽太頻繁——請一分鐘後再試" });
      } catch (err) {
        if (err instanceof RateLimitUnavailableError || err instanceof RateLimitConfigurationError) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "選檔安全限流暫時無法使用，請稍後再試" });
        }
        throw err;
      }
      const result = await listDriveFiles(ctx.auth.user.id, { query: input.query, pageToken: input.pageToken, folderId: input.folderId });
      // PR-E3 稽核：query 不經 mutation 審計中介層——這裡自行記「誰搜了什麼」
      //（只記關鍵字／資料夾 id，勿記檔案內容；勾選了哪些 fileId 由 plan/import mutation 審計涵蓋）
      recordAudit(ctx.auth, "integrations.listDriveFiles", { query: input.query ?? "", folderId: input.folderId ?? "" }, { ok: result.ok });
      return result;
    }),

  /**
   * Notion 選頁器（PR-E4，與 Google 選檔同一心智模型）：搜尋 token 權限內的頁面。
   * 只回標題／時間等中繼資料，不抓內容——內容等使用者選中、按匯入才透過既有 notion import 抓。
   */
  listNotionPages: authedProcedure
    .input(z.object({ query: z.string().trim().max(200).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        const rate = await consumeRateLimit(RATE_LIMIT_SCOPES.notionList, ctx.auth.user.id, RATE_LIMIT_POLICIES.notionList);
        if (!rate.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "瀏覽太頻繁——請一分鐘後再試" });
      } catch (err) {
        if (err instanceof RateLimitUnavailableError || err instanceof RateLimitConfigurationError) {
          throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "選頁安全限流暫時無法使用，請稍後再試" });
        }
        throw err;
      }
      return searchNotionPages(ctx.auth.user.id, input.query ?? "");
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
