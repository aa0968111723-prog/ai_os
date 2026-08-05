/**
 * 首屏聚合：伺服器一次組裝 me + 未讀 + mock，裝置只打一支 API。
 * 掛在 appRouter 的 `sessionBoot` 命名空間（與 auth.me 並存，不破壞舊客戶端）。
 *
 * 設計：伺服器多做、裝置少做——瀏覽器不必自己 Promise.all 三支 tRPC。
 */
import { router, publicProcedure } from "../trpc";
import { authMeCapabilities } from "../services/policyEngine";
import { dmUnreadTotal } from "../services/dmCore";
import { isMockMode } from "../services/fal";

export const sessionBootRouter = router({
  /**
   * 首屏一次取回。
   * - 未登入：me=null，unreadTotal=0，仍回 mockMode（公開頁也可顯示 mock 徽章語意）
   * - 已登入：me 含 capabilities；unread 在伺服器查完再回
   */
  bootstrap: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.auth) {
      return { me: null as null, unreadTotal: 0, mockMode: isMockMode() };
    }
    const me = { ...ctx.auth, ...authMeCapabilities(ctx.auth) };
    const unreadTotal = await dmUnreadTotal(ctx.auth).catch(() => 0);
    return { me, unreadTotal, mockMode: isMockMode() };
  }),
});
