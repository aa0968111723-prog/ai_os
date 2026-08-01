/**
 * 系統健康（儲存層）router——把「素材安不安全」從只有開發者看得到的 /api/selftest
 * 搬到一般登入介面上。
 *
 * 為什麼 storageStatus 只要 authedProcedure、不限 superAdmin：這次事故的教訓之一是
 * 「儲存出問題時，天天在用系統的團隊管理員完全無從得知」——降級警示橫幅（StorageAlertBanner）
 * 要能對所有登入者顯示，資訊本身（持久性判定、對帳結果、備份時間）不含任何組資料或使用者內容，
 * 沒有洩漏面；能「動手改狀態」的 acknowledgeVolumeChange 才限開發者。
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { router, authedProcedure } from "../trpc";
import { db, schema } from "../db";
import { assessStoragePersistence, resetVolumeIdentity } from "../services/storage";
import { storageDegradeState } from "../services/storageHealth";
import { lastAuditRun } from "../services/storageAudit";

export const systemRouter = router({
  /**
   * 儲存層狀態總覽：持久性判定＋降級旗標＋最近一次對帳＋未落地統計＋最近成功備份時間。
   * 前端（儲存警示橫幅、團隊管理的儲存卡）每 5 分鐘輪詢一次，查詢都走索引、成本可忽略。
   */
  storageStatus: authedProcedure.query(async () => {
    const persistence = assessStoragePersistence();
    const degraded = storageDegradeState();
    const lastAudit = await lastAuditRun();

    // 未落地統計：pending＝成品還只存在會過期的外部網址上（等補抓）、failed＝重試到放棄。
    // 只看活素材（deletedAt null）——回收桶裡的救不救得回不影響使用者眼前的畫面。
    const landRows = await db
      .select({ state: schema.assets.landState, n: sql<number>`count(*)::int` })
      .from(schema.assets)
      .where(isNull(schema.assets.deletedAt))
      .groupBy(schema.assets.landState);
    let pending = 0;
    let failed = 0;
    for (const row of landRows) {
      if (row.state === "pending") pending = row.n;
      else if (row.state === "failed") failed = row.n;
    }

    // 最近一次「成功」備份：只認 ok=true 且跑完的列（半截列不能給人「有備份」的安全感）
    const [lastBackup] = await db
      .select({ finishedAt: schema.backupRuns.finishedAt })
      .from(schema.backupRuns)
      .where(and(eq(schema.backupRuns.ok, true), isNotNull(schema.backupRuns.finishedAt)))
      .orderBy(desc(schema.backupRuns.finishedAt))
      .limit(1);

    return {
      persistence,
      degraded,
      lastAudit,
      // missing 取「最近一次對帳」的缺檔數：即時全掃太貴，而對帳排程最久 6 小時就會刷新一次
      missing: lastAudit?.missing ?? 0,
      pending,
      failed,
      lastBackupAt: lastBackup?.finishedAt ?? null,
    };
  }),

  /**
   * 管理員確認「這是我刻意換上的新磁碟」：重寫磁碟與資料庫兩側的身分標記並解除降級警示。
   * 限開發者——這個動作等於宣告「舊素材遺失我認了」，把警示按掉的人必須是能負這個責任的人。
   */
  acknowledgeVolumeChange: authedProcedure.mutation(async ({ ctx }) => {
    if (!ctx.auth.user.isSuperAdmin) {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有開發者能確認更換磁碟——這會解除素材遺失警示並重寫磁碟身分標記" });
    }
    const volumeId = await resetVolumeIdentity();
    return { ok: true, volumeId };
  }),
});
