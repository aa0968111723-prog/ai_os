/**
 * 把本機 Volume 上的既有素材搬到 S3 相容物件儲存（MinIO／R2／S3）。
 *
 * 為什麼要有這支：切換後端本身只要設環境變數，但**舊檔不會自己長腳過去**。
 * 沒有這一步就切，站上的舊圖／舊旁白／舊成片會全部變成 404——
 * 使用者看到的是「系統把我的東西弄丟了」，那是最傷信任的一種故障。
 *
 * 正確的上線順序：
 *   1. 先設好 S3_ENDPOINT／S3_BUCKET／金鑰，但**先不要重啟服務**（服務仍寫本機磁碟）。
 *   2. 跑本腳本（可重複跑；已存在且大小相同的物件會跳過）。
 *   3. 重啟服務讓它切到物件儲存。
 *   4. 再跑一次本腳本，補上步驟 2、3 之間新產生的檔案。
 *   5. 確認 npm run assets:verify 沒有缺檔後，才可以把 Volume 退掉。
 *
 * 用法：
 *   DATABASE_URL=... ASSET_DIR=/data S3_ENDPOINT=... S3_BUCKET=... \
 *   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... npm run assets:migrate-object-store
 *
 *   加 --dry-run 只列要搬什麼、不實際寫入。
 *   加 --json 輸出機器可讀結果（CI 用）。
 *
 * 這支腳本**只寫入物件儲存、不刪本機檔案、不改資料庫**：
 * storage_path 兩種後端通用，所以搬移是純粹的「複製一份過去」，隨時可以回頭。
 */
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import { headObject, objectStoreConfig, putObject } from "../server/services/objectStore";
import { mimeFromPath } from "../server/services/storage";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const asJson = args.has("--json");

const STORAGE_ROOT = process.env.ASSET_DIR ?? (existsSync("/data") ? "/data" : path.join(process.cwd(), ".data"));
const ASSETS_DIR = path.join(STORAGE_ROOT, "assets");

function log(message: string): void {
  if (!asJson) console.log(message);
}

/** 所有存了 storage_path 的資料表：漏掉任何一張，該類檔案切換後就變 404 */
const SOURCES: Array<{ table: string; column: string; label: string }> = [
  { table: "assets", column: "storage_path", label: "素材" },
  { table: "dm_attachments", column: "storage_path", label: "私訊附件" },
  { table: "data_files", column: "storage_path", label: "資料庫文件" },
  { table: "export_jobs", column: "storage_path", label: "交付包" },
  { table: "feedback_reports", column: "screenshot_path", label: "回饋截圖" },
  { table: "users", column: "avatar_url", label: "頭像" },
];

async function main(): Promise<void> {
  const config = objectStoreConfig();
  if (!config) {
    console.error("未設定物件儲存——請先給 S3_ENDPOINT（或 MINIO_ENDPOINT）、S3_BUCKET 與金鑰");
    process.exit(2);
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    log("未設定 DATABASE_URL — skip");
    process.exit(0);
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const paths = new Set<string>();
  try {
    for (const source of SOURCES) {
      // 資料表可能還沒建（新環境或舊版 schema）——用 to_regclass 先問，缺表就跳過而不是整批中斷
      const exists = await pool.query<{ present: string | null }>(
        "select to_regclass($1) as present",
        [`public.${source.table}`],
      );
      if (!exists.rows[0]?.present) {
        log(`· ${source.label}（${source.table}）：資料表不存在，略過`);
        continue;
      }
      const rows = await pool.query<{ p: string }>(
        `select distinct ${source.column} as p from ${source.table} where ${source.column} is not null and ${source.column} <> ''`,
      );
      let counted = 0;
      for (const row of rows.rows) {
        // users.avatar_url 也可能存外部網址（OAuth 頭像）——只搬本站的相對路徑
        if (/^https?:\/\//i.test(row.p) || row.p.startsWith("/")) continue;
        paths.add(row.p);
        counted += 1;
      }
      log(`· ${source.label}（${source.table}.${source.column}）：${counted} 筆`);
    }
  } finally {
    await pool.end();
  }

  const result = { total: paths.size, uploaded: 0, skipped: 0, missing: [] as string[], failed: [] as string[] };
  log(`\n共 ${paths.size} 個檔案待處理 → ${config.endpoint}/${config.bucket}${config.prefix ? `/${config.prefix}` : ""}\n`);

  for (const rel of paths) {
    // 頭像寫在 STORAGE_ROOT 底下（avatars/…），素材寫在 STORAGE_ROOT/assets 底下
    const abs = rel.startsWith("avatars/") ? path.join(STORAGE_ROOT, rel) : path.join(ASSETS_DIR, rel);
    let size: number;
    try {
      size = (await stat(abs)).size;
    } catch {
      // 本機也沒有這個檔：本來就已經是破圖，搬移救不回來，只記下來讓維運知道
      result.missing.push(rel);
      continue;
    }

    try {
      // 已經在對面而且大小相同就跳過——讓這支腳本可以重複跑（上線流程要求跑兩次）
      const existing = await headObject(rel);
      if (existing.exists && existing.size === size) {
        result.skipped += 1;
        continue;
      }
      if (dryRun) {
        result.uploaded += 1;
        log(`  [dry-run] ${rel}（${size} bytes）`);
        continue;
      }
      await putObject(rel, createReadStream(abs), mimeFromPath(rel), size);
      result.uploaded += 1;
      if (result.uploaded % 50 === 0) log(`  已上傳 ${result.uploaded} 個…`);
    } catch (err) {
      result.failed.push(`${rel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    log(`\n完成：上傳 ${result.uploaded}、已存在跳過 ${result.skipped}、本機缺檔 ${result.missing.length}、失敗 ${result.failed.length}`);
    if (result.missing.length > 0) {
      log(`\n本機找不到（原本就是破圖，搬移無法修復）：`);
      for (const p of result.missing.slice(0, 20)) log(`  - ${p}`);
      if (result.missing.length > 20) log(`  …等共 ${result.missing.length} 筆`);
    }
    if (result.failed.length > 0) {
      log(`\n上傳失敗：`);
      for (const f of result.failed.slice(0, 20)) log(`  - ${f}`);
    }
  }

  // 失敗才回非零：本機缺檔是既有問題，不該讓搬移流程看起來像失敗
  process.exit(result.failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[migrate-assets] 中止：", err instanceof Error ? err.message : err);
  process.exit(1);
});
