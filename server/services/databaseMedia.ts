/**
 * 資料庫媒體層（圖影分類與資訊量統計）：
 * - AI 看圖分類：對資料庫文件層的「圖片」直呼 fal 視覺模型（比照 voiceTranscribe 的直呼先例），
 *   產出繁中描述（aiDescription）＋分類標籤（category）——圖影從「僅存檔」變成 AI 可讀可答。
 *   計費沿用點數守門（reserveQuota/refund）；E2E_MOCK 回確定性結果、不扣點。
 * - 資訊量統計（tableStats）：列數／文件數／各媒體類型分佈／總容量／AI 可讀字數／分類分佈，
 *   tRPC（前端資訊量面板）與 MCP get_database_stats 共用同一套，零漂移。
 */
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { getModel } from "../../shared/models";
import { FILE_CATEGORY_SUGGESTIONS, normalizeFileCategory } from "../../shared/databaseFields";
import { falSubmit, falStatus, isMockMode } from "./fal";
import { reserveQuota, refund } from "./points";
import { signDbFileUrl } from "./storage";
import type { AuthState } from "./auth";
import { extractJsonObject, stripJsonObject } from "./assistantCore";

export type DataFileRow = typeof schema.dataFiles.$inferSelect;
type DataTableRow = typeof schema.dataTables.$inferSelect;

/**
 * 看圖分類的視覺模型（單一設定點，環境變數可換免改碼）：
 * 預設 any-llm/vision#gemini-2.5-flash——目錄註記「繁中描述自然、批量看圖生繁中描述」，1 點/次。
 */
export const DB_VISION_MODEL_ID = process.env.DB_VISION_MODEL_ID?.trim() || "fal-ai/any-llm/vision#gemini-2.5-flash";

const CLASSIFY_TIMEOUT_MS = 90_000;
const CLASSIFY_POLL_MS = 2_500;
/** AI 描述長度上限：夠寫 3 句話，又不會把助手上下文灌爆 */
export const MAX_AI_DESCRIPTION = 2_000;

/** 媒體類別（與 storage.kindFromMime 同口徑；這裡獨立實作避免 storage 的磁碟相依進單元測試） */
export function mediaKindOf(mime: string): "image" | "video" | "audio" | "doc" {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "doc";
}

/**
 * 解析視覺模型回覆（純函式，單元可測）：JSON 的 description/category 優先；
 * 壞 JSON／缺鍵時把整段文字當描述、分類退「其他」——模型輸出再歪也不讓分類流程 500。
 */
export function parseClassifyReply(raw: string): { description: string; category: string } {
  const extracted = extractJsonObject(raw);
  if (extracted && typeof extracted === "object" && !Array.isArray(extracted)) {
    const j = extracted as { description?: unknown; category?: unknown };
    const description = typeof j.description === "string" && j.description.trim()
      ? j.description.trim().slice(0, MAX_AI_DESCRIPTION)
      : null;
    if (description) {
      return { description, category: normalizeFileCategory(j.category) ?? "其他" };
    }
  }
  const text = stripJsonObject(raw) || raw.trim();
  return { description: (text || "（模型沒有回傳描述）").slice(0, MAX_AI_DESCRIPTION), category: "其他" };
}

/**
 * 分類計點的歸屬組（純函式，單元可測）：組庫記到該組；個人／團隊／全站庫記到使用者的第一個組
 * （點數守門以「人×組」為軸，個人庫沒有組歸屬，取本人任一組即可——額度仍是本人的）。
 * null＝使用者不屬於任何組（無法計點，呼叫端給人話錯誤）。
 */
export function billingGroupIdFor(
  auth: Pick<AuthState, "groups">,
  table: Pick<DataTableRow, "scope" | "groupId">,
): string | null {
  if (table.scope === "group" && table.groupId) return table.groupId;
  return auth.groups[0]?.groupId ?? null;
}

// 處理中認領（單容器部署，程序內 Set 足夠；比照 voiceTranscribe.inflight）：
// 同一張圖連點兩次「AI 分類」會重複送 fal＋重複扣點，認領在任何 await 之前同步完成。
const classifying = new Set<string>();

/**
 * 對一份「圖片」文件做 AI 看圖分類：產生繁中描述＋分類標籤並回填 DB。
 * 存取權（canWriteRows）由呼叫端解析後才進來（與 databaseCore 同一分工）。
 * 錯誤以人話 Error 拋出（呼叫端轉 TRPCError／MCP 錯誤）。
 */
