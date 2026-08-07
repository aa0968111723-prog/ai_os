/**
 * 筆記／知識庫附件核心：讓 tRPC、REST 上傳端點與未來的 Agent／MCP 共用同一組守門與資料形狀。
 *
 * 為什麼要有這一層：筆記本來只收純文字，但「0716 週會紀錄」真正的證據常常是白板照片、
 * 簽到表掃描檔、對方寄來的一份 PDF 講義；知識庫的開示稿也多半直接就是一份 PDF/Word。
 * 過去只能把檔案丟到素材庫或私訊，內容與出處就此分家。
 *
 * 兩件事情特別小心：
 * 1. 權限一律回推到母體（筆記＝作者本人或組長以上、知識庫＝專案可編輯者），
 *    不另開一套附件權限——否則「不能改這則筆記的人卻能刪它的附件」。
 * 2. 附件的純文字（PDF/Word/txt 抽取）存 text_content，知識庫注入 AI 導演時會一起帶上，
 *    所以刪除必須真的刪乾淨（列＋原檔），刪掉的講義不可再餵進 LLM。
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";
import { noteWriteDenied } from "./notesCore";
import { removeStoredFile } from "./storage";

export type AttachmentKind = "note" | "knowledge";
export const ATTACHMENT_KINDS: readonly AttachmentKind[] = ["note", "knowledge"] as const;

/** 單一筆記／單一知識條目的附件數上限：夠放一場會議的照片與講義，又擋得住把這裡當網路硬碟 */
export const ATTACHMENTS_PER_REF_MAX = 30;
/** 檔名顯示長度上限（超過截尾，不擋上傳） */
export const ATTACHMENT_NAME_MAX = 120;
/** 注入 AI 時，單份附件最多帶多少字（避免一份 300 頁 PDF 吃掉整個知識預算） */
export const ATTACHMENT_INJECT_CHARS = 4_000;

export type AttachmentRow = typeof schema.contentAttachments.$inferSelect;

export interface AttachmentSummary {
  id: string;
  kind: AttachmentKind;
  refId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  /** image/video/audio/doc：前端據此決定顯示縮圖還是檔案列 */
  media: "image" | "video" | "audio" | "doc";
  /** 抽出的純文字字數（0＝沒抽到，例如照片）；知識庫附件靠它顯示「AI 讀得到 N 字」 */
  readableChars: number;
  url: string;
  uploadedBy: string;
  uploaderName: string;
  createdAt: Date;
}

export function attachmentUrl(id: string): string {
  return `/api/attachments/${id}/file`;
}

function mediaOf(mime: string): AttachmentSummary["media"] {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "doc";
}

export function attachmentNameChecked(value: string, fallback = "附件"): string {
  const name = value.trim().replace(/[\r\n\t]+/g, " ");
  return (name || fallback).slice(0, ATTACHMENT_NAME_MAX);
}

/** 母體查驗的結果：附件列要冗餘存 groupId，注入／檔案服務也要知道掛在哪個專案 */
export interface AttachTarget {
  kind: AttachmentKind;
  refId: string;
  groupId: string;
  projectId: string | null;
  /** 母體標題，錯誤訊息與審計用 */
  title: string;
}

export function parseAttachmentKind(value: string): AttachmentKind {
  if (value === "note" || value === "knowledge") return value;
  throw new TRPCError({ code: "BAD_REQUEST", message: "附件類別只支援 note／knowledge" });
}

/**
 * 母體存在性＋權限查驗。mode='read' 只要求同組；mode='write'（上傳／刪除）比照母體的寫入權：
 * - 筆記：作者本人或組長以上；掛專案者另需專案未封存且非檢視者
 * - 知識庫：專案可編輯者（2.3 檢視者不可寫）
 */
