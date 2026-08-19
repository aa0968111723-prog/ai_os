/**
 * 素材維護工作（CPU 有意義使用）：
 * 1) 落地補抓（強化既有 sweepUnlandedAssets）
 * 2) 缺 sha256 的已落地素材補算雜湊（串流讀檔，不整檔進記憶體）
 * 3) 缺縮圖的 image 補產（sharp；未安裝則跳過）
 *
 * 設計：有佇列才忙；每輪 batch 有上限；可被 env 關閉。
 * 縮圖存在 thumbs/ 下（與既有素材同一套儲存後端與隔離規則）。
 */
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { absPathOf, openStoredReadStream, putStoredBuffer, readStoredFile, storageBackend } from "./storage";
import { sweepUnlandedAssets, unlandedPersistWhere } from "./generationCore";
import { isShuttingDown } from "./shutdown";

export type AssetMaintenanceWork = {
  landed: number;
  hashed: number;
  thumbs: number;
  skipped: string | null;
  queue: {
    unlanded: number;
    missingSha: number;
    missingThumb: number;
  };
};

const DEFAULT_LAND_BATCH = 30;
const DEFAULT_HASH_BATCH = 5;
const DEFAULT_THUMB_BATCH = 3;
/** 單檔最大讀取做 hash／thumb 的上限（超過略過，避免大檔拖垮 8G 機） */
const MAX_HASH_BYTES = 80 * 1024 * 1024;
const MAX_THUMB_SOURCE_BYTES = 40 * 1024 * 1024;
const THUMB_MAX_WIDTH = 360;

/** 缺縮圖：meta 沒有 thumbPath，且沒有 thumbSkip（略過標記） */
const missingThumbWhere = and(
  eq(schema.assets.kind, "image"),
  isNotNull(schema.assets.storagePath),
  isNull(schema.assets.deletedAt),
  sql`${schema.assets.meta}->>'thumbPath' is null`,
  sql`coalesce(${schema.assets.meta}->>'thumbSkip', '') = ''`,
);

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function assetMaintenanceEnabled(): boolean {
  const raw = (process.env.BG_ASSET_MAINT ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off";
}

export async function countMaintenanceQueues(): Promise<AssetMaintenanceWork["queue"]> {
  const [unlandedRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.assets)
    .where(unlandedPersistWhere());
  const [shaRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.assets)
    .where(
      and(
        isNotNull(schema.assets.storagePath),
        isNull(schema.assets.sha256),
        isNull(schema.assets.deletedAt),
      ),
    );
  const [thumbRow] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.assets)
    .where(missingThumbWhere);
  return {
    unlanded: Number(unlandedRow?.n ?? 0),
    missingSha: Number(shaRow?.n ?? 0),
    missingThumb: Number(thumbRow?.n ?? 0),
  };
}

async function hashStoredFile(relPath: string, sizeLimit: number): Promise<string | null> {
  let stream: Awaited<ReturnType<typeof openStoredReadStream>>;
  try {
    stream = await openStoredReadStream(relPath);
  } catch {
    return null; // 檔案不存在／取不到：與原本的 stream error 分支同語意，交由對帳流程處理
  }
  return await new Promise((resolve) => {
    const hash = createHash("sha256");
    let read = 0;
    let aborted = false;
    stream.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      read += buf.length;
      if (read > sizeLimit) {
        aborted = true;
        stream.destroy();
        resolve(null);
        return;
      }
      hash.update(buf);
    });
    stream.on("error", () => resolve(null));
    stream.on("end", () => {
      if (!aborted) resolve(hash.digest("hex"));
    });
  });
}

