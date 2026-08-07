/**
 * 專案分享連結（唯讀公開檢視）——把整個專案頁以唯讀形式分享給還沒有帳號的夥伴。
 *
 * ★ 這是全庫唯一「不需登入就讀得到專案內容」的路徑，安全形狀刻意收得很窄：
 *   - DB 只存 token 的 SHA-256（比照 sessions／invites／upload_grants），原文只在建立當下回一次。
 *   - 可設有效期、可隨時撤銷；撤銷後同一條連結立刻失效（不必等 token 過期）。
 *   - 對外只有 buildSharedProjectView 一個出口決定「哪些欄位會被看到」。要多開欄位請改這裡，
 *     不要在 router 另外補查詢——出口只有一個，才能一眼看完公開面。
 *   - 一律唯讀：公開路徑上沒有任何 mutation，連結持有者不能改動任何東西。
 *
 * 素材圖片走既有的 HMAC 簽名網址（signAssetPath），同樣不需登入、短效、外人不可偽造。
 * 代價要說清楚：已發出的簽名網址在到期前不受撤銷影響——撤銷擋的是「再拿到新網址」，
 * 已在別人手上的那批圖最長還能開 SHARE_MEDIA_TTL_SECONDS 這麼久。
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { signAssetPath } from "./storage";

/** 分享連結的路徑前綴（前端路由 /s/:token 與此一致） */
export const SHARE_PATH_PREFIX = "/s/";

/** 素材簽名網址效期：檢視頁會定期重抓整包，過期前就換到新網址 */
export const SHARE_MEDIA_TTL_SECONDS = 3600;

/** 可選的有效期上限（天）：不設＝永久有效，由建立者自己記得撤銷 */
export const SHARE_MAX_EXPIRES_DAYS = 365;

/** 同一條連結多久才再記一次「最近開啟」——每次瀏覽都寫庫會把熱門連結變成寫入熱點 */
const VIEW_TOUCH_THROTTLE_MS = 60_000;

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** 產生分享 token：32 bytes 亂數轉 hex（64 字），與 session token 同強度 */
export function generateShareToken(): string {
  return randomBytes(32).toString("hex");
}

/** 連結為何不能用——分開回報是為了讓檢視頁能說人話（「已撤銷」vs「已過期」） */
export type ShareLinkRejection = "not-found" | "revoked" | "expired" | "project-gone";

export interface ShareLinkRow {
  id: string;
  projectId: string;
  groupId: string;
  label: string | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

/**
 * 純函式：一列分享連結在指定時刻是否可用（撤銷 → 過期，順序固定）。
 * 抽出來是為了讓「什麼情況該擋」可以單獨測，不必架一個資料庫。
 */
export function classifyShareLink(
  row: Pick<ShareLinkRow, "expiresAt" | "revokedAt"> | undefined | null,
  now: Date = new Date(),
): { ok: true } | { ok: false; reason: ShareLinkRejection } {
  if (!row) return { ok: false, reason: "not-found" };
  if (row.revokedAt) return { ok: false, reason: "revoked" };
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** token 形狀先擋一輪：長度／字元不對的直接當找不到，不必打 DB（掃描器最常送這種） */
export function isWellFormedShareToken(token: string): boolean {
  return /^[0-9a-f]{64}$/.test(token);
}

/**
 * 以原文 token 解析出可用的分享連結；不可用時回傳原因（不透露專案是否存在）。
 * 註：這裡不做限流——限流屬於「誰在打這支 API」，由 router 以來源 IP 決定。
 */
export async function resolveShareLink(
  token: string,
  now: Date = new Date(),
): Promise<{ ok: true; link: ShareLinkRow } | { ok: false; reason: ShareLinkRejection }> {
  if (!isWellFormedShareToken(token)) return { ok: false, reason: "not-found" };
  const [row] = await db
    .select({
      id: schema.projectShareLinks.id,
      projectId: schema.projectShareLinks.projectId,
      groupId: schema.projectShareLinks.groupId,
      label: schema.projectShareLinks.label,
      expiresAt: schema.projectShareLinks.expiresAt,
      revokedAt: schema.projectShareLinks.revokedAt,
    })
    .from(schema.projectShareLinks)
    .where(eq(schema.projectShareLinks.tokenHash, hashShareToken(token)));

  const verdict = classifyShareLink(row, now);
  if (!verdict.ok) return verdict;
  return { ok: true, link: row };
}

/** 記一次瀏覽（節流；失敗不影響檢視——統計壞掉不該讓連結打不開） */
export async function recordShareView(linkId: string): Promise<void> {
  const cutoff = new Date(Date.now() - VIEW_TOUCH_THROTTLE_MS);
  await db
    .update(schema.projectShareLinks)
    .set({ viewCount: sql`${schema.projectShareLinks.viewCount} + 1`, lastViewedAt: new Date() })
    .where(and(
      eq(schema.projectShareLinks.id, linkId),
      sql`(${schema.projectShareLinks.lastViewedAt} is null or ${schema.projectShareLinks.lastViewedAt} < ${cutoff})`,
    ))
    .catch(() => {});
}

/**
 * 專案素材的公開網址：已落地的走簽名路徑（免登入、短效），
 * 純外部網址（尚未落地的 CDN 連結）照原樣帶出去——它本來就是公開可取的。
 */
function publicMediaUrl(asset: { id: string; url: string; storagePath: string | null }): string {
  return asset.storagePath ? signAssetPath(asset.id, SHARE_MEDIA_TTL_SECONDS) : asset.url;
}

export interface SharedProjectView {
  project: {
    title: string;
    kind: string;
    platform: string;
    format: string;
    status: string;
    coverUrl: string | null;
    createdAt: Date;
    updatedAt: Date;
  };
  worldview: Record<string, unknown>;
  characters: { id: string; name: string; appearance: string; notes: string | null; imageUrl: string | null }[];
  scenePresets: { id: string; name: string; palette: string; lighting: string | null; imageUrl: string | null }[];
  props: { id: string; name: string; appearance: string; notes: string | null; imageUrl: string | null }[];
  knowledge: { id: string; kind: string; title: string; content: string; pinned: boolean; createdAt: Date }[];
  assets: { id: string; kind: string; title: string; url: string; mime: string | null; isAiGenerated: boolean; createdAt: Date }[];
  scenes: {
    id: string;
    orderIndex: number;
    title: string;
    durationSec: number;
    status: string;
    prompt: string | null;
    voiceover: string | null;
    imageUrl: string | null;
    mime: string | null;
  }[];
}

/**
 * 組出唯讀檢視要用的整包資料（單一公開出口）。
 *
 * 刻意不含的東西，是有意識的取捨而非遺漏：
 * - 任何人的身分（誰建的、誰上傳的、誰留言）——對外分享不該連帶公開組員名單。
 * - 回收桶內容（一律 isNull(deletedAt)）：刪掉的逐字稿絕不能從公開連結復活。
 * - 生成紀錄／AI 對話／點數與成本：那是內部工作痕跡，不是給夥伴看的成果。
 */
export async function buildSharedProjectView(projectId: string): Promise<SharedProjectView | null> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) return null;