export async function classifyDatabaseFile(
  auth: AuthState,
  file: DataFileRow,
  table: DataTableRow,
): Promise<{ category: string; aiDescription: string; points: number }> {
  if (mediaKindOf(file.mime) !== "image") {
    throw new Error("AI 自動分類目前支援圖片——影片／音訊／文件請直接手動選分類");
  }
  if (!file.storagePath) throw new Error("這份文件沒有原始檔案，無法看圖分類");
  if (classifying.has(file.id)) throw new Error("這張圖片正在分類中——稍等幾秒再試");
  classifying.add(file.id);
  try {
    // 既有分類當候選（AI 優先沿用團隊在用的標籤，避免同義分類發散），再補建議清單
    const existing = await db
      .selectDistinct({ category: schema.dataFiles.category })
      .from(schema.dataFiles)
      .where(and(eq(schema.dataFiles.tableId, table.id), isNotNull(schema.dataFiles.category)))
      .limit(30);
    const candidates = [...new Set([...existing.map((r) => r.category!).filter(Boolean), ...FILE_CATEGORY_SUGGESTIONS])];

    // 測試模式：確定性結果、不扣點、不出網（e2e 可離線驗整條流程）
    if (isMockMode()) {
      const category = candidates[0] ?? "其他";
      const aiDescription = `（測試模式）圖片「${file.name}」的 AI 描述示例——正式模式由視覺模型實際看圖產生繁中描述並自動分類。`;
      await db.update(schema.dataFiles).set({ category, aiDescription }).where(eq(schema.dataFiles.id, file.id));
      return { category, aiDescription, points: 0 };
    }

    const model = getModel(DB_VISION_MODEL_ID);
    if (!model) throw new Error(`視覺模型 ${DB_VISION_MODEL_ID} 不在模型目錄——請檢查 DB_VISION_MODEL_ID 環境變數`);
    const cost = model.points ?? 1;
    const groupId = billingGroupIdFor(auth, table);
    if (!groupId) throw new Error("你目前不屬於任何組、無法計點——請先請管理員把你加進一個組");
    const quotaErr = await reserveQuota(auth.user.id, groupId, cost, "資料庫圖片 AI 分類");
    if (quotaErr) throw new Error(quotaErr);
    try {
      // 簽名網址讓 fal 免登入抓圖（短效；dbfile 簽名分域，素材簽名不可互換）
      const sourceUrl = signDbFileUrl(file.id, CLASSIFY_TIMEOUT_MS / 1000 + 120);
      const prompt = [
        "你是素材管理助手。看這張圖片，只回一個 JSON、不要任何多餘文字：",
        `{"description":"用繁體中文 1～3 句描述圖片內容（主體、場景、氛圍、可辨識的文字）","category":"從候選分類挑最貼切的一個：${candidates.join("、")}；都不合適就自創一個 2～6 字的繁中分類"}`,
      ].join("\n");
      const input = model.input(prompt, "16:9", sourceUrl) as Record<string, unknown>;
      const { requestId } = await falSubmit(model.endpoint ?? model.id, "text", input);
      const deadline = Date.now() + CLASSIFY_TIMEOUT_MS;
      for (;;) {
        const st = await falStatus(model.endpoint ?? model.id, "text", requestId);
        if (st.status === "done") {
          const parsed = parseClassifyReply(st.resultText ?? "");
          await db
            .update(schema.dataFiles)
            .set({ category: parsed.category, aiDescription: parsed.description })
            .where(eq(schema.dataFiles.id, file.id));
          return { category: parsed.category, aiDescription: parsed.description, points: cost };
        }
        if (st.status === "failed") throw new Error(st.error ?? "視覺模型呼叫失敗");
        if (Date.now() >= deadline) throw new Error("看圖分類逾時——請稍後再試");
        await new Promise((r) => setTimeout(r, CLASSIFY_POLL_MS));
      }
    } catch (err) {
      await refund(auth.user.id, groupId, cost, "資料庫圖片 AI 分類失敗退回");
      throw err instanceof Error ? err : new Error(String(err));
    }
  } finally {
    classifying.delete(file.id);
  }
}

/* ── 資訊量統計（tRPC stats 與 MCP get_database_stats 共用） ─────────── */

export interface TableStats {
  rowCount: number;
  fieldCount: number;
  files: {
    count: number;
    totalBytes: number;
    /** AI 可讀（有抽出文字）的文件數與總字數 */
    readableCount: number;
    readableChars: number;
    /** 已有 AI 看圖描述的圖影數 */
    describedCount: number;
    byKind: Array<{ kind: "image" | "video" | "audio" | "doc"; count: number; bytes: number }>;
  };
  /** 分類分佈（未分類不列；依數量降冪，最多 20 類） */
  categories: Array<{ category: string; count: number }>;
  /** 最後一次資料異動（列更新或文件加入；null＝還沒有內容） */
  lastActivityAt: Date | null;
}

