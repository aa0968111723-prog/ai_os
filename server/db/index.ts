import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  // 不在啟動時丟例外——健康檢查不等 DB（healing-studio 的教訓）
  console.warn("[db] DATABASE_URL 未設定 — API 呼叫將失敗，健康檢查仍可用");
}

const pool = new pg.Pool({ connectionString });
export const db = drizzle(pool, { schema });
export { schema };