  const [characters, scenePresets, props, knowledge, assets, scenes] = await Promise.all([
    db.select().from(schema.characters).where(eq(schema.characters.projectId, projectId)).orderBy(asc(schema.characters.createdAt)),
    db.select().from(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId)).orderBy(asc(schema.scenePresets.createdAt)),
    db.select().from(schema.props).where(eq(schema.props.projectId, projectId)).orderBy(asc(schema.props.createdAt)),
    db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.projectId, projectId), isNull(schema.knowledge.deletedAt)))
      .orderBy(desc(schema.knowledge.pinned), asc(schema.knowledge.createdAt)),
    db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.projectId, projectId), isNull(schema.assets.deletedAt)))
      .orderBy(desc(schema.assets.createdAt)),
    db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt)))
      .orderBy(asc(schema.scenes.orderIndex)),
  ]);

  /** 素材 id → 公開網址；參考圖與分鏡畫面都從這張表取，取不到（已進回收桶）就當沒有圖 */
  const mediaById = new Map(assets.map((a) => [a.id, publicMediaUrl(a)]));
  const mimeById = new Map(assets.map((a) => [a.id, a.mime]));
  const refUrl = (assetId: string | null) => (assetId ? mediaById.get(assetId) ?? null : null);

  return {
    project: {
      title: project.title,
      kind: project.kind,
      platform: project.platform,
      format: project.format,
      status: project.status,
      coverUrl: refUrl(project.coverAssetId),
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    },
    worldview: (project.worldview ?? {}) as Record<string, unknown>,
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      appearance: c.appearance,
      notes: c.notes,
      imageUrl: refUrl(c.referenceAssetId),
    })),
    scenePresets: scenePresets.map((s) => ({
      id: s.id,
      name: s.name,
      palette: s.palette,
      lighting: s.lighting,
      imageUrl: refUrl(s.referenceAssetId),
    })),
    props: props.map((p) => ({
      id: p.id,
      name: p.name,
      appearance: p.appearance,
      notes: p.notes,
      imageUrl: refUrl(p.referenceAssetId),
    })),
    knowledge: knowledge.map((k) => ({
      id: k.id,
      kind: k.kind,
      title: k.title,
      content: k.content,
      pinned: k.pinned,
      createdAt: k.createdAt,
    })),
    assets: assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      url: publicMediaUrl(a),
      mime: a.mime,
      isAiGenerated: a.isAiGenerated,
      createdAt: a.createdAt,
    })),
    scenes: scenes.map((s) => ({
      id: s.id,
      orderIndex: s.orderIndex,
      title: s.title,
      durationSec: s.durationSec,
      status: s.status,
      prompt: s.prompt,
      voiceover: s.voiceover,
      imageUrl: refUrl(s.assetId),
      mime: s.assetId ? mimeById.get(s.assetId) ?? null : null,
    })),
  };
}