export async function assertAttachTarget(
  auth: AuthState,
  kind: AttachmentKind,
  refId: string,
  mode: "read" | "write",
): Promise<AttachTarget> {
  if (kind === "note") {
    const [row] = await db.select().from(schema.notes).where(eq(schema.notes.id, refId));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這則筆記" });
    const role = requireGroup(auth, row.groupId);
    if (mode === "write") {
      if (noteWriteDenied(row.createdBy, auth.user.id, role)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有作者本人或組長以上可以增刪筆記附件" });
      }
      if (row.projectId) await assertProjectWritable(auth, row.groupId, row.projectId);
    }
    return { kind, refId: row.id, groupId: row.groupId, projectId: row.projectId, title: row.title };
  }

  const [row] = await db.select().from(schema.knowledge).where(eq(schema.knowledge.id, refId));
  if (!row || row.deletedAt) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆知識" });
  requireGroup(auth, row.groupId);
  if (mode === "write") {
    await assertProjectEditable(auth, { id: row.projectId, groupId: row.groupId });
  }
  return { kind, refId: row.id, groupId: row.groupId, projectId: row.projectId, title: row.title };
}

async function assertProjectWritable(auth: AuthState, groupId: string, projectId: string): Promise<void> {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project || project.groupId !== groupId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
  }
  assertProjectNotArchived(project);
  await assertProjectEditable(auth, project);
}

function toSummary(row: AttachmentRow, uploaderName: string | null): AttachmentSummary {
  return {
    id: row.id,
    kind: row.kind as AttachmentKind,
    refId: row.refId,
    name: row.name,
    mime: row.mime,
    sizeBytes: row.sizeBytes,
    media: mediaOf(row.mime),
    readableChars: row.textContent?.length ?? 0,
    url: attachmentUrl(row.id),
    uploadedBy: row.uploadedBy,
    uploaderName: uploaderName ?? "?",
    createdAt: row.createdAt,
  };
}

export async function listAttachmentsCore(
  auth: AuthState,
  kind: AttachmentKind,
  refId: string,
): Promise<AttachmentSummary[]> {
  await assertAttachTarget(auth, kind, refId, "read");
  return listAttachmentsUnchecked(kind, [refId]);
}

/**
 * 不做權限檢查的批次讀取——只給「呼叫端已經確認過可讀」的路徑用
 * （知識庫注入、清單一次帶回全部附件），避免對每一列各發一次守門查詢。
 */
export async function listAttachmentsUnchecked(
  kind: AttachmentKind,
  refIds: string[],
): Promise<AttachmentSummary[]> {
  if (refIds.length === 0) return [];
  const rows = await db
    .select({ att: schema.contentAttachments, uploaderName: schema.users.name })
    .from(schema.contentAttachments)
    .leftJoin(schema.users, eq(schema.users.id, schema.contentAttachments.uploadedBy))
    .where(and(
      eq(schema.contentAttachments.kind, kind),
      inArray(schema.contentAttachments.refId, refIds),
    ))
    .orderBy(desc(schema.contentAttachments.createdAt))
    .limit(ATTACHMENTS_PER_REF_MAX * Math.max(1, refIds.length));
  return rows.map((r) => toSummary(r.att, r.uploaderName));
}

/** 每個母體的附件數（清單上顯示「📎 3」用，不必把整份附件表撈回來） */
export async function countAttachmentsByRef(
  kind: AttachmentKind,
  refIds: string[],
): Promise<Map<string, number>> {
  if (refIds.length === 0) return new Map();
  const rows = await db
    .select({ refId: schema.contentAttachments.refId, n: sql<number>`count(*)` })
    .from(schema.contentAttachments)
    .where(and(
      eq(schema.contentAttachments.kind, kind),
      inArray(schema.contentAttachments.refId, refIds),
    ))
    .groupBy(schema.contentAttachments.refId);
  return new Map(rows.map((r) => [r.refId, Number(r.n)]));
}

/**
 * 建立附件列。呼叫端（REST 上傳端點）必須已經：驗過 MIME 檔頭、落地原檔、抽好純文字。
 * 這裡在同一交易內做「數量上限檢查 → insert」，避免併發上傳突破 30 檔上限。
 */
