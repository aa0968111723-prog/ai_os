/**
 * 啟動時自動同步資料表（等同 drizzle-kit push，但走程式 API）。
 * 為什麼不用 CLI：drizzle-kit push 的互動式輸出在非 TTY 環境（容器）會靜默 exit 1，
 * 表建不起來又看不到錯誤——改用 drizzle-kit/api 的 pushSchema 徹底繞過。
 * 原則不變：伺服器不等 DB 也能起（健康檢查照過）；這裡在背景重試到就緒為止。
 */
import { sql } from "drizzle-orm";
import { db, schema } from "./index";

async function dbReady(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export async function ensureSchema(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn("[db] DATABASE_URL 未設定——請在 Railway App 服務 Variables 用 Add Reference 引用 Postgres");
    return false;
  }
  for (let i = 1; i <= 10; i++) {
    if (await dbReady()) break;
    if (i === 10) {
      console.warn("[db] ⚠ 資料庫連續 10 次連不上——檢查 DATABASE_URL 是否指向 Postgres 服務（瀏覽器開 /api/ready 可診斷）");
      return false;
    }
    console.log(`[db] 等待資料庫就緒（${i}/10）…`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const { pushSchema } = await import("drizzle-kit/api");
  const { statementsToExecute, apply } = await pushSchema(
    schema as unknown as Record<string, unknown>,
    db as never,
  );
  await apply();
  console.log(
    statementsToExecute.length > 0
      ? `[db] ✓ 資料表同步完成（套用 ${statementsToExecute.length} 項變更）`
      : "[db] ✓ 資料表已是最新（無變更）",
  );
  return true;
}
