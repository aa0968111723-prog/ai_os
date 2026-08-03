/**
 * 個人頭像存取：獨立於專案素材池，寫在 STORAGE_ROOT/avatars/{userId}.jpg。
 * 前端以 canvas 壓成 JPEG（≤256px、≤150KB data URL）後送來；伺服器只驗格式與大小。
 */
import { mkdir, writeFile, unlink, access } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { STORAGE_ROOT } from "./storage";

const AVATARS_DIR = path.join(STORAGE_ROOT, "avatars");
/** 解碼後上限（約 150KB data URL ≈ 112KB binary） */
export const MAX_AVATAR_BYTES = 150 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export function avatarRelPath(userId: string, ext: ".jpg" | ".png" | ".webp" = ".jpg"): string {
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
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return null;
  try {
    const buffer = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    if (buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) return null;
    if (mime === "image/jpeg" && !(buffer[0] === 0xff && buffer[1] === 0xd8)) return null;
    if (mime === "image/png" && !(buffer[0] === 0x89 && buffer.subarray(1, 4).toString("latin1") === "PNG")) return null;
    if (mime === "image/webp" && buffer.subarray(0, 4).toString("latin1") !== "RIFF") return null;
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

export async function saveUserAvatar(userId: string, dataUrl: string): Promise<{ avatarUrl: string }> {
  const parsed = parseAvatarDataUrl(dataUrl);
  if (!parsed) throw new Error("頭像格式不支援或檔案過大（請用 JPEG／PNG／WebP，壓縮後小於 150KB）");

  const ext = extForMime(parsed.mime);
  const rel = avatarRelPath(userId, ext);
  await mkdir(AVATARS_DIR, { recursive: true });
  const abs = avatarAbsPath(rel);
  await writeFile(abs, parsed.buffer);

  for (const other of [".jpg", ".png", ".webp"] as const) {
    if (other === ext) continue;
    try {
      await unlink(avatarAbsPath(avatarRelPath(userId, other)));
    } catch {
      /* 不存在就算了 */
    }
  }

  await db.update(schema.users).set({ avatarUrl: rel }).where(eq(schema.users.id, userId));
  return { avatarUrl: `/api/avatars/${userId}?v=${Date.now()}` };
}

export async function clearUserAvatar(userId: string): Promise<void> {
  const [user] = await db.select({ avatarUrl: schema.users.avatarUrl }).from(schema.users).where(eq(schema.users.id, userId));
  if (user?.avatarUrl && isAvatarRelPath(user.avatarUrl)) {
    try {
      await unlink(avatarAbsPath(user.avatarUrl));
    } catch {
      /* 檔已不在 */
    }
  }
  for (const ext of [".jpg", ".png", ".webp"] as const) {
    try {
      await unlink(avatarAbsPath(avatarRelPath(userId, ext)));
    } catch {
      /* ignore */
    }
  }
  await db.update(schema.users).set({ avatarUrl: null }).where(eq(schema.users.id, userId));
}

export async function resolveAvatarFile(userId: string): Promise<{ abs: string; mime: string } | null> {
  const [user] = await db.select({ avatarUrl: schema.users.avatarUrl }).from(schema.users).where(eq(schema.users.id, userId));
  if (!user?.avatarUrl || !isAvatarRelPath(user.avatarUrl)) return null;
  const abs = avatarAbsPath(user.avatarUrl);
  try {
    await access(abs);
  } catch {
    return null;
  }
  const lower = user.avatarUrl.toLowerCase();
  const mime = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return { abs, mime };
}

export function publicAvatarUrl(userId: string, avatarUrl: string | null | undefined): string | null {
  if (!avatarUrl || !isAvatarRelPath(avatarUrl)) return null;
  return `/api/avatars/${userId}`;
}
