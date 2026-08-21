import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { loadLocalEnv } from "../bootstrap/loadEnv";
import { buildPoolConfig, parseDatabaseUrl } from "./connectionConfig";
import { measureTiming } from "../services/requestTiming";
import * as schema from "./schema";

loadLocalEnv();

const connectionString = process.env.DATABASE_URL;
const databaseTarget = parseDatabaseUrl(connectionString);
if (!databaseTarget.configured) {
  // 不在啟動時丟例外——/api/health 必須在無 DB 時仍能回 liveness。
  // /api/ready 會誠實回 configured=false / connected=false。
  console.warn("[db] DATABASE_URL 未設定 — API 呼叫將失敗，健康檢查仍可用");
} else {
  console.info(
    `[db] target configured driver=${databaseTarget.driver} hostKind=${databaseTarget.hostnameKind} sslRequired=${databaseTarget.sslRequired} identity=${databaseTarget.identityHash}`,
  );
}

// max：連線上限；connectionTimeoutMillis：借不到連線時最多等 15 秒就報錯（而非預設的永久等待），
// 讓任何意外的連線壓力以「單一請求失敗」呈現，而不是整個服務無聲卡死。
// idleTimeoutMillis 回收陳舊閒置連線，避免 DB restart 後一直拿死掉的 idle client。
export const pool = new pg.Pool(buildPoolConfig(connectionString));
// 關鍵：Pool 對閒置 client 的錯誤（DB 重啟、網路斷線、被 kill）會發 'error' 事件；
// 未監聽時 Node 會以 unhandled 'error' 直接崩掉整個程序。這裡吞掉並記錄，讓 Pool 自行重建連線。
pool.on("error", (err) => {
  console.warn("[db] 閒置連線錯誤（Pool 會自動重建，不影響服務）：", err instanceof Error ? err.message : err);
});

// 觀測：連線池排隊時才打 log——沒有 waiting 就不要先調大 max（卡頓診斷步驟 0）
if (databaseTarget.configured) {
  const poolProbe = setInterval(() => {
    if (pool.waitingCount > 0 || pool.totalCount >= 8) {
      console.warn(
        `[pool] total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`,
      );
    }
  }, 5_000);
  poolProbe.unref?.();
}

/**
 * DB 存取計時：包住 Pool 的 query 與 connect，讓每一次助手問答的 log 能把
 * 「等 DB」和「等模型」分開看。沒有進行中的計時脈絡時 measureTiming 是 no-op，
 * 背景排程與啟動流程不會多出任何負擔。
 *
 * 只包 promise 形式的呼叫（drizzle 一律走這個形式）；callback 形式原樣放行，
 * 不去改動 pg 的回呼語意。
 */
function instrumentPoolTiming(target: pg.Pool): void {
  const originalQuery = target.query.bind(target);
  const originalConnect = target.connect.bind(target);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pg 的 query 有多組多載，逐一標型別只會失真
  (target as any).query = (...args: any[]) => {
    const result: unknown = (originalQuery as (...a: unknown[]) => unknown)(...args);
    if (!result || typeof (result as { then?: unknown }).then !== "function") return result;
    return measureTiming("db", () => result as Promise<unknown>);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同上：connect 亦有 callback／promise 兩種形式
  (target as any).connect = (...args: any[]) => {
    const result: unknown = (originalConnect as (...a: unknown[]) => unknown)(...args);
    if (!result || typeof (result as { then?: unknown }).then !== "function") return result;
    return (result as Promise<pg.PoolClient>).then((client) => {
      const clientQuery = client.query.bind(client);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同上
      (client as any).query = (...inner: any[]) => {
        const queried: unknown = (clientQuery as (...a: unknown[]) => unknown)(...inner);
        if (!queried || typeof (queried as { then?: unknown }).then !== "function") return queried;
        return measureTiming("db", () => queried as Promise<unknown>);
      };
      return client;
    });
  };
}
instrumentPoolTiming(pool);

export const db = drizzle(pool, { schema });
export { schema, databaseTarget };
