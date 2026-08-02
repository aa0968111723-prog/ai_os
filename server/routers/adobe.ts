import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import {
  adobePhotoEditRequestSchema,
  adobeTimelineSchema,
} from "../../shared/adobe";
import {
  AdobeNotConnectedError,
  AdobeReauthRequiredError,
  AdobeUnsupportedError,
  adobeConnectionView,
  disconnectAdobe,
  getAdobeJob,
  listAdobeAssets,
  startAdobePhotoEdit,
  startAdobeTimelineRender,
} from "../services/adobe";
import { exportAdobeTimelineFormats } from "../services/adobe/timelineExport";
import {
  consumeRateLimit,
  RATE_LIMIT_POLICIES,
  RATE_LIMIT_SCOPES,
  RateLimitConfigurationError,
  RateLimitUnavailableError,
} from "../services/rateLimit";

/**
 * Adobe 帳號連結與深度修圖／剪輯 API（#224 PR2＋PR3＋PR4）。
 *
 * 授權入口與 callback 是瀏覽器重導流程，走 Express（見 server/index.ts 的
 * /api/integrations/adobe/*）；這裡只管登入後的狀態查詢、撤銷與工具呼叫。
 * 全走 authedProcedure：mutation 自動落審計，且只能操作「自己的」連結。
 */

/** 服務層錯誤 → tRPC 錯誤碼：未連結與需重連是「使用者要做一件事」，不是系統故障 */
function toTrpcError(err: unknown): TRPCError {
  if (err instanceof AdobeNotConnectedError) return new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
  if (err instanceof AdobeReauthRequiredError) return new TRPCError({ code: "UNAUTHORIZED", message: err.message });
  if (err instanceof AdobeUnsupportedError) return new TRPCError({ code: "NOT_IMPLEMENTED", message: err.message });
  return new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Adobe 呼叫失敗" });
}

/** 送工作是會用到對方帳號配額的動作——與外部 API 抓取同一口徑限流 */
async function guardRate(userId: string): Promise<void> {
  try {
    const rate = await consumeRateLimit(RATE_LIMIT_SCOPES.adobeJob, userId, RATE_LIMIT_POLICIES.adobeJob);
    if (!rate.allowed) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "送出太頻繁——請一分鐘後再試" });
  } catch (err) {
    if (err instanceof RateLimitUnavailableError || err instanceof RateLimitConfigurationError) {
      throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "安全限流暫時無法使用，請稍後再試" });
    }
    throw err;
  }
}

export const adobeRouter = router({
  /** 連結狀態卡（絕不回 token——只給 email／模式／能力等顯示資訊） */
  status: authedProcedure.query(({ ctx }) => adobeConnectionView(ctx.auth.user.id)),

  /** 中斷連結（撤銷授權＋刪本地憑證；冪等） */
  disconnect: authedProcedure.mutation(async ({ ctx }) => {
    await disconnectAdobe(ctx.auth.user.id);
    return { ok: true };
  }),

  /** 選素材器：列自己 Adobe 帳號裡的素材（只回中繼資料，不抓內容） */
  listAssets: authedProcedure
    .input(z.object({ query: z.string().trim().max(200).optional(), limit: z.number().int().min(1).max(30).optional() }))
    .query(async ({ ctx, input }) => {
      try {
        return await listAdobeAssets(ctx.auth.user.id, input);
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /** 送出修圖工作（不等完成；以 job.id 輪詢 adobe.job） */
  editPhoto: authedProcedure
    .input(adobePhotoEditRequestSchema)
    .mutation(async ({ ctx, input }) => {
      await guardRate(ctx.auth.user.id);
      try {
        return await startAdobePhotoEdit(ctx.auth.user.id, input);
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /** 送出時間軸算圖工作（real 模式尚未開放——會回明確的 NOT_IMPLEMENTED 與替代路徑） */
  renderTimeline: authedProcedure
    .input(adobeTimelineSchema)
    .mutation(async ({ ctx, input }) => {
      await guardRate(ctx.auth.user.id);
      try {
        return await startAdobeTimelineRender(ctx.auth.user.id, input);
      } catch (err) {
        throw toTrpcError(err);
      }
    }),

  /**
   * PR4：把 AdobeTimeline 轉成剪輯軟體可匯入的時間軸檔（純本機、不打 Adobe API）。
   * 雲端無公開算圖 API 時的正解——匯入 Premiere/FCP/Resolve 後再 relink 素材。
   * 可選 mediaPathByAssetId：若素材已在交付包內，直接掛相對路徑。
   */
  exportTimelineFormats: authedProcedure
    .input(
      z.object({
        timeline: adobeTimelineSchema,
        pathPrefix: z.string().max(20).optional(),
        mediaPathByAssetId: z.record(z.string().trim().min(1).max(200)).optional(),
        mediaKindByAssetId: z
          .record(z.enum(["video", "image", "audio"]))
          .optional(),
      }),
    )
    .mutation(({ input }) => {
      const bundle = exportAdobeTimelineFormats(input.timeline, {
        pathPrefix: input.pathPrefix,
        mediaPathByAssetId: input.mediaPathByAssetId,
        mediaKindByAssetId: input.mediaKindByAssetId,
        width: input.timeline.width,
        height: input.timeline.height,
      });
      // 不回 scenes 全量給前端（可能很長）；只要字串檔與摘要
      return {
        fcpxml: bundle.fcpxml,
        xmeml: bundle.xmeml,
        edl: bundle.edl,
        durationSec: bundle.durationSec,
        sceneCount: bundle.sceneCount,
        name: input.timeline.name,
      };
    }),

  /** 查工作狀態（輪詢用；terminal 狀態後前端就停止輪詢） */
  job: authedProcedure
    .input(z.object({ jobId: z.string().trim().min(1).max(500) }))
    .query(async ({ ctx, input }) => {
      try {
        return await getAdobeJob(ctx.auth.user.id, input.jobId);
      } catch (err) {
        throw toTrpcError(err);
      }
    }),
});
