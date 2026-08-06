/**
 * 個人頭像存取：獨立於專案素材池，相對路徑固定為 avatars/{userId}.{ext}。
 * 前端以 canvas 壓成 JPEG（≤256px、≤150KB data URL）後送來；伺服器只驗格式與大小。
 *
 * 落地位置跟著全站儲存後端走（本機 Volume 或 S3／MinIO）——頭像若還留在容器本地磁碟，
 * 就會變成「素材都在、只有大頭貼每次部署消失」的怪現象。
 */
import { mkdir, writeFile, unlink, access } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { STORAGE_ROOT, storageBackend } from "./storage";
import { deleteObject, headObject, putObject } from "./objectStore";

const AVATARS_DIR = path.join(STORAGE_ROOT, "avatars");
/** 解碼後上限（約 150KB data URL ≈ 112KB binary） */
export const MAX_AVATAR_BYTES = 150 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function avatarRelPath(userId: string, ext: ".jpg" | ".png" | ".webp" = ".jpg"): string {
  // 路徑只允許 uuid 形狀，防路徑跳脫
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("非法使用者 id");
  return path.posix.join("avatars", `${userId}${ext}`);
}

export function avatarAbsPath(rel: string): string {
  const base = path.resolve(AVATARS_DIR);
  const abs = path.resolve(STORAGE_ROOT, rel);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error("非法頭像路徑");
  }
  return abs;
}

export function isAvatarRelPath(p: string): boolean {
  return /^avatars\/[0-9a-f-]{36}\.(jpe?g|png|webp)$/i.test(p);
}

/** 解析 data URL → { mime, buffer }；失敗回 null */
export function parseAvatarDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  if (typeof dataUrl !== "string") return null;
  const trimmed = dataUrl.trim();
  // 快速長度上限檢查：150KB binary 約 200KB base64，加上 prefix 最長約 250KB，防止過長字串跑 regex
  if (trimmed.length > 250 * 1024) return null;
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(trimmed);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  try {
    const buffer = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) return null;
    // magic bytes 核對
    if (mime === "image/jpeg" && !(buffer[0] === 0xff && buffer[1] === 0xd8)) return null;
    if (mime === "image/png" && !(buffer[0] === 0x89 && buffer.subarray(1, 4).toString("latin1") === "PNG")) return null;
    if (mime === "image/webp") {
      if (buffer.length < 12) return null;
      if (buffer.subarray(0, 4).toString("latin1") !== "RIFF") return null;
      if (buffer.subarray(8, 12).toString("latin1") !== "WEBP") return null;
    }
    return { mime, buffer };
  } catch {
    return null;
  }
}

function extForMime(mime: string): ".jpg" | ".png" | ".webp" {
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".jpg";
}

/**
 * 寫入頭像並更新 users.avatar_url。回傳可給前端的公開路徑（含 cache-bust）。
 * 公開路徑固定為 /api/avatars/:userId，實際副檔名由 DB avatar_url 決定。
 */
export async function saveUserAvatar(userId: string, dataUrl: string): Promise<{ avatarUrl: string }> {
  const parsed = parseAvatarDataUrl(dataUrl);
  if (!parsed) throw new Error("頭像格式不支援或檔案過大（請用 JPEG／PNG／WebP，壓縮後小於 150KB）");

  const ext = extForMime(parsed.mime);
  const rel = avatarRelPath(userId, ext);
  if (storageBackend() === "object") {
    await putObject(rel, parsed.buffer, parsed.mime);
  } else {
    await mkdir(AVATARS_DIR, { recursive: true });
    await writeFile(avatarAbsPath(rel), parsed.buffer);
  }

  // 清掉其他副檔名的舊檔（使用者可能從 png 換成 jpg）
  for (const other of [".jpg", ".png", ".webp"] as const) {
    if (other === ext) continue;
    await removeAvatarFile(avatarRelPath(userId, other));
  }

  await db.update(schema.users).set({ avatarUrl: rel }).where(eq(schema.users.id, userId));
  // cache-bust：前端用 /api/avatars/:id?v=timestamp
  return { avatarUrl: `/api/avatars/${userId}?v=${Date.now()}` };
}

/** 刪一個頭像檔（兩種後端共用）；不存在不算錯 */
async function removeAvatarFile(rel: string): Promise<void> {
  try {
    if (storageBackend() === "object") await deleteObject(rel);
    else await unlink(avatarAbsPath(rel));
  } catch {
    /* 檔已不在 */
  }
}

export async function clearUserAvatar(userId: string): Promise<void> {
  const [user] = await db.select({ avatarUrl: schema.users.avatarUrl }).from(schema.users).where(eq(schema.users.id, userId));
  if (user?.avatarUrl && isAvatarRelPath(user.avatarUrl)) await removeAvatarFile(user.avatarUrl);
  // 保險：清三種副檔名
  for (const ext of [".jpg", ".png", ".webp"] as const) await removeAvatarFile(avatarRelPath(userId, ext));
  await db.update(schema.users).set({ avatarUrl: null }).where(eq(schema.users.id, userId));
}

export function mimeForAvatarPath(rel: string): string {
  const lower = rel.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * 讀取目前頭像的位置。
 * - 本機後端回 `{ kind: "local", abs }`（呼叫端用 res.sendFile）
 * - 物件儲存後端回 `{ kind: "object", rel }`（呼叫端串流）
 * 檔案實際不存在時回 null——資料庫記了但檔沒了（換過磁碟）不該回 500。
 */
export async function resolveAvatarFile(
  userId: string,
): Promise<{ kind: "local"; abs: string; rel: string; mime: string } | { kind: "object"; rel: string; mime: string } | null> {
  const [user] = await db.select({ avatarUrl: schema.users.avatarUrl }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.avatarUrl || !isAvatarRelPath(user.avatarUrl)) return null;
  const rel = user.avatarUrl;
  const mime = mimeForAvatarPath(rel);
  if (storageBackend() === "object") {
    const stat = await headObject(rel).catch(() => ({ exists: false }));
    return stat.exists ? { kind: "object", rel, mime } : null;
  }
  const abs = avatarAbsPath(rel);
  try {
    await access(abs);
  } catch {
    return null;
  }
  return { kind: "local", abs, rel, mime };
}

/** AuthState 用的公開 URL（無 cache-bust；前端可自行加） */
export function publicAvatarUrl(userId: string, avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl || !isAvatarRelPath(avatarUrl)) return null;
  return `/api/avatars/${userId}`;
}
