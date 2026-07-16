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
    console.warn("[db] DATABASE_URL 未設定——請在部署平台的服務 Variables 設定 DATABASE_URL（Zeabur：跨服務引用 PostgreSQL 服務的連線字串）");
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
  const pushed = (await pushSchema(
    schema as unknown as Record<string, unknown>,
    db as never,
  )) as { statementsToExecute: string[]; apply: () => Promise<void>; hasDataLoss?: boolean; warnings?: string[] };
  const { statementsToExecute, apply, hasDataLoss, warnings } = pushed;

  // 資料遺失防護：pushSchema 若判定會掉資料（DROP COLUMN/TABLE、型別不相容等），
  // 正式環境預設「不套用」——避免一次誤改 schema 就無聲清空生產資料。
  // 確實要套用破壞性變更時，設環境變數 ALLOW_DB_DATALOSS=1 明示放行。
  const destructive = hasDataLoss || (statementsToExecute ?? []).some((s) => /drop\s+(column|table)/i.test(s));
  if (destructive && process.env.ALLOW_DB_DATALOSS !== "1") {
    console.warn("[db] ⚠⚠⚠ 偵測到可能造成資料遺失的 schema 變更——已「跳過」套用以保護生產資料。");
    (warnings ?? []).forEach((w) => console.warn("[db]   ·", w));
    (statementsToExecute ?? []).filter((s) => /drop\s+(column|table)/i.test(s)).forEach((s) => console.warn("[db]   SQL:", s));
    console.warn("[db]   確認無誤要套用，請設環境變數 ALLOW_DB_DATALOSS=1 後 Redeploy。其餘功能照常運作。");
    return true;
  }

  await apply();
  console.log(
    (statementsToExecute?.length ?? 0) > 0
      ? `[db] ✓ 資料表同步完成（套用 ${statementsToExecute.length} 項變更）`
      : "[db] ✓ 資料表已是最新（無變更）",
  );
  return true;
}