/** 補算缺 sha256 的已落地素材；回傳成功筆數 */
export async function fillMissingSha256(limit = DEFAULT_HASH_BATCH): Promise<number> {
  const rows = await db
    .select({
      id: schema.assets.id,
      storagePath: schema.assets.storagePath,
      sizeBytes: schema.assets.sizeBytes,
    })
    .from(schema.assets)
    .where(
      and(
        isNotNull(schema.assets.storagePath),
        isNull(schema.assets.sha256),
        isNull(schema.assets.deletedAt),
      ),
    )
    .orderBy(asc(schema.assets.createdAt))
    .limit(limit);

  let done = 0;
  for (const row of rows) {
    if (isShuttingDown()) break;
    if (!row.storagePath) continue;
    if (row.sizeBytes != null && row.sizeBytes > MAX_HASH_BYTES) continue;
    try {
      const digest = await hashStoredFile(row.storagePath, MAX_HASH_BYTES);
      if (!digest) continue;
      await db
        .update(schema.assets)
        .set({ sha256: digest })
        .where(and(eq(schema.assets.id, row.id), isNull(schema.assets.sha256)));
      done += 1;
    } catch (err) {
      console.warn(
        `[asset-maint] sha256 略過 asset=${row.id}`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return done;
}

/**
 * sharp 的 callable（default export 或 module 本身）。
 * 輸入吃 string（本機後端的檔案路徑）或 Buffer（物件儲存後端整檔讀進來），
 * 輸出對應 toFile／toBuffer——兩種後端各用一條。
 */
type SharpCallable = (
  input: string | Buffer,
) => {
  rotate: () => {
    resize: (opts: { width: number; withoutEnlargement: boolean }) => {
      jpeg: (opts: { quality: number; mozjpeg: boolean }) => {
        toFile: (path: string) => Promise<unknown>;
        toBuffer: () => Promise<Buffer>;
      };
    };
  };
};

let sharpLoader: Promise<SharpCallable | null> | null = null;

function loadSharp(): Promise<SharpCallable | null> {
  if (!sharpLoader) {
    sharpLoader = import("sharp")
      .then((mod) => {
        // sharp CJS/ESM interop：default export 或 module 本身皆可能是 callable
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyMod = mod as any;
        const fn = (typeof anyMod === "function" ? anyMod : anyMod?.default) as SharpCallable | undefined;
        return typeof fn === "function" ? fn : null;
      })
      .catch(() => null);
  }
  return sharpLoader;
}

/**
 * 為缺 thumbPath 的 image 產 360px JPEG 縮圖，寫入 assets/thumbs/ 並回寫 meta.thumbPath。
 * sharp 未安裝時回 0（不報錯）。
 */
export async function generateMissingThumbs(limit = DEFAULT_THUMB_BATCH): Promise<number> {
  const sharp = await loadSharp();
  if (!sharp) return 0;

  const rows = await db
    .select({
      id: schema.assets.id,
      storagePath: schema.assets.storagePath,
      sizeBytes: schema.assets.sizeBytes,
      meta: schema.assets.meta,
    })
    .from(schema.assets)
    .where(missingThumbWhere)
    .orderBy(asc(schema.assets.createdAt))
    .limit(limit);

  let done = 0;

  for (const row of rows) {
    if (isShuttingDown()) break;
    if (!row.storagePath) continue;
    if (row.sizeBytes != null && row.sizeBytes > MAX_THUMB_SOURCE_BYTES) {
      const meta = {
        ...(row.meta as Record<string, unknown>),
        thumbSkip: "too_large",
      };
      await db.update(schema.assets).set({ meta }).where(eq(schema.assets.id, row.id));
      continue;
    }

    try {
      // 與素材同一棵路徑樹（本機後端由 absPathOf 驗證不跳出；物件後端由 objectKeyFor 驗證）
      const relThumb = path.posix.join("thumbs", `${row.id}.jpg`);
      if (storageBackend() === "object") {
        // 物件儲存沒有本機檔可餵給 sharp——縮圖來源是圖片且上面已用 MAX_THUMB_SOURCE_BYTES 擋過大檔，
        // 整檔進記憶體是可接受的（影片不在這條路徑上）。
        const source = await readStoredFile(row.storagePath);
        const thumb = await sharp(source)
          .rotate()
          .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toBuffer();
        await putStoredBuffer(relThumb, thumb, "image/jpeg");
      } else {
        const src = absPathOf(row.storagePath);
        const dest = absPathOf(relThumb);
        await mkdir(path.dirname(dest), { recursive: true });
        await sharp(src)
          .rotate()
          .resize({ width: THUMB_MAX_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(dest);
      }

      const meta = {
        ...(row.meta as Record<string, unknown>),
        thumbPath: relThumb,
        thumbWidth: THUMB_MAX_WIDTH,
      };
      delete (meta as { thumbSkip?: string }).thumbSkip;
      await db.update(schema.assets).set({ meta }).where(eq(schema.assets.id, row.id));
      done += 1;
    } catch (err) {
      console.warn(
        `[asset-maint] thumb 略過 asset=${row.id}`,
        err instanceof Error ? err.message : err,
      );
      // 連續失敗時標記 skip，避免每輪重打同一壞檔
      try {
        const meta = {
          ...(row.meta as Record<string, unknown>),
          thumbSkip: "error",
        };
        await db.update(schema.assets).set({ meta }).where(eq(schema.assets.id, row.id));
      } catch {
        /* ignore */
      }
    }
  }
  return done;
}

/**
 * 執行一輪維護。skipHeavy=true 時只回報佇列、不做事。
 */
export async function runAssetMaintenanceCycle(opts?: {
  skipHeavy?: boolean;
  landBatch?: number;
  hashBatch?: number;
  thumbBatch?: number;
}): Promise<AssetMaintenanceWork> {
  const queue = await countMaintenanceQueues();
  if (opts?.skipHeavy) {
    return {
      landed: 0,
      hashed: 0,
      thumbs: 0,
      skipped: "overload",
      queue,
    };
  }

  const landBatch = opts?.landBatch ?? envInt("BG_LAND_BATCH", DEFAULT_LAND_BATCH);
  const hashBatch = opts?.hashBatch ?? envInt("BG_HASH_BATCH", DEFAULT_HASH_BATCH);
  const thumbBatch = opts?.thumbBatch ?? envInt("BG_THUMB_BATCH", DEFAULT_THUMB_BATCH);

  let landed = 0;
  if (queue.unlanded > 0 && !isShuttingDown()) {
    landed = await sweepUnlandedAssets(landBatch);
  }

  let hashed = 0;
  if (queue.missingSha > 0 && !isShuttingDown()) {
    hashed = await fillMissingSha256(hashBatch);
  }

  let thumbs = 0;
  if (queue.missingThumb > 0 && !isShuttingDown()) {
    thumbs = await generateMissingThumbs(thumbBatch);
  }

  return {
    landed,
    hashed,
    thumbs,
    skipped: null,
    queue,
  };
}
