/**
 * Google 日曆直連同步——個人連線自助管理：
 * 查狀態／立即同步／中斷連結。OAuth 進入點與 callback 是瀏覽器重導流程，
 * 走 Express（見 server/index.ts 的 /api/google/oauth/*），這裡只管登入後的 API。
 * 全走 authedProcedure：mutation 自動落審計，且只能操作「自己的」連線。
 */
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import {
  disconnectUser,
  getConnectionStatus,
  isGoogleCalendarConfigured,
  syncUserCalendar,
} from "../services/googleCalendar";

export const googleCalendarRouter = router({
  /** 我的連線狀態（configured=false 表示站方尚未設定 GOOGLE_CLIENT_ID/SECRET，前端隱藏功能） */
  status: authedProcedure.query(({ ctx }) => getConnectionStatus(ctx.auth.user.id)),

  /** 立即同步（平常不用按——增刪改自動觸發＋每 15 分鐘對帳；此鈕給「想馬上看到」的人） */
  syncNow: authedProcedure.mutation(async ({ ctx }) => {
    if (!isGoogleCalendarConfigured()) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "站方尚未設定 Google 日曆整合" });
    try {
      const result = await syncUserCalendar(ctx.auth.user.id);
      if (!result) {
        const st = await getConnectionStatus(ctx.auth.user.id);
        if (!st.connected) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "尚未連結 Google 日曆" });
        if (st.status === "error") throw new TRPCError({ code: "PRECONDITION_FAILED", message: st.lastError ?? "授權已失效，請重新連結" });
        return { ok: true, note: "同步已在進行中" };
      }
      return { ok: true, ...result };
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      throw new TRPCError({ code: "BAD_GATEWAY", message: `同步失敗：${err instanceof Error ? err.message : "請稍後再試"}` });
    }
  }),

  /** 中斷連結：撤銷授權＋刪除對方帳戶裡的專屬日曆＋清本地紀錄 */
  disconnect: authedProcedure.mutation(async ({ ctx }) => {
    await disconnectUser(ctx.auth.user.id);
    return { ok: true };
  }),
});
