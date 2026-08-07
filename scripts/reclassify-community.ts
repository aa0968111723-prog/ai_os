/**
 * 靈感頻道自動細化分類：整批重算（backfill）。
 *
 * 平常不需要跑——讀取端會自我修復版本落後的列（server/services/communityTaxonomy.ts）。
 * 這支是給「篩選面要立刻完整」的時候用的：剛升級字典、又不想等使用者一頁一頁把
 * 舊貼文讀出來時，跑一次就整站對齊。
 *
 * 用法：
 *   npm run community:reclassify              # 只補版本落後的列
 *   npm run community:reclassify -- --all     # 全部重算（字典大改後想強制對齊）
 *   npm run community:reclassify -- --dry-run # 只印會改什麼，不寫入
 *
 * 行為：
 * - 未設 DATABASE_URL → 印 skip 並 exit 0（不擋 CI）
 * - 逐批 200 列處理，避免一次把整張表拉進記憶體
 */
import pg from "pg";
import { TAXONOMY_VERSION, classifyInspiration } from "../shared/inspirationTaxonomy";

const BATCH = 200;
const dryRun = process.argv.includes("--dry-run");
const rebuildAll = process.argv.includes("--all");

type Row = {
  id: string;
  media_kind: string | null;
  source_type: string | null;
  title: string | null;
  description: string | null;
  prompt_text: string | null;
  tags: string[] | null;
  auto_tags: string[] | null;
  category: string | null;
};

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[reclassify] skip no DATABASE_URL");
    return;
  }

  const pool = new pg.Pool({ connectionString, max: 4, connectionTimeoutMillis: 15_000 });
  let scanned = 0;
  let changed = 0;
  try {
    // keyset 分頁（以 id 遞增）：重算過程中不會因為 taxonomy_version 被改掉而漏列或重讀
    let after = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const { rows } = await pool.query<Row>(
        `SELECT id, media_kind, source_type, title, description, prompt_text, tags, auto_tags, category
         FROM community_posts
         WHERE id > $1 ${rebuildAll ? "" : "AND taxonomy_version <> $3"}
         ORDER BY id ASC
         LIMIT $2`,
        rebuildAll ? [after, BATCH] : [after, BATCH, TAXONOMY_VERSION],
      );
      if (rows.length === 0) break;
      after = rows[rows.length - 1].id;
      scanned += rows.length;

      for (const row of rows) {
        const result = classifyInspiration({
          mediaKind: row.media_kind,
          sourceType: row.source_type,
          title: row.title,
          description: row.description,
          promptText: row.prompt_text,
          tags: row.tags,
        });
        const same =
          row.category === result.category
          && JSON.stringify(row.auto_tags ?? []) === JSON.stringify(result.tags);
        if (same && !rebuildAll) {
          // 標籤沒變也要把版本推上去，否則每次讀取都會再算一次
          if (!dryRun) {
            await pool.query("UPDATE community_posts SET taxonomy_version = $2 WHERE id = $1", [
              row.id,
              TAXONOMY_VERSION,
            ]);
          }
          continue;
        }
        changed += 1;
        if (dryRun) {
          console.log(`[reclassify] ${row.id} ${row.category ?? "—"} → ${result.category} (${result.tags.join(", ")})`);
          continue;
        }
        // updated_at 不動：重新分類不是作者編輯，不該把貼文推上「剛更新」
        await pool.query(
          "UPDATE community_posts SET auto_tags = $2::jsonb, category = $3, taxonomy_version = $4 WHERE id = $1",
          [row.id, JSON.stringify(result.tags), result.category, TAXONOMY_VERSION],
        );
      }
    }
    console.log(
      `[reclassify] ${dryRun ? "DRY RUN " : ""}掃描 ${scanned} 則、更新 ${changed} 則（字典版本 v${TAXONOMY_VERSION}）`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[reclassify]", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
