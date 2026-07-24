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
    await applyManualMigrations(); // 既有表仍在，手寫遷移照常補（冪等）
    return true;
  }

  await apply();
  console.log(
    (statementsToExecute?.length ?? 0) > 0
      ? `[db] ✓ 資料表同步完成（套用 ${statementsToExecute.length} 項變更）`
      : "[db] ✓ 資料表已是最新（無變更）",
  );
  await applyManualMigrations();
  return true;
}

/**
 * pushSchema 之外的手寫遷移（冪等，每次開機跑）：drizzle schema 刻意不宣告的約束放這裡——
 * 對「既有資料可能違反約束」的情形，pushSchema 直接建索引會炸開機，這裡先修資料再建索引。
 *
 * group_options (group_id,type,value) 唯一索引（核心缺陷審查:併發首讀種子/同名 upsert 皆因缺此約束）：
 * 先把歷史重複列去重（保留最早一筆——即原始種子；同時間戳以 id 決勝，確定性冪等），再建唯一索引。
 * 此後 optionsStore 的 onConflictDoNothing 與 options.upsert 的 23505 攔截才真正有 DB 保底。
 */
async function applyManualMigrations(): Promise<void> {
  try {
    await db.execute(sql`
      delete from group_options a using group_options b
      where a.group_id = b.group_id and a.type = b.type and a.value = b.value
        and (a.created_at, a.id::text) > (b.created_at, b.id::text)
    `);
    await db.execute(sql`
      create unique index if not exists group_options_group_type_value_uq
      on group_options (group_id, type, value)
    `);

    // feedback (user_id, group_id) 唯一：滿意度問卷「一人一組一份」。舊版 upsert 走「查後改＋刪重複列」，
    // 併發送出會各插一列（無 DB 約束擋不住）。先去重（保留最新一筆——與 mine 讀取一致），
    // 再建唯一索引；group_id 可為 null（無組成員也一人一份），以 coalesce 收斂 NULL 使其參與唯一性。
    // 此後 router 的 23505 攔截才真正有 DB 保底。
    await db.execute(sql`
      delete from feedback a using feedback b
      where a.user_id = b.user_id
        and a.group_id is not distinct from b.group_id
        and (a.created_at, a.id::text) < (b.created_at, b.id::text)
    `);
    await db.execute(sql`
      create unique index if not exists feedback_user_group_uq
      on feedback (user_id, coalesce(group_id, '00000000-0000-0000-0000-000000000000'::uuid))
    `);
    console.log("[db] ✓ 手寫遷移完成（group_options／feedback 唯一索引就緒）");
  } catch (err) {
    // 不擋開機：索引缺席只是回到「應用層防重」的舊狀態,功能照常
    console.warn("[db] ⚠ 手寫遷移失敗（不影響啟動）：", err instanceof Error ? err.message : err);
  }
}
