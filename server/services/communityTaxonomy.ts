/**
 * 靈感頻道自動細化分類的落地層：把 shared/inspirationTaxonomy 的純函式接到 community_posts。
 *
 * 兩個職責，刻意分開：
 *  1. `taxonomyFieldsFor()` —— 發布／更新快照時算一次，寫進 auto_tags/category/taxonomy_version。
 *  2. `healInspirationTaxonomy()` —— 讀取時自我修復。
 *
 * 為什麼要有 (2)：字典會長大。每次補關鍵詞都要「先跑一支 backfill 才敢部署」的話，
 * 分類就會停在第一版不再改進——這是所有規則式分類真正死掉的原因。
 * 版本落後的列在被讀到時就地重算並寫回，部署當下不需要停機，也不需要維運介入；
 * 沒人看的舊貼文永遠不會被算到，本來也不需要。整批補算仍可跑
 * `npm run community:reclassify`（篩選面要立刻完整時用）。
 *
 * 寫回一律 best-effort：分類是加值資訊，DB 寫入失敗絕不可以讓 feed 整頁掛掉。
 */
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { parseAssetLineageMeta } from "../../shared/assetLineage";
import {
  TAXONOMY_VERSION,
  classifyInspiration,
  type InspirationClassifyInput,
} from "../../shared/inspirationTaxonomy";

export type TaxonomyFields = {
  autoTags: string[];
  category: string;
  taxonomyVersion: number;
};

/** 算出要寫進 community_posts 的三個分類欄位 */
export function taxonomyFieldsFor(input: InspirationClassifyInput): TaxonomyFields {
  const result = classifyInspiration(input);
  return {
    autoTags: result.tags,
    category: result.category,
    taxonomyVersion: result.version,
  };
}

/** 上傳素材的原始檔名常帶線索（sunset-beach.jpg）——分類時一併餵進去 */
export function fileNameFromAssetMeta(meta: unknown): string | null {
  return parseAssetLineageMeta(meta).originalName ?? null;
}

/** 分類只吃這幾個欄位；用結構型別讓呼叫端傳整列或傳片段都行 */
type ClassifiablePost = {
  id: string;
  mediaKind?: string | null;
  sourceType?: string | null;
  title?: string | null;
  description?: string | null;
  promptText?: string | null;
  tags?: string[] | null;
  taxonomyVersion?: number | null;
};

/**
 * 讀取端自我修復：版本落後的列就地重算、寫回，並回傳已修好的列。
 *
 * 呼叫端拿到的一定是新版分類，不必自己判斷版本；沒有落後列時零額外查詢。
 */
export async function healInspirationTaxonomy<T extends ClassifiablePost>(rows: T[]): Promise<T[]> {
  const stale = rows.filter((row) => (row.taxonomyVersion ?? 0) !== TAXONOMY_VERSION);
  if (stale.length === 0) return rows;

  const patches = new Map<string, TaxonomyFields>();
  for (const row of stale) {
    patches.set(
      row.id,
      taxonomyFieldsFor({
        mediaKind: row.mediaKind,
        sourceType: row.sourceType,
        title: row.title,
        description: row.description,
        promptText: row.promptText,
        tags: row.tags,
      }),
    );
  }

  // 寫回不動 updated_at：重新分類不是作者編輯，不該把貼文推上「剛更新」。
  // 單頁上限就是 listPublic 的 limit（≤50），不會變成無界批次。
  await Promise.all(
    [...patches].map(([id, fields]) =>
      db
        .update(schema.communityPosts)
        .set(fields)
        .where(eq(schema.communityPosts.id, id))
        .catch((err: unknown) => {
          console.warn(
            "[community] 自動分類回寫失敗（不影響閱讀）：",
            err instanceof Error ? err.message : err,
          );
        }),
    ),
  );

  return rows.map((row) => {
    const patch = patches.get(row.id);
    return patch ? { ...row, ...patch } : row;
  });
}
