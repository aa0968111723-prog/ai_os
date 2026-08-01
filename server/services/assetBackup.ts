/**
 * 素材 Volume 備份串流（GET /api/admin/backup/assets.tar.gz）。
 * UI（StorageAlertBanner）與 .env.example 已宣告此端點；此處補齊實作：
 * - 登入開發者 session，或 Authorization: Bearer $ADMIN_BACKUP_TOKEN（排程 curl）
 * - 串流 tar.gz（內含 assets/），並寫入 backup_runs 供 storageStatus.lastBackupAt
 */
import { TarArchive } from "archiver";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { STORAGE_ROOT } from "./storage";
import { resolveSession } from "./auth";

const ASSETS_DIR = path.join(STORAGE_ROOT, "assets");

/** timing-safe-ish 比對（權杖長度固定時可用；長度不同直接 false） */
function tokenMatches(provided: string, expected: string): boolean {
  if (!provided || !expected || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function extractBearer(req: Request): string | undefined {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return undefined;
  const m = /^Bearer\s+(\S+)/i.exec(raw.trim());
  return m?.[1];
}

export type BackupAuth =
  | { ok: true; triggeredBy: string }
  | { ok: false; status: number; error: string };

/**
 * 授權：Bearer ADMIN_BACKUP_TOKEN（排程）或開發者 session（管理頁下載）。
 * 權杖未設定時僅允許開發者登入——避免空字串權杖變成公開下載。
 */
export async function authorizeAssetBackup(req: Request): Promise<BackupAuth> {
  const expected = process.env.ADMIN_BACKUP_TOKEN?.trim() || "";
  const bearer = extractBearer(req);
  if (expected && bearer && tokenMatches(bearer, expected)) {
    return { ok: true, triggeredBy: "token" };
  }
  const auth = await resolveSession(req);
  if (auth?.user?.isSuperAdmin) {
    return { ok: true, triggeredBy: `user:${auth.user.id}` };
  }
  if (bearer && expected) {
    return { ok: false, status: 401, error: "備份權杖無效" };
  }
  if (bearer && !expected) {
    return { ok: false, status: 503, error: "伺服器未設定 ADMIN_BACKUP_TOKEN——請用開發者帳號登入後下載，或到部署平台 Variables 設定權杖" };
  }
  if (!auth) {
    return { ok: false, status: 401, error: "請先登入（開發者），或帶 Authorization: Bearer <ADMIN_BACKUP_TOKEN>" };
  }
  return { ok: false, status: 403, error: "只有開發者可以下載全站素材備份" };
}

async function countFilesRecursive(dir: string): Promise<{ files: number; bytes: number }> {
  let files = 0;
  let bytes = 0;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { files: 0, bytes: 0 };
  }
  for (const name of names) {
    const abs = path.join(dir, name);
    try {
      const s = await stat(abs);
      if (s.isDirectory()) {
        const sub = await countFilesRecursive(abs);
        files += sub.files;
        bytes += sub.bytes;
      } else if (s.isFile()) {
        files += 1;
        bytes += s.size;
      }
    } catch {
      /* skip unreadable */
    }
  }
  return { files, bytes };
}

/**
 * 串流 tar.gz 到 res，並寫 backup_runs。
 * 呼叫端應先 authorizeAssetBackup；此函式不重驗授權。
 */
export async function streamAssetsTarGz(res: Response, triggeredBy: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const counts = existsSync(ASSETS_DIR) ? await countFilesRecursive(ASSETS_DIR) : { files: 0, bytes: 0 };

  const [run] = await db
    .insert(schema.backupRuns)
    .values({
      kind: "assets",
      ok: false,
      fileCount: counts.files,
      totalBytes: counts.bytes,
      target: ASSETS_DIR,
      triggeredBy,
    })
    .returning({ id: schema.backupRuns.id });

  res.setHeader("Content-Type", "application/gzip");
  res.setHeader("Content-Disposition", `attachment; filename="aios_assets_${stamp}.tar.gz"`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Aios-Backup-Files", String(counts.files));
  res.setHeader("X-Aios-Backup-Bytes", String(counts.bytes));

  const archive = new TarArchive({ gzip: true });
  let finished = false;
  const finishRun = async (ok: boolean, error?: string) => {
    if (finished) return;
    finished = true;
    try {
      await db
        .update(schema.backupRuns)
        .set({
          ok,
          finishedAt: new Date(),
          error: error ?? null,
          totalBytes: archive.pointer() || counts.bytes,
        })
        .where(eq(schema.backupRuns.id, run.id));
    } catch (err) {
      console.warn("[backup] 寫入 backup_runs 失敗：", err instanceof Error ? err.message : err);
    }
  };

  archive.on("error", (err: Error) => {
    console.error("[backup] archive error:", err.message);
    void finishRun(false, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "打包素材失敗" });
    } else {
      try {
        res.destroy(err);
      } catch {
        /* ignore */
      }
    }
  });

  res.on("close", () => {
    // 客戶端中斷：仍記一筆（可能不完整）
    if (!finished) void finishRun(false, "client closed before complete");
  });

  archive.pipe(res);

  if (existsSync(ASSETS_DIR)) {
    archive.directory(ASSETS_DIR, "assets");
  } else {
    // 空備份仍給合法 tar（含 README 說明）
    archive.append(
      Buffer.from(
        `素材目錄尚不存在：${ASSETS_DIR}\n掛上 Volume 並產生素材後再備份。\n`,
        "utf8",
      ),
      { name: "README.txt" },
    );
  }

  try {
    await archive.finalize();
    await finishRun(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await finishRun(false, msg);
    if (!res.headersSent) res.status(500).json({ error: "打包素材失敗" });
  }
}
