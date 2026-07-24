import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import { getVapidKeys, pushToUsers, saveSubscription, syncSubscription } from "../services/webPush";
import { assertPublicHostOrError, ssrfGuardError } from "../services/databaseFiles";

/**
 * SSRF 防線：endpoint 是伺服器日後要 POST 的網址——沒把關的話，任何登入者都能塞
 * 內網位址（cloud metadata、內部服務）讓伺服器替他發請求，再用 push.test 的回傳值當探測預言機。
 * 重用資料庫網址匯入的同一套守衛：字面快篩＋DNS 解析後逐 IP 驗公開位址。
 */
async function assertSafeEndpoint(endpoint: string): Promise<void> {
  const literal = ssrfGuardError(endpoint);
  const resolved = literal ? literal : await assertPublicHostOrError(new URL(endpoint).hostname);
  if (literal || resolved) throw new TRPCError({ code: "BAD_REQUEST", message: "訂閱端點無效" });
}

/**
 * 跨裝置通知（Web Push）設定：使用者在「通知設定」把手機/電腦連結進來後，
 * 審批、私訊、@提及、生成與代理完成等事件會推到所有已連結裝置（關頁也收得到）。
 * 訂閱歸屬嚴格以本人為界——裝置清單/移除只操作自己的列，組長/管理員也看不到別人的裝置。
 */
export const pushRouter = router({
  /** 瀏覽器訂閱用的 VAPID 公鑰（私鑰永不出伺服器） */
  publicKey: authedProcedure.query(async () => {
    const keys = await getVapidKeys();
    return { publicKey: keys.publicKey };
  }),

  /**
   * 連結本裝置（或既有裝置的例行回報）：存瀏覽器發的 PushSubscription。
   * 高頻（App 每次載入同步一次 lastSeenAt）＋含裝置加密金鑰——列入審計豁免（見 trpc.ts）。
   */
  subscribe: authedProcedure
    .input(
      z.object({
        endpoint: z.string().url().max(1024).refine((u) => u.startsWith("https://"), "訂閱端點必須是 https"),
        keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
        label: z.string().max(80).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSafeEndpoint(input.endpoint);
      await saveSubscription({
        userId: ctx.auth.user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        label: input.label,
      });
      return { ok: true };
    }),

  /**
   * 例行同步（App 每次載入／SW 換訂回報）：只更新既有裝置列、不新增——
   * 在設定頁移除過的裝置不會被開 App 偷偷復活。oldEndpoint＝金鑰輪替換發新訂閱時
   * 把舊列就地改寫（自癒殭屍訂閱）。高頻＋含裝置金鑰，審計豁免（見 trpc.ts）。
   */
  sync: authedProcedure
    .input(
      z.object({
        endpoint: z.string().url().max(1024).refine((u) => u.startsWith("https://"), "訂閱端點必須是 https"),
        keys: z.object({ p256dh: z.string().min(1).max(256), auth: z.string().min(1).max(256) }),
        label: z.string().max(80).optional(),
        oldEndpoint: z.string().url().max(1024).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertSafeEndpoint(input.endpoint);
      await syncSubscription({
        userId: ctx.auth.user.id,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        label: input.label,
        oldEndpoint: input.oldEndpoint,
      });
      return { ok: true };
    }),

  /** 解除本裝置（瀏覽器端已 unsubscribe 後回報伺服器刪列）；只能刪自己的訂閱 */
  unsubscribe: authedProcedure
    .input(z.object({ endpoint: z.string().url().max(1024) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(schema.pushSubscriptions)
        .where(and(eq(schema.pushSubscriptions.userId, ctx.auth.user.id), eq(schema.pushSubscriptions.endpoint, input.endpoint)));
      return { ok: true };
    }),

  /** 我的已連結裝置清單（endpoint 回給本人供「本裝置」比對；新→舊） */
  devices: authedProcedure.query(({ ctx }) =>
    db
      .select({
        id: schema.pushSubscriptions.id,
        endpoint: schema.pushSubscriptions.endpoint,
        label: schema.pushSubscriptions.label,
        lastSeenAt: schema.pushSubscriptions.lastSeenAt,
        createdAt: schema.pushSubscriptions.createdAt,
      })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, ctx.auth.user.id))
      .orderBy(desc(schema.pushSubscriptions.lastSeenAt)),
  ),

  /** 移除某個已連結裝置（如遺失的手機）；只能移除自己的 */
  removeDevice: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(schema.pushSubscriptions)
        .where(and(eq(schema.pushSubscriptions.userId, ctx.auth.user.id), eq(schema.pushSubscriptions.id, input.id)));
      return { ok: true };
    }),

  /** 發一則測試通知到我的所有已連結裝置（設定頁「測試」按鈕） */
  test: authedProcedure.mutation(({ ctx }) =>
    pushToUsers([ctx.auth.user.id], {
      title: "測試通知",
      body: `${ctx.auth.user.name}，你的跨裝置通知已就緒 ✅`,
      url: "/",
      tag: "push-test",
    }),
  ),
});
