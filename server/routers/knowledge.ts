import { z } from "zod";
import { and, asc, desc, eq, isNull, like, notInArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { MODELS } from "../../shared/models";
import { isMockMode, extractResult } from "../services/fal";
import { proxyFetch } from "../services/http";
import { reserveQuota, refund } from "../services/points";
import { signAssetUrl } from "../services/storage";
import { assertProjectEditable } from "../services/projectAcl";

export const KNOWLEDGE_KINDS = [
  { id: "transcript", label: "師父開示稿" },
  { id: "testimony", label: "見證故事" },
  { id: "script", label: "腳本" },
  { id: "note", label: "其他筆記" },
] as const;

/** 單筆知識內容上限（避免超長逐字稿撐爆 DB／注入；夠放一篇開示或短腳本） */
const MAX_CONTENT = 40_000;
/** 注入 AI 導演時的預設總字數上限（LLM 上下文成本控制；超過只取前幾份＋截斷） */
const INJECT_BUDGET = 8_000;

/**
 * 把專案知識庫組成一段可注入 LLM 的上下文（給 director.suggest／assistant.ask 等重用）。
 * 依建立時間由新到舊取，總量到 budget 為止；回空字串代表沒有知識。
 * budget 依呼叫端的模型窗口自定（6.1 上下文窗口）：目前後端 LLM（gemini flash 系）窗口極大，
 * 上限主要是成本考量而非模型限制——助手可放寬、導演維持預設。
 *
 * 6.4 卡片↔知識庫同步：知識條目「之前」先注入角色定裝卡／場景設定卡的精簡段落——
 * 夥伴在卡片庫維護的設定（外觀錨點、色板光線）對 AI 導演與助手同步可見，
 * 不必再手動抄一份進知識庫；卡片字數也計入 budget（先扣卡片、剩餘額度才放知識長文）。
 */
export async function buildKnowledgeContext(projectId: string, budgetChars: number = INJECT_BUDGET): Promise<string> {
  // 三個查詢互不相依，並行省 DB 往返（知識照舊過濾軟刪除；卡片兩表沒有回收桶，全量即正確）
  const [rows, chars, presets] = await Promise.all([
    db
      .select()
      .from(schema.knowledge)
      // ★ 絕不注入已軟刪除（回收桶）的知識——刪掉的逐字稿／見證不可再餵給 AI 導演 LLM
      .where(and(eq(schema.knowledge.projectId, projectId), isNull(schema.knowledge.deletedAt)))
      .orderBy(desc(schema.knowledge.createdAt)),
    db.select().from(schema.characters).where(eq(schema.characters.projectId, projectId)).orderBy(asc(schema.characters.createdAt)),
    db.select().from(schema.scenePresets).where(eq(schema.scenePresets.projectId, projectId)).orderBy(asc(schema.scenePresets.createdAt)),
  ]);

  // 卡片段落（6.4）：欄位各自截短（外觀 160／個性 120 字）——卡片是「設定錨點」不是長文，
  // 截短後總量有界，因此整段完整注入、不被 budget 腰斬（斷在半張卡會餵給 LLM 誤導性的半截設定）。
  const cardParts: string[] = [];
  if (chars.length) {
    const lines = chars.map(
      (c) => `- ${c.name}：${c.appearance.slice(0, 160)}${c.notes?.trim() ? `｜個性：${c.notes.slice(0, 120)}` : ""}`,
    );
    cardParts.push(`【角色定裝卡】\n${lines.join("\n")}`);
  }
  if (presets.length) {
    const lines = presets.map(
      (s) => `- ${s.name}：色板 ${s.palette}${s.lighting?.trim() ? `｜光線 ${s.lighting}` : ""}`,
    );
    cardParts.push(`【場景設定卡】\n${lines.join("\n")}`);
  }
  const cardBlock = cardParts.join("\n");

  if (rows.length === 0 && !cardBlock) return "";
  const labelOf = (k: string) => KNOWLEDGE_KINDS.find((x) => x.id === k)?.label ?? k;
  const parts: string[] = [];
  let budget = Math.max(0, budgetChars);
  if (cardBlock) {
    parts.push(cardBlock);
    budget = Math.max(0, budget - cardBlock.length); // 卡片先佔額度，知識長文吃剩餘
  }
  for (const r of rows) {
    if (budget <= 0) break;
    const slice = r.content.slice(0, budget);
    parts.push(`【${labelOf(r.kind)}｜${r.title}】\n${slice}${r.content.length > slice.length ? "…(截斷)" : ""}`);
    budget -= slice.length;
  }
  return parts.join("\n\n");
}

/** 版本歷史（#29）每個 refId 保留的最近版本上限——超過就把最舊的刪掉，避免逐字稿版本無限累積撐爆 DB */
const VERSION_KEEP = 20;

/**
 * 把知識庫某筆「當前（更新前）」的 title+content 存成一版快照（kind='knowledge'、refId=知識 id），
 * 再修剪成此 refId 只保留最近 VERSION_KEEP 版。呼叫端負責只在「內容真的改變」時呼叫（避免灌雜訊版本）。
 */
async function snapshotKnowledge(
  row: { id: string; projectId: string; groupId: string; title: string; content: string },
  createdBy: string,
): Promise<void> {
  await db.insert(schema.textVersions).values({
    projectId: row.projectId,
    groupId: row.groupId,
    kind: "knowledge",
    refId: row.id,
    title: row.title,
    content: row.content,
    createdBy,
  });
  // 修剪：撈此 refId 由新到舊的前 VERSION_KEEP 筆，其餘（較舊）刪除。
  // 只在版本數已達上限時才刪，且 notInArray 的保留集合此時必為非空（= VERSION_KEEP 筆）。
  const keep = await db
    .select({ id: schema.textVersions.id })
    .from(schema.textVersions)
    .where(and(eq(schema.textVersions.kind, "knowledge"), eq(schema.textVersions.refId, row.id)))
    .orderBy(desc(schema.textVersions.createdAt))
    .limit(VERSION_KEEP);
  if (keep.length >= VERSION_KEEP) {
    await db
      .delete(schema.textVersions)
      .where(
        and(
          eq(schema.textVersions.kind, "knowledge"),
          eq(schema.textVersions.refId, row.id),
          notInArray(
            schema.textVersions.id,
            keep.map((k) => k.id),
          ),
        ),
      );
  }
}

/* ── 6.2 圖片 → AI 描述 → 知識庫 ───────────────────────────────── */

/**
 * 視覺模型選型：取類別推薦主力（已驗證的日常款），目錄調整期退而求其次用第一個 vision——
 * 與 assistant 的 DEFAULT_IMAGE_MODEL 同一哲學（推薦優先、永遠有 fallback），費用直接沿用目錄 points。
 */
const VISION_MODEL = MODELS.find((m) => m.category === "vision" && m.recommended) ?? MODELS.find((m) => m.category === "vision");
/** 描述入庫的字數上限：8000 字足夠詳述一張圖，再長多半是模型跑火車，也避免單筆吃光注入預算 */
const MAX_DESCRIPTION = 8_000;
/** AI 產生的描述筆固定用這個標題開頭——防重複查詢認的就是這個前綴（與使用者手動引用同素材建的筆區分開） */
const DESCRIBE_TITLE_PREFIX = "圖片描述";
/** 給視覺模型的固定指令：繁中、面向影片創作的完整盤點（場景／人物／光線／氛圍／可見文字） */
const DESCRIBE_PROMPT = "請以繁體中文詳細描述這張圖片（場景、人物、光線、氛圍、可見文字），供影片創作參考";

/**
 * describeImageAsset 的 per-asset 進行中去重（併發原子冪等，核心缺陷審查）：
 * 「先查 dup 再插入」非原子——雙擊/併發兩請求都查不到彼此、各扣一次點、各建一筆重複描述。
 * 同素材的第二個併發請求直接等第一個的 Promise 拿同一結果，零扣點零重複列。
 * 記憶體鎖與本檔節流/realtime 同一「單容器」部署假設；完成即刪 key，不會無界成長。
 */
const describeInFlight = new Map<string, Promise<{ id: string; title: string; content: string }>>();

// 記憶體節流（比照 assistant/director 的模式，但獨立計數器、不跨檔共用）：每人每分鐘 6 次，擋狂刷付費視覺模型
const DESCRIBE_LIMIT_PER_MIN = 6;
const DESCRIBE_WINDOW_MS = 60_000;
const describeHits = new Map<string, number[]>();
function describeOverLimit(userId: string): boolean {
  const now = Date.now();
  const arr = (describeHits.get(userId) ?? []).filter((t) => now - t < DESCRIBE_WINDOW_MS);
  const over = arr.length >= DESCRIBE_LIMIT_PER_MIN;
  if (!over) arr.push(now);
  // 為什麼：空陣列就刪 key，否則長跑容器的 Map 會隨歷史使用者無界成長（記憶體洩漏）
  if (arr.length) describeHits.set(userId, arr);
  else describeHits.delete(userId);
  return over;
}

export const knowledgeRouter = router({
  /** 列出專案知識庫（不回傳全文，只回摘要與長度，省流量） */
  list: authedProcedure.input(z.object({ projectId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, project.groupId);
    // 回收桶裡的知識不列在正式清單（另走 projects.listDeleted）
    const rows = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.projectId, input.projectId), isNull(schema.knowledge.deletedAt)))
      .orderBy(desc(schema.knowledge.createdAt));
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      chars: r.content.length,
      excerpt: r.content.slice(0, 120),
      sourceAssetId: r.sourceAssetId,
      createdAt: r.createdAt,
    }));
  }),

  /** 讀單筆全文（編輯用）：回收桶裡的視為不存在（不給編輯，先還原） */
  get: authedProcedure.input(z.object({ id: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [row] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, input.id), isNull(schema.knowledge.deletedAt)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    return row;
  }),

  /** 新增知識（貼上文字） */
  add: authedProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        kind: z.enum(["transcript", "testimony", "script", "note"]).default("note"),
        title: z.string().min(1, "請填標題").max(120),
        content: z.string().min(1, "內容不可為空").max(MAX_CONTENT, `內容過長（上限 ${MAX_CONTENT} 字）`),
        sourceAssetId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, project.groupId);
      await assertProjectEditable(ctx.auth, project); // 2.3：檢視者不能寫知識庫
      // 跨組引用驗證：referenced asset 必須同組，否則能借知識庫把別組素材綁進本專案（與 generationCore 對 sourceAssetId 一致）
      if (input.sourceAssetId) {
        const [srcAsset] = await db.select().from(schema.assets).where(eq(schema.assets.id, input.sourceAssetId));
        if (!srcAsset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到來源素材" });
        if (srcAsset.groupId !== project.groupId) throw new TRPCError({ code: "FORBIDDEN", message: "來源素材不屬於此專案的組" });
      }
      const [row] = await db
        .insert(schema.knowledge)
        .values({
          projectId: project.id,
          groupId: project.groupId,
          kind: input.kind,
          title: input.title.trim(),
          content: input.content,
          sourceAssetId: input.sourceAssetId,
          createdBy: ctx.auth.user.id,
        })
        .returning();
      return row;
    }),

  update: authedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        kind: z.enum(["transcript", "testimony", "script", "note"]).optional(),
        title: z.string().min(1).max(120).optional(),
        content: z.string().min(1).max(MAX_CONTENT).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [row] = await db.select().from(schema.knowledge).where(eq(schema.knowledge.id, input.id));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
      // 版本歷史（#29）：覆寫前，先把「更新前」的舊全文存成一版快照——
      // 只在內容『真的改變』時存（只改標題／重存相同內容不灌版本），避免雜訊。
      const contentChanges = input.content !== undefined && input.content !== row.content;
      if (contentChanges) await snapshotKnowledge(row, ctx.auth.user.id);
      const [updated] = await db
        .update(schema.knowledge)
        .set({
          kind: input.kind ?? row.kind,
          title: input.title?.trim() ?? row.title,
          content: input.content ?? row.content,
        })
        .where(eq(schema.knowledge.id, input.id))
        .returning();
      return updated;
    }),

  /**
   * 列出某筆知識的版本歷史（#29）：由新到舊，只回摘要（title/字數/前段預覽），不回全文（省流量）。
   * 授權：先以 knowledge id（未軟刪除者）撈出該筆，再 requireGroup(ctx.auth, row.groupId)——
   * 沿用 get/remove 的「查本筆 → 用它的 groupId 守衛」模式，回收桶裡的知識視為不存在。
   */
  listVersions: authedProcedure.input(z.object({ knowledgeId: z.string().uuid() })).query(async ({ ctx, input }) => {
    const [row] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, input.knowledgeId), isNull(schema.knowledge.deletedAt)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    const versions = await db
      .select()
      .from(schema.textVersions)
      .where(and(eq(schema.textVersions.kind, "knowledge"), eq(schema.textVersions.refId, input.knowledgeId)))
      .orderBy(desc(schema.textVersions.createdAt));
    return versions.map((v) => ({
      id: v.id,
      title: v.title,
      chars: v.content.length,
      preview: v.content.slice(0, 120),
      createdAt: v.createdAt,
    }));
  }),

  /**
   * 還原到某一版（#29）：先把「當前」全文再存一版快照（讓還原本身也可被再還原／反悔），
   * 再把知識的 title/content 覆寫成該版內容。授權同 update：查本筆（未軟刪除）→ requireGroup(groupId)；
   * 回收桶裡的知識不給還原版本（要先還原整筆）。版本必須屬於這筆知識（kind='knowledge'、refId 相符）。
   */
  restoreVersion: authedProcedure
    .input(z.object({ knowledgeId: z.string().uuid(), versionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [row] = await db
        .select()
        .from(schema.knowledge)
        .where(and(eq(schema.knowledge.id, input.knowledgeId), isNull(schema.knowledge.deletedAt)));
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      requireGroup(ctx.auth, row.groupId);
      await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3：還原版本＝內容寫入
      const [version] = await db
        .select()
        .from(schema.textVersions)
        .where(
          and(
            eq(schema.textVersions.id, input.versionId),
            eq(schema.textVersions.kind, "knowledge"),
            eq(schema.textVersions.refId, input.knowledgeId),
          ),
        );
      if (!version) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這個版本" });
      // 先把當前內容存成一版，這樣「還原」本身也可被再還原（不會弄丟現況）。
      await snapshotKnowledge(row, ctx.auth.user.id);
      const [updated] = await db
        .update(schema.knowledge)
        .set({ title: version.title ?? row.title, content: version.content })
        .where(eq(schema.knowledge.id, input.knowledgeId))
        .returning();
      return updated;
    }),

  /** 刪除知識＝軟刪除（回收桶）：保留逐字稿／見證全文，可還原；還原前不會注入 LLM */
  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, input.id), isNull(schema.knowledge.deletedAt)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
    await db.update(schema.knowledge).set({ deletedAt: new Date() }).where(eq(schema.knowledge.id, input.id));
    return { ok: true };
  }),

  /** 還原知識（回收桶 → 知識庫）：清掉 deletedAt，之後又會被注入 AI 導演 */
  restore: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.knowledge).where(eq(schema.knowledge.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
    await db.update(schema.knowledge).set({ deletedAt: null }).where(eq(schema.knowledge.id, input.id));
    return { ok: true };
  }),

  /** 永久刪除知識（回收桶內「永久刪除」）：真的 db.delete，不可復原 */
  purge: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const [row] = await db.select().from(schema.knowledge).where(eq(schema.knowledge.id, input.id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND" });
    requireGroup(ctx.auth, row.groupId);
    await assertProjectEditable(ctx.auth, { id: row.projectId, groupId: row.groupId }); // 2.3
    await db.delete(schema.knowledge).where(eq(schema.knowledge.id, input.id));
    return { ok: true };
  }),

  /** 把已上傳的文字素材（txt/md）轉成知識——去重：同 asset 只建一次 */
  addFromAsset: authedProcedure.input(z.object({ assetId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    // 回收桶裡的素材視為不存在（比照 describeImageAsset）——否則已刪逐字稿可被復活成知識、
    // 再經 buildKnowledgeContext 注入 AI 導演 LLM（schema 明文禁止「已刪的逐字稿再注入」）
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, input.assetId), isNull(schema.assets.deletedAt)));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材（可能已在回收桶）" });
    requireGroup(ctx.auth, asset.groupId);
    await assertProjectEditable(ctx.auth, { id: asset.projectId, groupId: asset.groupId }); // 2.3
    const [dup] = await db
      .select()
      .from(schema.knowledge)
      .where(
        and(
          eq(schema.knowledge.sourceAssetId, asset.id),
          eq(schema.knowledge.projectId, asset.projectId),
          // 只認未刪除的既有筆：若前一份已丟進回收桶，這次重新加入應建一份新的活筆
          isNull(schema.knowledge.deletedAt),
        ),
      );
    if (dup) return dup; // 已加過就回原筆，冪等
    if (asset.kind !== "doc" || !asset.storagePath) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "只有文字類素材（txt/md）能加入知識庫" });
    }
    const { open } = await import("node:fs/promises");
    const { absPathOf } = await import("../services/storage");
    let content: string;
    try {
      // 只讀前段（非整檔進記憶體）——即使有人上傳 200MB 的 .txt，也只吃 MAX_CONTENT×4 bytes。
      // CJK 一字最多 4 bytes（UTF-8），讀 MAX_CONTENT×4 bytes 後再截到 MAX_CONTENT 字，足夠且有界。
      const fh = await open(absPathOf(asset.storagePath), "r");
      try {
        const buf = Buffer.alloc(MAX_CONTENT * 4);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        content = buf.subarray(0, bytesRead).toString("utf8").slice(0, MAX_CONTENT);
      } finally {
        await fh.close();
      }
    } catch {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "讀取素材內容失敗" });
    }
    if (!content.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "這份素材沒有可讀的文字內容" });
    const [row] = await db
      .insert(schema.knowledge)
      .values({
        projectId: asset.projectId,
        groupId: asset.groupId,
        kind: "note",
        title: asset.title.slice(0, 120),
        content,
        sourceAssetId: asset.id,
        createdBy: ctx.auth.user.id,
      })
      .returning();
    return row;
  }),

  /**
   * 6.2 圖片 → AI 描述 → 知識庫：用視覺模型把圖片素材「看」成中文描述存進知識庫，
   * 之後由 buildKnowledgeContext 自動注入導演／助手——AI 真的看過我們的素材。
   * 冪等：同素材已有未刪除的「圖片描述」筆就直接回它（重複點擊／重試不重複扣點）。
   */
  describeImageAsset: authedProcedure.input(z.object({ assetId: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    if (describeOverLimit(ctx.auth.user.id)) {
      throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "描述得太頻繁（每分鐘最多 6 次），休息一下再試" });
    }
    // 回收桶裡的素材視為不存在——已刪的圖不該再進知識庫
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, input.assetId), isNull(schema.assets.deletedAt)));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    requireGroup(ctx.auth, asset.groupId); // 多組隔離：素材屬於哪組就要哪組成員才能操作
    await assertProjectEditable(ctx.auth, { id: asset.projectId, groupId: asset.groupId }); // 2.3：檢視者不能寫知識庫
    if (asset.kind !== "image") throw new TRPCError({ code: "BAD_REQUEST", message: "只支援圖片素材" });

    // 併發原子冪等：同素材已有進行中的描述工作 → 直接等它的結果（不扣點、不重複建筆）
    const inflight = describeInFlight.get(asset.id);
    if (inflight) return inflight;
    const job = (async (): Promise<{ id: string; title: string; content: string }> => {

      // 防重複（冪等）：同素材已有未刪除、標題以「圖片描述」開頭的筆 → 直接回它、不再扣點。
      // 標題前綴用來區分「AI 描述筆」與「使用者手動引用同素材建的筆」（後者不該擋 AI 描述）；
      // 前一筆若已丟回收桶則放行重新產生（與 addFromAsset 的去重哲學一致）。
      const [dup] = await db
        .select()
        .from(schema.knowledge)
        .where(
          and(
            eq(schema.knowledge.sourceAssetId, asset.id),
            isNull(schema.knowledge.deletedAt),
            like(schema.knowledge.title, `${DESCRIBE_TITLE_PREFIX}%`),
          ),
        );
      if (dup) return { id: dup.id, title: dup.title, content: dup.content };

      const title = `${DESCRIBE_TITLE_PREFIX}｜${asset.title.slice(0, 60)}`;
      let content: string;
      if (isMockMode()) {
        // 假模式：不扣點，用固定示範文字跑通「描述 → 入庫 → 注入」全流程（與 fal/assistant 的 mock 哲學一致）
        content = `（測試模式描述）這是一張與專案相關的圖片素材：${asset.title}。正式模式會由視覺模型產生詳細中文描述。`;
      } else {
        if (!VISION_MODEL) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "目前沒有可用的視覺模型" });
        const points = VISION_MODEL.points;
        // 先扣後呼叫、失敗退回——與 assistant/generationCore 同一守門哲學（點數＝真金，不可先跑再說）
        const quotaError = await reserveQuota(ctx.auth.user.id, asset.groupId, points, "圖片描述入知識庫");
        if (quotaError) throw new TRPCError({ code: "PRECONDITION_FAILED", message: quotaError });
        // 圖片網址：本地檔 → 簽名網址（fal 要能從外部抓到圖，與 generationCore 來源素材同模式）；
        // 純外部素材直接用其網址，但必須是 http(s) 否則模型抓不到——擋下並退點
        const imageUrl = asset.storagePath ? signAssetUrl(asset.id) : asset.url;
        if (!imageUrl.startsWith("http")) {
          await refund(ctx.auth.user.id, asset.groupId, points, "圖片描述失敗退回");
          throw new TRPCError({ code: "BAD_REQUEST", message: "這個素材沒有可存取的圖片網址" });
        }
        // 同步呼叫 fal（比照 assistant.ask 的 proxyFetch 寫法）。URL 不能寫死 any-llm：
        // 目錄裡推薦的視覺模型（moondream 系）是獨立端點、any-llm 視覺款的 endpoint 是
        // fal-ai/any-llm/vision——一律取「該模型的佇列端點」對應的 fal.run 同步路徑。
        // body 由目錄的 entry.input() 產生（any-llm 款自帶 model+image_url、moondream 款只有
        // prompt+image_url）——模型輸入形狀的單一真相來源在目錄，這裡不重複手拼。
        const falUrl = `https://fal.run/${VISION_MODEL.endpoint ?? VISION_MODEL.id.split("#")[0]}`;
        try {
          const res = await proxyFetch(falUrl, {
            method: "POST",
            headers: { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(VISION_MODEL.input(DESCRIBE_PROMPT, "16:9", imageUrl)),
            timeoutMs: 60_000,
          });
          if (!res.ok) throw new Error(`vision ${res.status}`);
          const data = (await res.json()) as Record<string, unknown>;
          // 各家輸出欄位不一（output／text／results…）：用生成管線同一支統一解析器，不自己再猜一次
          const text = (extractResult(data).text ?? "").trim();
          if (!text) throw new Error("模型沒回描述");
          content = text.slice(0, MAX_DESCRIPTION);
        } catch {
          // 沒拿到描述就不收錢：退點＋人話錯誤（比照 assistant.ask 的失敗收尾）
          await refund(ctx.auth.user.id, asset.groupId, points, "圖片描述失敗退回");
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "視覺模型暫時沒回應，請稍後再試（點數已退回）" });
        }
      }

      // 入庫成 note：記 sourceAssetId（防重複＋回溯來源圖），之後自動被 buildKnowledgeContext 注入
      const [row] = await db
        .insert(schema.knowledge)
        .values({
          projectId: asset.projectId,
          groupId: asset.groupId,
          kind: "note",
          title,
          content,
          sourceAssetId: asset.id,
          createdBy: ctx.auth.user.id,
        })
        .returning();
      return { id: row.id, title: row.title, content: row.content };

    })(); // 見上方 describeInFlight：dup 檢查→扣點→fal→入庫整段對同素材序列化
    describeInFlight.set(asset.id, job);
    try {
      return await job;
    } finally {
      describeInFlight.delete(asset.id);
    }
  }),
});
