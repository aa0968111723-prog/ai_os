/**
 * 首屏聚合：伺服器一次組裝 me + 未讀 + mock，裝置只打一支 API。
 * 掛在 appRouter 的 `sessionBoot` 命名空間（與 auth.me 並存，不破壞舊客戶端）。
 *
 * 設計：伺服器多做、裝置少做——瀏覽器不必自己 Promise.all 三支 tRPC。
 *
 * 重要：未讀查詢不可拖死整站。SessionGate 在 meLoading 時會擋掉除公開首頁外的
 * 所有路由；若 dmUnreadTotal 因 DB 慢查卡住，使用者會看到「除了首頁都只有載入中」。
 * 因此未讀加硬逾時，失敗／逾時一律當 0，me 仍正常回。
 */
import { router, publicProcedure } from "../trpc";
import { authMeCapabilities } from "../services/policyEngine";
import { dmUnreadTotal } from "../services/dmCore";
import { isMockMode } from "../services/fal";

/** 未讀查詢硬上限（ms）——超過就回 0，不擋登入後路由 */
const UNREAD_BUDGET_MS = 2500;

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    p.then(
      (v) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

export const sessionBootRouter = router({
  /**
   * 首屏一次取回。
   * - 未登入：me=null，unreadTotal=0，仍回 mockMode（公開頁也可顯示 mock 徽章語意）
   * - 已登入：me 含 capabilities；unread 在伺服器查完再回（有逾時保底）
   */
  bootstrap: publicProcedure.query(async ({ ctx }) => {
    if (!ctx.auth) {
      return { me: null as null, unreadTotal: 0, mockMode: isMockMode() };
    }
    const me = { ...ctx.auth, ...authMeCapabilities(ctx.auth) };
    const unreadTotal = await withTimeout(
      dmUnreadTotal(ctx.auth).catch(() => 0),
      UNREAD_BUDGET_MS,
      0,
    );
    return { me, unreadTotal, mockMode: isMockMode() };
  }),
});