export async function tableStats(table: Pick<DataTableRow, "id" | "fields">): Promise<TableStats> {
  const kindExpr = sql<string>`case
    when ${schema.dataFiles.mime} like 'image/%' then 'image'
    when ${schema.dataFiles.mime} like 'video/%' then 'video'
    when ${schema.dataFiles.mime} like 'audio/%' then 'audio'
    else 'doc' end`;
  const [rowAgg, kindAgg, catAgg, readAgg] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)`, last: sql<Date | string | null>`max(${schema.dataRows.updatedAt})` })
      .from(schema.dataRows)
      .where(eq(schema.dataRows.tableId, table.id)),
    db
      .select({ kind: kindExpr, n: sql<number>`count(*)`, bytes: sql<number>`coalesce(sum(${schema.dataFiles.sizeBytes}), 0)` })
      .from(schema.dataFiles)
      .where(eq(schema.dataFiles.tableId, table.id))
      .groupBy(kindExpr),
    db
      .select({ category: schema.dataFiles.category, n: sql<number>`count(*)` })
      .from(schema.dataFiles)
      .where(and(eq(schema.dataFiles.tableId, table.id), isNotNull(schema.dataFiles.category)))
      .groupBy(schema.dataFiles.category)
      .orderBy(desc(sql`count(*)`))
      .limit(20),
    db
      .select({
        readable: sql<number>`count(*) filter (where ${schema.dataFiles.textContent} is not null)`,
        chars: sql<number>`coalesce(sum(length(${schema.dataFiles.textContent})), 0)`,
        described: sql<number>`count(*) filter (where ${schema.dataFiles.aiDescription} is not null)`,
        lastFile: sql<Date | string | null>`max(${schema.dataFiles.createdAt})`,
      })
      .from(schema.dataFiles)
      .where(eq(schema.dataFiles.tableId, table.id)),
  ]);

  const byKind = (["image", "video", "audio", "doc"] as const).map((kind) => {
    const hit = kindAgg.find((k) => k.kind === kind);
    return { kind, count: Number(hit?.n ?? 0), bytes: Number(hit?.bytes ?? 0) };
  });
  const lastRow = rowAgg[0]?.last ? new Date(rowAgg[0].last) : null;
  const lastFile = readAgg[0]?.lastFile ? new Date(readAgg[0].lastFile) : null;
  const lastActivityAt =
    lastRow && lastFile ? (lastRow.getTime() > lastFile.getTime() ? lastRow : lastFile) : (lastRow ?? lastFile);

  return {
    rowCount: Number(rowAgg[0]?.n ?? 0),
    fieldCount: Array.isArray(table.fields) ? (table.fields as unknown[]).length : 0,
    files: {
      count: byKind.reduce((s, k) => s + k.count, 0),
      totalBytes: byKind.reduce((s, k) => s + k.bytes, 0),
      readableCount: Number(readAgg[0]?.readable ?? 0),
      readableChars: Number(readAgg[0]?.chars ?? 0),
      describedCount: Number(readAgg[0]?.described ?? 0),
      byKind,
    },
    categories: catAgg.map((c) => ({ category: c.category!, count: Number(c.n) })),
    lastActivityAt,
  };
}

const KIND_LABEL: Record<"image" | "video" | "audio" | "doc", string> = {
  image: "圖片", video: "影片", audio: "音訊", doc: "文件",
};

/** 資訊量一行摘要（純函式，單元可測）：助手上下文與 MCP 回覆共用的人話口徑 */
export function formatStatsLine(s: TableStats): string {
  const kinds = s.files.byKind.filter((k) => k.count > 0).map((k) => `${KIND_LABEL[k.kind]} ${k.count}`).join("、");
  const parts = [
    `資料 ${s.rowCount.toLocaleString()} 列（${s.fieldCount} 欄）`,
    s.files.count > 0 ? `文件 ${s.files.count} 份（${kinds}）共 ${fmtBytes(s.files.totalBytes)}` : "無附掛文件",
  ];
  if (s.files.readableChars > 0) parts.push(`AI 可讀 ${s.files.readableChars.toLocaleString()} 字`);
  if (s.files.describedCount > 0) parts.push(`已看圖描述 ${s.files.describedCount} 份`);
  if (s.categories.length > 0) {
    parts.push(`分類：${s.categories.slice(0, 8).map((c) => `${c.category} ${c.count}`).join("、")}`);
  }
  return parts.join("｜");
}

function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
