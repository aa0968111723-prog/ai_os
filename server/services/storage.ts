/**
 * 真實儲存層（持久磁碟 /data，由部署平台的 Volume 掛載）：
 * - 上傳素材與生成成品都落地到磁碟，網址永遠有效（fal 的 CDN 網址會過期，不能當永久儲存）。
 * - 服務一律走 /api/assets/:id/file：登入＋組隔離；要給 fal 當「來源輸入」時改用 HMAC 簽名短效網址。
 * - 沒掛 Volume 時退回 ./.data（本機開發可用）；production 若偵測到非持久路徑會在 /api/ready 與系統自檢亮紅。
 * - Volume 指紋：磁碟與 DB 各存一份 .volume-id，對不上就進 storageDegradeState，防止換卷後無聲遺失。
 */

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { open as fsOpen, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { assets } from "../db/schema/generation.js";
import { storageState } from "../db/schema/storage.js";
import { storageDegradeState } from "./storageHealth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 本機開發 fallback；production 必須是 Volume 掛載點 */
export const STORAGE_ROOT =
  process.env.STORAGE_ROOT?.trim() ||
  (process.env.NODE_ENV === "production" ? "/data" : path.resolve(__dirname, "../../.data"));

const VOLUME_ID_FILE = ".volume-id";
const VOLUME_ID_DB_KEY = "volume_id";

export type StoragePersistenceAssessment = {
  ok: boolean;
  root: string;
  reason?: string;
  mountpoint?: string;
  deviceId?: string;
};

/**
 * 判斷 STORAGE_ROOT 是否真的掛在持久 Volume 上。
 * Dockerfile 在映像層就 mkdir /data，所以「目錄存在」永遠為真——這是假綠燈的根因。
 * 改用 /proc/mounts + device id 判斷。
 */
export function assessStoragePersistence(root = STORAGE_ROOT): StoragePersistenceAssessment {
  try {
    if (!existsSync(root)) {
      return { ok: false, root, reason: "STORAGE_ROOT does not exist" };
    }
    const st = statSync(root);
    if (!st.isDirectory()) {
      return { ok: false, root, reason: "STORAGE_ROOT is not a directory" };
    }
    // production 必須是獨立 device（Volume），不能是容器 rootfs
    if (process.env.NODE_ENV === "production" || process.env.ASSET_STRICT === "1") {
      // 讀 /proc/mounts 找 root 的 mountpoint
      let mounts = "";
      try {
        mounts = readFileSync("/proc/mounts", "utf8");
      } catch {
        return { ok: false, root, reason: "cannot read /proc/mounts" };
      }
      const lines = mounts.split("\n").filter(Boolean);
      // 找最長 prefix match
      let best: { mp: string; dev: string } | null = null;
      for (const line of lines) {
        const parts = line.split(" ");
        if (parts.length < 2) continue;
        const dev = parts[0]!;
        const mp = parts[1]!;
        if (root === mp || root.startsWith(mp + "/")) {
          if (!best || mp.length > best.mp.length) best = { mp, dev };
        }
      }
      if (!best) {
        return { ok: false, root, reason: "STORAGE_ROOT not found in /proc/mounts" };
      }
      // rootfs / overlay 都是容器內部，不是 Volume
      const badDev = /^(overlay|rootfs|tmpfs|proc|sysfs|devtmpfs|cgroup)/i.test(best.dev);
      if (badDev || best.mp === "/") {
        return {
          ok: false,
          root,
          reason: `STORAGE_ROOT appears to be on container rootfs (dev=${best.dev}, mp=${best.mp}) — Volume not mounted?`,
          mountpoint: best.mp,
          deviceId: best.dev,
        };
      }
      return { ok: true, root, mountpoint: best.mp, deviceId: best.dev };
    }
    return { ok: true, root };
  } catch (err) {
    return { ok: false, root, reason: String(err) };
  }
}

export async function ensureStorageRoot(): Promise<void> {
  mkdirSync(STORAGE_ROOT, { recursive: true });
}

/** 讀或建立磁碟上的 volume fingerprint */
function readOrCreateDiskVolumeId(): string {
  const file = path.join(STORAGE_ROOT, VOLUME_ID_FILE);
  if (existsSync(file)) {
    return readFileSync(file, "utf8").trim();
  }
  const id = randomUUID();
  writeFileSync(file, id, { mode: 0o644 });
  return id;
}

/** 把 volume id 寫入 DB（storage_state 表） */
async function upsertDbVolumeId(db: PostgresJsDatabase<any>, id: string): Promise<void> {
  await db
    .insert(storageState)
    .values({ key: VOLUME_ID_DB_KEY, value: id, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: storageState.key,
      set: { value: id, updatedAt: new Date() },
    });
}

async function readDbVolumeId(db: PostgresJsDatabase<any>): Promise<string | null> {
  const rows = await db.select().from(storageState).where(eq(storageState.key, VOLUME_ID_DB_KEY)).limit(1);
  return rows[0]?.value ?? null;
}

/**
 * 開機時呼叫：比對磁碟與 DB 的 volume fingerprint。
 * 對不上 → 進入 degrade 狀態（換卷或卷被清空）。
 */
export async function verifyVolumeIdentity(db: PostgresJsDatabase<any>): Promise<{
  ok: boolean;
  diskId: string;
  dbId: string | null;
  changed: boolean;
}> {
  await ensureStorageRoot();
  const diskId = readOrCreateDiskVolumeId();
  const dbId = await readDbVolumeId(db);
  if (dbId == null) {
    // 第一次：寫入 DB
    await upsertDbVolumeId(db, diskId);
    return { ok: true, diskId, dbId: diskId, changed: false };
  }
  if (dbId !== diskId) {
    storageDegradeState.enter("volume-changed", `disk=${diskId} db=${dbId}`);
    return { ok: false, diskId, dbId, changed: true };
  }
  return { ok: true, diskId, dbId, changed: false };
}

/** 開發者確認「我知道換卷了」後呼叫，重設指紋 */
export async function acknowledgeVolumeChange(db: PostgresJsDatabase<any>): Promise<void> {
  await ensureStorageRoot();
  const diskId = readOrCreateDiskVolumeId();
  await upsertDbVolumeId(db, diskId);
  storageDegradeState.clear();
}

export type StoredFileMeta = {
  absPath: string;
  relPath: string;
  size: number;
  sha256?: string;
};

/** 把遠端 URL（或 buffer）落地到 STORAGE_ROOT，回傳相對路徑 */
export async function persistRemote(
  sourceUrl: string,
  opts: { projectId: string; assetId?: string; ext?: string } ,
): Promise<StoredFileMeta> {
  await ensureStorageRoot();
  const assessment = assessStoragePersistence();
  if (!assessment.ok && process.env.ASSET_STRICT === "1") {
    throw new Error(`storage not persistent: ${assessment.reason}`);
  }
  const id = opts.assetId ?? randomUUID();
  const ext = opts.ext ?? guessExt(sourceUrl) ?? ".bin";
  const rel = path.join(opts.projectId, `${id}${ext}`);
  const abs = path.join(STORAGE_ROOT, rel);
  mkdirSync(path.dirname(abs), { recursive: true });

  // 下載
  const res = await fetch(sourceUrl);
  if (!res.ok || !res.body) {
    throw new Error(`persistRemote fetch failed: ${res.status} ${sourceUrl}`);
  }
  const tmp = abs + ".tmp";
  const hash = createHash("sha256");
  const file = createWriteStream(tmp);
  // @ts-expect-error node stream from web
  await pipeline(res.body, async function* (source) {
    for await (const chunk of source) {
      hash.update(chunk);
      yield chunk;
    }
  }, file);
  renameSync(tmp, abs);
  const st = statSync(abs);
  return { absPath: abs, relPath: rel.replace(/\\/g, "/"), size: st.size, sha256: hash.digest("hex") };
}

export async function persistBuffer(
  buf: Buffer,
  opts: { projectId: string; assetId?: string; ext?: string },
): Promise<StoredFileMeta> {
  await ensureStorageRoot();
  const id = opts.assetId ?? randomUUID();
  const ext = opts.ext ?? ".bin";
  const rel = path.join(opts.projectId, `${id}${ext}`);
  const abs = path.join(STORAGE_ROOT, rel);
  mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = abs + ".tmp";
  writeFileSync(tmp, buf);
  renameSync(tmp, abs);
  const sha = createHash("sha256").update(buf).digest("hex");
  return { absPath: abs, relPath: rel.replace(/\\/g, "/"), size: buf.length, sha256: sha };
}

export function resolveStoredPath(relPath: string): string {
  const abs = path.resolve(STORAGE_ROOT, relPath);
  if (!abs.startsWith(path.resolve(STORAGE_ROOT))) {
    throw new Error("path escape");
  }
  return abs;
}

export function statStored(relPath: string): { exists: boolean; size?: number } {
  try {
    const abs = resolveStoredPath(relPath);
    if (!existsSync(abs)) return { exists: false };
    const st = statSync(abs);
    return { exists: true, size: st.size };
  } catch {
    return { exists: false };
  }
}

function guessExt(url: string): string | null {
  try {
    const u = new URL(url);
    const p = u.pathname;
    const m = p.match(/\.(mp4|webm|mov|png|jpg|jpeg|webp|gif|wav|mp3|m4a)(?:\?|$)/i);
    return m ? `.${m[1]!.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

/** HMAC 短效簽名網址，給 fal 當 image_url / video_url 輸入用 */
export function signAssetUrl(assetId: string, ttlSec = 3600): string {
  const secret = process.env.ASSET_SIGN_SECRET || "dev-sign-secret";
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `${assetId}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("hex");
  return `/api/assets/${assetId}/file?exp=${exp}&sig=${sig}`;
}

export function verifyAssetSig(assetId: string, exp: string, sig: string): boolean {
  const secret = process.env.ASSET_SIGN_SECRET || "dev-sign-secret";
  const expN = Number(exp);
  if (!Number.isFinite(expN) || expN < Math.floor(Date.now() / 1000)) return false;
  const payload = `${assetId}.${exp}`;
  const expect = createHmac("sha256", secret).update(payload).digest("hex");
  return expect === sig;
}
