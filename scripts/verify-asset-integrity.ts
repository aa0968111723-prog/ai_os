/**
 * 素材完整性稽核：對照 DB 的 assets.storage_path 與 Volume 實體檔。
 *
 * 上線前／定期維運用——找出「清單在、檔案不見」的破圖，以及尚未落地的 AI 成品。
 *
 * 用法：
 *   DATABASE_URL=... npm run assets:verify
 *   DATABASE_URL=... ASSET_DIR=/data npm run assets:verify
 *   DATABASE_URL=... npm run assets:verify -- --json
 *   DATABASE_URL=... npm run assets:verify -- --fail-on-missing   # 有破圖就 exit 1（CI／上線閘門）
 *   DATABASE_URL=... npm run assets:verify -- --scan-orphans      # 掃磁碟孤兒檔（較慢）
 *
 * 未設 DATABASE_URL → 印 skip 並 exit 0（不擋本機無庫環境）。
 */
import { existsSync } from "node:fs";
import { access, readdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import pg from "pg";

const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const failOnMissing = args.has("--fail-on-missing");
const scanOrphans = args.has("--scan-orphans");
const limitMissing = Number(process.env.INTEGRITY_SAMPLE_LIMIT ?? 30);

const STORAGE_ROOT =
  process.env.ASSET_DIR ?? (existsSync("/data") ? "/data" : path.join(process.cwd(), ".data"));
const ASSETS_DIR = path.join(STORAGE_ROOT, "assets");

interface AssetRow {
  id: string;
  project_id: string;
  kind: string;
  title: string;
  storage_path: string | null;
  url: string;
  size_bytes: number | null;
  is_ai_generated: boolean;
  deleted_at: Date | null;
}

interface Report {
  storageRoot: string;
  assetsDir: string;
  assetsDirExists: boolean;
  totals: {
    withStoragePath: number;
    missingFiles: number;
    sizeMismatch: number;
    unlandedAi: number; // AI 生成、storagePath 空、url 仍是 http
    softDeletedWithPath: number;
    externalOnly: number; // storagePath 空且非 AI 或非 http（外部/佔位）
    orphanFiles: number | null;
  };
  samples: {
    missing: Array<{ id: string; projectId: string; path: string; deleted: boolean; title: string }>;
    sizeMismatch: Array<{ id: string; path: string; dbBytes: number | null; diskBytes: number }>;
    unlandedAi: Array<{ id: string; projectId: string; url: string; deleted: boolean }>;
    orphans: string[];
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const abs = path.join(dir, name);
    const s = await stat(abs);
    if (s.isDirectory()) {
      out.push(...(await walkFiles(abs, base)));
    } else if (s.isFile()) {
      // 相對路徑用 posix（DB 存 yyyy/mm/uuid.ext）
      const rel = path.relative(base, abs).split(path.sep).join("/");
      out.push(rel);
    }
  }
  return out;
}

function log(...parts: unknown[]) {
  if (!asJson) console.log(...parts);
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[assets:verify] skip: no DATABASE_URL");
    process.exit(0);
  }

  const report: Report = {
    storageRoot: STORAGE_ROOT,
    assetsDir: ASSETS_DIR,
    assetsDirExists: existsSync(ASSETS_DIR),
    totals: {
      withStoragePath: 0,
      missingFiles: 0,
      sizeMismatch: 0,
      unlandedAi: 0,
      softDeletedWithPath: 0,
      externalOnly: 0,
      orphanFiles: null,
    },
    samples: {
      missing: [],
      sizeMismatch: [],
      unlandedAi: [],
      orphans: [],
    },
  };

  const pool = new pg.Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15_000,
    application_name: "ai-director-os-asset-integrity",
  });

  try {
    log(`[assets:verify] STORAGE_ROOT=${STORAGE_ROOT}`);
    log(`[assets:verify] assetsDir exists=${report.assetsDirExists}`);

    const { rows } = await pool.query<AssetRow>(`
      SELECT id, project_id, kind, title, storage_path, url, size_bytes, is_ai_generated, deleted_at
      FROM assets
      ORDER BY created_at DESC
    `);

    const referenced = new Set<string>();

    for (const row of rows) {
      if (!row.storage_path) {
        const isHttp = /^https?:\/\//i.test(row.url) && !row.url.includes("/api/mock-asset/");
        if (row.is_ai_generated && isHttp) {
          report.totals.unlandedAi += 1;
          if (report.samples.unlandedAi.length < limitMissing) {
            report.samples.unlandedAi.push({
              id: row.id,
              projectId: row.project_id,
              url: row.url.slice(0, 120),
              deleted: row.deleted_at != null,
            });
          }
        } else {
          report.totals.externalOnly += 1;
        }
        continue;
      }

      report.totals.withStoragePath += 1;
      if (row.deleted_at) report.totals.softDeletedWithPath += 1;
      referenced.add(row.storage_path);

      // 防路徑跳脫：只允許相對路徑且不越出 assets/
      const abs = path.resolve(ASSETS_DIR, row.storage_path);
      const base = path.resolve(ASSETS_DIR);
      if (abs !== base && !abs.startsWith(base + path.sep)) {
        report.totals.missingFiles += 1;
        if (report.samples.missing.length < limitMissing) {
          report.samples.missing.push({
            id: row.id,
            projectId: row.project_id,
            path: row.storage_path,
            deleted: row.deleted_at != null,
            title: row.title,
          });
        }
        continue;
      }

      if (!(await pathExists(abs))) {
        report.totals.missingFiles += 1;
        if (report.samples.missing.length < limitMissing) {
          report.samples.missing.push({
            id: row.id,
            projectId: row.project_id,
            path: row.storage_path,
            deleted: row.deleted_at != null,
            title: row.title,
          });
        }
        continue;
      }

      if (row.size_bytes != null) {
        try {
          const s = await stat(abs);
          if (s.size !== row.size_bytes) {
            report.totals.sizeMismatch += 1;
            if (report.samples.sizeMismatch.length < limitMissing) {
              report.samples.sizeMismatch.push({
                id: row.id,
                path: row.storage_path,
                dbBytes: row.size_bytes,
                diskBytes: s.size,
              });
            }
          }
        } catch {
          // stat 失敗當 missing 已處理過的路徑罕見；略過
        }
      }
    }

    if (scanOrphans && report.assetsDirExists) {
      const onDisk = await walkFiles(ASSETS_DIR);
      const orphans = onDisk.filter((rel) => !referenced.has(rel));
      report.totals.orphanFiles = orphans.length;
      report.samples.orphans = orphans.slice(0, limitMissing);
    }

    if (asJson) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      log("");
      log("── 素材完整性摘要 ──");
      log(`  有 storagePath 的素材：${report.totals.withStoragePath}`);
      log(`  其中軟刪除（回收桶、檔應仍在）：${report.totals.softDeletedWithPath}`);
      log(`  ❌ 檔案遺失（破圖）：${report.totals.missingFiles}`);
      log(`  ⚠️  大小不符：${report.totals.sizeMismatch}`);
      log(`  ⚠️  AI 未落地（storagePath 空、仍指外部 http）：${report.totals.unlandedAi}`);
      log(`  外部／佔位（無落地、非未落地 AI）：${report.totals.externalOnly}`);
      if (report.totals.orphanFiles != null) {
        log(`  磁碟孤兒檔（DB 無引用）：${report.totals.orphanFiles}`);
      } else {
        log(`  磁碟孤兒檔：未掃（加 --scan-orphans）`);
      }

      if (report.samples.missing.length) {
        log("\n破圖樣本（最多 " + limitMissing + " 筆）：");
        for (const m of report.samples.missing) {
          log(`  - ${m.id} project=${m.projectId} deleted=${m.deleted} path=${m.path} 「${m.title}」`);
        }
      }
      if (report.samples.unlandedAi.length) {
        log("\n未落地 AI 樣本：");
        for (const u of report.samples.unlandedAi) {
          log(`  - ${u.id} project=${u.projectId} deleted=${u.deleted} url=${u.url}`);
        }
      }
      if (report.samples.sizeMismatch.length) {
        log("\n大小不符樣本：");
        for (const s of report.samples.sizeMismatch) {
          log(`  - ${s.id} path=${s.path} db=${s.dbBytes} disk=${s.diskBytes}`);
        }
      }
      if (report.samples.orphans.length) {
        log("\n孤兒檔樣本：");
        for (const o of report.samples.orphans) log(`  - ${o}`);
      }

      log("");
      if (report.totals.missingFiles === 0 && report.totals.unlandedAi === 0) {
        log("[assets:verify] OK：無破圖、無未落地 AI 素材");
      } else if (report.totals.missingFiles === 0) {
        log("[assets:verify] WARN：無破圖，但有未落地 AI（runner sweepUnlandedAssets 應補抓；fal 過期前盡快）");
      } else {
        log("[assets:verify] FAIL：有素材檔遺失——請查 Volume 是否掛上、是否部署覆蓋了非持久磁碟、或做還原");
      }
    }

    if (failOnMissing && (report.totals.missingFiles > 0 || report.totals.unlandedAi > 0)) {
      process.exit(1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[assets:verify] FAILED:", err instanceof Error ? err.message : err);
  process.exit(2);
});
