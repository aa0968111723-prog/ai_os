import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // 不在啟動時丟例外——健康檢查不等 DB（healing-studio 的教訓）
  console.warn("[db] DATABASE_URL 未設定 — API 呼叫將失敗，健康檢查仍可用");
}

// max：連線上限；connectionTimeoutMillis：借不到連線時最多等 15 秒就報錯（而非預設的永久等待），
// 讓任何意外的連線壓力以「單一請求失敗」呈現，而不是整個服務無聲卡死。
export const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 15_000 });
// 關鍵：Pool 對閒置 client 的錯誤（DB 重啟、網路斷線、被 kill）會發 'error' 事件；
// 未監聽時 Node 會以 unhandled 'error' 直接崩掉整個程序。這裡吞掉並記錄，讓 Pool 自行重建連線。
pool.on("error", (err) => {
  console.warn("[db] 閒置連線錯誤（Pool 會自動重建，不影響服務）：", err instanceof Error ? err.message : err);
});

// 觀測：連線池排隊時才打 log——沒有 waiting 就不要先調大 max（卡頓診斷步驟 0）
if (connectionString) {
  const poolProbe = setInterval(() => {
    if (pool.waitingCount > 0 || pool.totalCount >= 8) {
      console.warn(
        `[pool] total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`,
      );
    }
  }, 5_000);
  poolProbe.unref?.();
}

export const db = drizzle(pool, { schema });
export { schema };