export async function addAttachmentCore(input: {
  auth: AuthState;
  target: AttachTarget;
  name: string;
  mime: string;
  sizeBytes: number;
  storagePath: string;
  textContent?: string | null;
}): Promise<{ ok: true; row: AttachmentRow } | { ok: false; error: string }> {
  return db.transaction(async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)` })
      .from(schema.contentAttachments)
      .where(and(
        eq(schema.contentAttachments.kind, input.target.kind),
        eq(schema.contentAttachments.refId, input.target.refId),
      ));
    if (Number(n) >= ATTACHMENTS_PER_REF_MAX) {
      return {
        ok: false as const,
        error: `附件數已達上限（每則最多 ${ATTACHMENTS_PER_REF_MAX} 個）——先刪掉用不到的，或另開一則`,
      };
    }
    const [row] = await tx
      .insert(schema.contentAttachments)
      .values({
        groupId: input.target.groupId,
        kind: input.target.kind,
        refId: input.target.refId,
        name: attachmentNameChecked(input.name),
        mime: input.mime,
        sizeBytes: input.sizeBytes,
        storagePath: input.storagePath,
        textContent: input.textContent ?? null,
        uploadedBy: input.auth.user.id,
      })
      .returning();
    return { ok: true as const, row: row! };
  });
}

export async function getAttachmentChecked(auth: AuthState, id: string): Promise<AttachmentRow> {
  const [row] = await db.select().from(schema.contentAttachments).where(eq(schema.contentAttachments.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個附件" });
  // 先擋組界（附件列自帶 group_id），再回推母體——母體被刪光的孤兒列不該還能讀
  requireGroup(auth, row.groupId);
  await assertAttachTarget(auth, row.kind as AttachmentKind, row.refId, "read");
  return row;
}

export async function removeAttachmentCore(auth: AuthState, id: string): Promise<{ ok: true }> {
  const [row] = await db.select().from(schema.contentAttachments).where(eq(schema.contentAttachments.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個附件" });
  requireGroup(auth, row.groupId);
  await assertAttachTarget(auth, row.kind as AttachmentKind, row.refId, "write");
  await db.delete(schema.contentAttachments).where(eq(schema.contentAttachments.id, row.id));
  // 先刪列再刪檔：檔案刪失敗最多留下孤兒檔（有 storage 稽核會掃到），
  // 反過來則會留下「點了下載卻 404」的列，對使用者更難解釋
  await removeStoredFile(row.storagePath).catch((e) => {
    console.warn("[attachments] 原檔刪除失敗（列已刪，孤兒檔待稽核清理）：", e instanceof Error ? e.message : e);
  });
  return { ok: true };
}

/**
 * 母體被刪除時的連帶清理。傳入 tx 就在同一交易刪列（母體刪除失敗時附件列不會先消失），
 * 原檔則在交易外刪——DB 交易 rollback 救不回已 unlink 的檔案。
 */
export async function purgeAttachmentsFor(
  kind: AttachmentKind,
  refId: string,
  tx: { select: typeof db.select; delete: typeof db.delete } = db,
): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.contentAttachments.id, storagePath: schema.contentAttachments.storagePath })
    .from(schema.contentAttachments)
    .where(and(eq(schema.contentAttachments.kind, kind), eq(schema.contentAttachments.refId, refId)));
  if (rows.length === 0) return [];
  await tx
    .delete(schema.contentAttachments)
    .where(and(eq(schema.contentAttachments.kind, kind), eq(schema.contentAttachments.refId, refId)));
  return rows.map((r) => r.storagePath);
}

/** 交易提交之後才呼叫：把 purgeAttachmentsFor 回傳的原檔真的刪掉（失敗只記錄，不影響主流程） */
export async function removeStoredFiles(paths: string[]): Promise<void> {
  for (const p of paths) {
    await removeStoredFile(p).catch((e) => {
      console.warn("[attachments] 原檔刪除失敗（孤兒檔待稽核清理）：", e instanceof Error ? e.message : e);
    });
  }
}

/**
 * 把一筆知識的附件文字組成可注入 LLM 的區塊（接在該筆內容之後）。
 * 純函式：讓注入預算的計算與截斷邏輯留在 shared/knowledgeInject，不必知道附件是怎麼存的。
 */
export function formatAttachmentInjectBlock(
  attachments: { name: string; textContent: string | null }[],
  perFileChars = ATTACHMENT_INJECT_CHARS,
): string {
  const parts = attachments
    .filter((a) => (a.textContent ?? "").trim().length > 0)
    .map((a) => {
      const text = a.textContent!.trim();
      const clipped = text.length > perFileChars ? `${text.slice(0, perFileChars)}…（附件過長，已截斷）` : text;
      return `【附件：${a.name}】\n${clipped}`;
    });
  return parts.join("\n\n");
}
