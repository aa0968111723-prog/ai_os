/**
 * MCP 寫入擴充（創作主線）：知識庫／分鏡／世界觀／素材／設定卡／生成後處理／Adobe。
 * 與 mcpUploadGrant 同模式——工具定義 + handler 獨立，由 mcp.ts 掛上 TOOLS 與 runTool。
 * 一律重用既有 ACL（requireGroup / assertProjectEditable）、點數與審計，不另開後門。
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import { assertProjectEditable } from "./projectAcl";
import { lockSceneOrder } from "./locks";
import { worldviewSchema } from "../../shared/worldview";
import { buildRetryGenerationInput } from "./generationRetryInput";
import { executeGenerationCommand } from "./generationCommand";
import type { AuthState } from "./auth";
import {
  AdobeNotConnectedError,
  AdobeReauthRequiredError,
  AdobeUnsupportedError,
  adobeConnectionView,
  getAdobeJob,
  listAdobeAssets,
  startAdobePhotoEdit,
  startAdobeTimelineRender,
} from "./adobe";
import { exportAdobeTimelineFormats } from "./adobe/timelineExport";
import { adobeTimelineSchema, type AdobeTimeline } from "../../shared/adobe";
import { resolveSceneCards } from "../../shared/sceneCards";
import { adoptGenerationCurrent } from "./consistencyAdopt";
import { refreshShotContextStalenessSafely } from "./shotContextPackets";
import { assertReferenceImage } from "./referenceAsset";
import { applyWithRevision, isRevisionConflictError, revisionConflictTrpcError } from "./revisionGuard";

/** Empty MCP patches must not look like a successful write. */
export function mcpUnchanged<T extends Record<string, unknown>>(payload: T): T & { unchanged: true } {
  return { ...payload, unchanged: true };
}

/** Optional projectId on update_* tools must match the row, or same-group cross-project writes leak. */
export function assertMcpProjectScope(rowProjectId: string, requestedProjectId: unknown, label: string): void {
  if (typeof requestedProjectId === "string" && requestedProjectId.trim() && requestedProjectId !== rowProjectId) {
    throw new TRPCError({ code: "FORBIDDEN", message: `${label}不屬於這個專案` });
  }
}

const MAX_KNOWLEDGE = 200_000;
const MAX_PROMPT = 8_000;

export const MCP_WRITE_EXPANSION_TOOLS = [
  {
    name: "add_knowledge",
    description: "為專案新增知識庫條目（腳本／逐字稿／見證／筆記）。需專案可編輯權限。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        kind: { type: "string", enum: ["transcript", "testimony", "script", "note"] },
        title: { type: "string" },
        content: { type: "string" },
        sourceAssetId: { type: "string" },
      },
      required: ["projectId", "title", "content"],
    },
  },
  {
    name: "update_knowledge",
    description: "更新既有知識條目（標題／類型／內容／釘選）。內容變更會留版本快照。",
    inputSchema: {
      type: "object",
      properties: {
        knowledgeId: { type: "string" },
        kind: { type: "string", enum: ["transcript", "testimony", "script", "note"] },
        title: { type: "string" },
        content: { type: "string" },
        pinned: { type: "boolean" },
      },
      required: ["knowledgeId"],
    },
  },
  {
    name: "add_scene",
    description: "在專案新增一格分鏡草稿（標題／提示詞／旁白／秒數）。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        title: { type: "string" },
        prompt: { type: "string" },
        voiceover: { type: "string" },
        durationSec: { type: "number" },
      },
      required: ["projectId", "title"],
    },
  },
  {
    name: "update_scene",
    description: "更新分鏡標題、提示詞、旁白、環境音或剪輯（秒數與素材入出點）。durationSec 是整數 1-60 秒；秒以下的節奏微調用 trimStartMs／trimEndMs（毫秒，出點必須大於入點）。",
    inputSchema: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        title: { type: "string" },
        prompt: { type: "string" },
        voiceover: { type: "string" },
        ambience: { type: "string" },
        durationSec: { type: "number" },
        trimStartMs: { type: "number" },
        trimEndMs: { type: "number" },
      },
      required: ["sceneId"],
    },
  },
  {
    name: "reorder_scenes",
    description: "重排專案分鏡順序。orderedSceneIds 依想要的新順序完整列出分鏡 id（可先用 list_scenes 取得）；清單漏掉的分鏡會依原相對順序補到尾端。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        orderedSceneIds: { type: "array", items: { type: "string" } },
      },
      required: ["projectId", "orderedSceneIds"],
    },
  },
  {
    name: "set_scene_visual",
    description: "把生成結果或素材設為分鏡畫面（二選一：generationId 或 assetId）。generationId 走正式 Adopt（連戲／packet／審核守門），不是直接改 assetId。",
    inputSchema: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        generationId: { type: "string" },
        assetId: { type: "string" },
        acknowledgeApproved: { type: "boolean" },
      },
      required: ["sceneId"],
    },
  },
  {
    name: "generate_into_scene",
    description: "在指定分鏡格送出生成（世界觀自動注入、扣點、走核准門檻）。",
    inputSchema: {
      type: "object",
      properties: {
        sceneId: { type: "string" },
        modelId: { type: "string" },
        prompt: { type: "string" },
        client_request_id: { type: "string" },
      },
      required: ["sceneId", "modelId"],
    },
  },
  {
    name: "update_worldview",
    description: "更新專案世界觀（logline／主軸／調性／風格／禁語等）。未給的欄位保持不變。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        logline: { type: "string" },
        message: { type: "string" },
        audience: { type: "string" },
        themes: { type: "array", items: { type: "string" } },
        tones: { type: "array", items: { type: "string" } },
        styles: { type: "array", items: { type: "string" } },
        taboos: { type: "array", items: { type: "string" } },
        people: { type: "array", items: { type: "string" } },
        references: { type: "array", items: { type: "string" } },
      },
      required: ["projectId"],
    },
  },
  {
    name: "rename_asset",
    description: "重新命名專案素材庫中的一筆素材。",
    inputSchema: {
      type: "object",
      properties: { assetId: { type: "string" }, title: { type: "string" } },
      required: ["assetId", "title"],
    },
  },
  {
    name: "set_asset_lock",
    description: "鎖定或解鎖素材（避免誤刪／覆寫）。",
    inputSchema: {
      type: "object",
      properties: { assetId: { type: "string" }, locked: { type: "boolean" } },
      required: ["assetId", "locked"],
    },
  },
  {
    name: "add_character",
    description: "為專案新增角色定裝卡。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        appearance: { type: "string" },
        notes: { type: "string" },
        referenceAssetId: { type: "string" },
      },
      required: ["projectId", "name", "appearance"],
    },
  },
  {
    name: "update_character",
    description: "更新既有角色定裝卡。",
    inputSchema: {
      type: "object",
      properties: {
        characterId: { type: "string" },
        projectId: { type: "string" },
        name: { type: "string" },
        appearance: { type: "string" },
        notes: { type: "string" },
        referenceAssetId: { type: "string" },
      },
      required: ["characterId"],
    },
  },
  {
    name: "add_scene_preset",
    description: "為專案新增場景設定卡。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        palette: { type: "string" },
        lighting: { type: "string" },
        referenceAssetId: { type: "string" },
      },
      required: ["projectId", "name", "palette"],
    },
  },
  {
    name: "update_scene_preset",
    description: "更新既有場景設定卡。",
    inputSchema: {
      type: "object",
      properties: {
        presetId: { type: "string" },
        projectId: { type: "string" },
        name: { type: "string" },
        palette: { type: "string" },
        lighting: { type: "string" },
        referenceAssetId: { type: "string" },
      },
      required: ["presetId"],
    },
  },
  {
    name: "add_prop",
    description: "為專案新增道具／素材設定卡。",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string" },
        name: { type: "string" },
        appearance: { type: "string" },
        notes: { type: "string" },
        referenceAssetId: { type: "string" },
      },
      required: ["projectId", "name", "appearance"],
    },
  },
  {
    name: "update_prop",
    description: "更新既有道具／素材設定卡。",
    inputSchema: {
      type: "object",
      properties: {
        propId: { type: "string" },
        projectId: { type: "string" },
        name: { type: "string" },
        appearance: { type: "string" },
        notes: { type: "string" },
        referenceAssetId: { type: "string" },
      },
      required: ["propId"],
    },
  },
  {
    name: "rename_generation",
    description: "重新命名一筆生成成品的顯示標題。",
    inputSchema: {
      type: "object",
      properties: { generationId: { type: "string" }, name: { type: "string" } },
      required: ["generationId", "name"],
    },
  },
  {
    name: "retry_generation",
    description: "重試一筆失敗的生成（再扣點、走同一模型與提示詞）。",
    inputSchema: {
      type: "object",
      properties: { generationId: { type: "string" } },
      required: ["generationId"],
    },
  },
  {
    name: "adobe_status",
    description: "查你自己的 Adobe 連結狀態、模式與可用能力。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "adobe_list_assets",
    description: "列出你已連結的 Adobe 帳號內的素材中繼資料。",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
    },
  },
  {
    name: "adobe_edit_photo",
    description: "在已連結的 Adobe 帳號內送出修圖工作，回 jobId；不扣站內點數。",
    inputSchema: {
      type: "object",
      properties: {
        assetId: { type: "string" },
        operations: { type: "array", items: { type: "object" } },
        outputFormat: { type: "string", enum: ["png", "jpeg", "webp"] },
        outputName: { type: "string" },
      },
      required: ["assetId", "operations"],
    },
  },
  {
    name: "adobe_job",
    description: "查 Adobe 非同步工作進度。",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
    },
  },
  {
    name: "adobe_export_timeline",
    description: "把時間軸契約轉成 FCPXML／Premiere XML／EDL（純本機）。",
    inputSchema: {
      type: "object",
      properties: {
        timeline: { type: "object" },
        pathPrefix: { type: "string" },
      },
      required: ["timeline"],
    },
  },
  {
    name: "adobe_render_timeline",
    description: "送出 Adobe 時間軸算圖工作（mock 可跑；real 可能尚未開放）。",
    inputSchema: {
      type: "object",
      properties: { timeline: { type: "object" } },
      required: ["timeline"],
    },
  },
] as const;

// 明確標成 ReadonlySet<string>：MCP_WRITE_EXPANSION_TOOLS 是 as const，推導出來會是
// 字面值聯集的 Set，拿執行期傳進來的 string 去 has() 反而編不過。
const EXPANSION_NAMES: ReadonlySet<string> = new Set(MCP_WRITE_EXPANSION_TOOLS.map((t) => t.name));

export function isMcpWriteExpansionTool(name: string): boolean {
  return EXPANSION_NAMES.has(name);
}

/**
 * 時間軸參數一律走 adobeTimelineSchema，與 routers/adobe.ts 同一套驗證。
 * MCP 這條路以前是手寫 cast，等於讓外部客戶端把未驗證的 clips 直接送進匯出器與 Adobe 算圖——
 * fps／width／height 的預設值也拿不到（schema 的 .default() 只在 parse 時才會補）。
 */
function parseTimelineArg(raw: unknown): AdobeTimeline {
  const parsed = adobeTimelineSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `timeline 格式不正確：${first ? `${first.path.join(".") || "timeline"} ${first.message}` : "需含 name 與 clips[]"}`,
    });
  }
  return parsed.data;
}

function adobeErr(err: unknown): never {
  if (err instanceof AdobeNotConnectedError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: err.message });
  }
  if (err instanceof AdobeReauthRequiredError) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: err.message });
  }
  if (err instanceof AdobeUnsupportedError) {
    throw new TRPCError({ code: "NOT_IMPLEMENTED", message: err.message });
  }
  throw err instanceof TRPCError
    ? err
    : new TRPCError({ code: "BAD_REQUEST", message: err instanceof Error ? err.message : "Adobe 呼叫失敗" });
}

/** 處理擴充寫入工具；未知名稱回 null（讓主 runTool 繼續）。 */
export async function runMcpWriteExpansion(
  auth: AuthState,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown | null> {
  if (!EXPANSION_NAMES.has(name)) return null;

  // ── 知識庫 ──
  if (name === "add_knowledge") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, project.groupId);
    await assertProjectEditable(auth, project);
    const title = String(args.title ?? "").trim();
    const content = String(args.content ?? "");
    if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "請填標題" });
    if (!content.trim()) throw new TRPCError({ code: "BAD_REQUEST", message: "內容不可為空" });
    if (content.length > MAX_KNOWLEDGE) throw new TRPCError({ code: "BAD_REQUEST", message: `內容過長（上限 ${MAX_KNOWLEDGE} 字）` });
    const kind = (["transcript", "testimony", "script", "note"].includes(String(args.kind))
      ? String(args.kind)
      : "note") as "transcript" | "testimony" | "script" | "note";
    let sourceAssetId: string | null = null;
    if (typeof args.sourceAssetId === "string" && args.sourceAssetId.trim()) {
      const sid = args.sourceAssetId.trim();
      const [srcAsset] = await db
        .select()
        .from(schema.assets)
        .where(and(eq(schema.assets.id, sid), isNull(schema.assets.deletedAt)));
      if (!srcAsset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到來源素材或已刪除" });
      if (srcAsset.groupId !== project.groupId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "來源素材不屬於此專案的組" });
      }
      sourceAssetId = sid;
    }
    const [row] = await db
      .insert(schema.knowledge)
      .values({
        projectId: project.id,
        groupId: project.groupId,
        kind,
        title: title.slice(0, 120),
        content,
        sourceAssetId,
        createdBy: auth.user.id,
      })
      .returning();
    return { knowledgeId: row.id, kind: row.kind, title: row.title, chars: content.length };
  }

  if (name === "update_knowledge") {
    const id = String(args.knowledgeId ?? "");
    const [row] = await db
      .select()
      .from(schema.knowledge)
      .where(and(eq(schema.knowledge.id, id), isNull(schema.knowledge.deletedAt)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆知識" });
    requireGroup(auth, row.groupId);
    await assertProjectEditable(auth, { id: row.projectId, groupId: row.groupId });
    const patch: Record<string, unknown> = {};
    if (typeof args.title === "string") patch.title = args.title.trim().slice(0, 120);
    if (typeof args.content === "string") {
      if (args.content.length > MAX_KNOWLEDGE) throw new TRPCError({ code: "BAD_REQUEST", message: "內容過長" });
      patch.content = args.content;
    }
    if (["transcript", "testimony", "script", "note"].includes(String(args.kind))) patch.kind = String(args.kind);
    if (typeof args.pinned === "boolean") patch.pinned = args.pinned;
    if (Object.keys(patch).length === 0) return mcpUnchanged({ knowledgeId: row.id, title: row.title, kind: row.kind, pinned: row.pinned });
    const [updated] = await db.update(schema.knowledge).set(patch).where(eq(schema.knowledge.id, id)).returning();
    return { knowledgeId: updated.id, title: updated.title, kind: updated.kind, pinned: updated.pinned };
  }

  // ── 分鏡 ──
  if (name === "add_scene") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, project.groupId);
    await assertProjectEditable(auth, project);
    const title = String(args.title ?? "").trim();
    if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "請填分鏡標題" });
    const scene = await db.transaction(async (tx) => {
      const [{ maxOrder }] = await tx
        .select({ maxOrder: sql<number>`coalesce(max(${schema.scenes.orderIndex}), 0)` })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, project.id), isNull(schema.scenes.deletedAt)));
      const [row] = await tx
        .insert(schema.scenes)
        .values({
          projectId: project.id,
          title: title.slice(0, 60),
          prompt: typeof args.prompt === "string" ? args.prompt.slice(0, MAX_PROMPT) : null,
          voiceover: typeof args.voiceover === "string" ? args.voiceover.slice(0, 500) : null,
          durationSec: typeof args.durationSec === "number" ? Math.min(60, Math.max(1, Math.trunc(args.durationSec))) : 5,
          orderIndex: (maxOrder ?? 0) + 1,
          status: "todo",
        })
        .returning();
      return row;
    });
    return { sceneId: scene.id, title: scene.title, orderIndex: scene.orderIndex };
  }

  if (name === "update_scene") {
    const sceneId = String(args.sceneId ?? "");
    const [scene] = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, sceneId), isNull(schema.scenes.deletedAt)));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡" });
    const [sceneProject] = await db.select().from(schema.projects).where(eq(schema.projects.id, scene.projectId));
    if (!sceneProject) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, sceneProject.groupId);
    await assertProjectEditable(auth, sceneProject);
    const patch: Record<string, unknown> = {};
    if (typeof args.title === "string" && args.title.trim()) patch.title = args.title.trim().slice(0, 60);
    if (typeof args.prompt === "string") patch.prompt = args.prompt.slice(0, MAX_PROMPT);
    if (typeof args.voiceover === "string") patch.voiceover = args.voiceover.slice(0, 500);
    if (typeof args.durationSec === "number") patch.durationSec = Math.min(60, Math.max(1, Math.trunc(args.durationSec)));
    if (typeof args.ambience === "string") patch.ambience = args.ambience.slice(0, 500);
    if (typeof args.trimStartMs === "number" || typeof args.trimEndMs === "number") {
      // 出點必須大於入點——與 scenes.update 及代理的 update_scene step 同一條物理，
      // 外部 MCP 客戶端不得享有更鬆的守門（否則時間軸會算出負長度的鏡）
      const nextStart = typeof args.trimStartMs === "number" ? Math.max(0, Math.trunc(args.trimStartMs)) : scene.trimStartMs;
      const nextEnd = typeof args.trimEndMs === "number" ? Math.max(1, Math.trunc(args.trimEndMs)) : scene.trimEndMs;
      if (nextEnd != null && nextEnd <= nextStart) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `修剪出點（${nextEnd}ms）必須大於入點（${nextStart}ms）` });
      }
      if (typeof args.trimStartMs === "number") patch.trimStartMs = nextStart;
      if (typeof args.trimEndMs === "number") patch.trimEndMs = nextEnd;
    }
    if (Object.keys(patch).length === 0) return mcpUnchanged({ sceneId: scene.id, title: scene.title });
    const baseline: Record<string, unknown> = {};
    for (const key of Object.keys(patch)) baseline[key] = (scene as Record<string, unknown>)[key];
    try {
      const { row: updated } = await applyWithRevision({
        entity: "scene",
        table: schema.scenes,
        idColumn: schema.scenes.id,
        revColumn: schema.scenes.rev,
        row: scene,
        patch,
        expectedRev: scene.rev,
        baseline,
        extraWhere: isNull(schema.scenes.deletedAt),
        reload: async () => {
          const [fresh] = await db
            .select()
            .from(schema.scenes)
            .where(and(eq(schema.scenes.id, sceneId), isNull(schema.scenes.deletedAt)));
          return fresh;
        },
      });
      return { sceneId: updated.id, title: updated.title };
    } catch (err) {
      if (isRevisionConflictError(err)) throw revisionConflictTrpcError(err.conflict);
      throw err;
    }
  }

  if (name === "reorder_scenes") {
    const projectId = String(args.projectId ?? "");
    const orderedSceneIds = Array.isArray(args.orderedSceneIds)
      ? args.orderedSceneIds.filter((v): v is string => typeof v === "string")
      : [];
    if (orderedSceneIds.length < 2) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "orderedSceneIds 至少要有兩個分鏡 id" });
    }
    // 重複 id 直接拒絕——與 scenes.reorder 同一條：重複代表呼叫端狀態已壞，
    // 寫入會產生跳號／覆蓋，不能默默吞掉
    if (new Set(orderedSceneIds).size !== orderedSceneIds.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "orderedSceneIds 有重複的分鏡 id" });
    }
    const [reorderProject] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!reorderProject) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, reorderProject.groupId);
    await assertProjectEditable(auth, reorderProject);
    // 交易＋序號鎖：與 scenes.reorder 同一套物理，否則重排中另一人拆分鏡，
    // 新格會拿到與重排結果重疊的序號
    const applied = await db.transaction(async (tx) => {
      await lockSceneOrder(tx, projectId);
      const rows = await tx
        .select({ id: schema.scenes.id })
        .from(schema.scenes)
        .where(and(eq(schema.scenes.projectId, projectId), isNull(schema.scenes.deletedAt)))
        .orderBy(asc(schema.scenes.orderIndex));
      const own = new Set(rows.map((r) => r.id));
      const listed = new Set(orderedSceneIds);
      let idx = 0;
      let matched = 0;
      for (const id of orderedSceneIds) {
        if (!own.has(id)) continue; // 別專案的 id 或已刪除的鏡：跳過，不越權也不失敗
        await tx.update(schema.scenes).set({ orderIndex: idx }).where(eq(schema.scenes.id, id));
        idx += 1;
        matched += 1;
      }
      // 清單漏掉的既有分鏡依原相對順序補到尾端重新編號，不留與新序號重疊的舊值
      for (const row of rows) {
        if (listed.has(row.id)) continue;
        await tx.update(schema.scenes).set({ orderIndex: idx }).where(eq(schema.scenes.id, row.id));
        idx += 1;
      }
      return { matched, total: rows.length };
    });
    return {
      projectId,
      reordered: applied.matched,
      total: applied.total,
      // 呼叫端給了不屬於本專案的 id 時要說出來，不能讓它以為全部生效
      ignored: orderedSceneIds.length - applied.matched,
    };
  }

  if (name === "set_scene_visual") {
    const sceneId = String(args.sceneId ?? "");
    const generationId = typeof args.generationId === "string" ? args.generationId : null;
    const assetId = typeof args.assetId === "string" ? args.assetId : null;
    if (!generationId && !assetId) throw new TRPCError({ code: "BAD_REQUEST", message: "請提供 generationId 或 assetId" });
    if (generationId && assetId) throw new TRPCError({ code: "BAD_REQUEST", message: "generationId 與 assetId 只能擇一" });
    const [scene] = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, sceneId), isNull(schema.scenes.deletedAt)));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡" });
    const [visProject] = await db.select().from(schema.projects).where(eq(schema.projects.id, scene.projectId));
    if (!visProject) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, visProject.groupId);
    await assertProjectEditable(auth, visProject);
    if (generationId) {
      const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, generationId));
      if (!gen || gen.status !== "done") throw new TRPCError({ code: "BAD_REQUEST", message: "生成尚未完成或不存在" });
      if (gen.projectId !== scene.projectId) throw new TRPCError({ code: "BAD_REQUEST", message: "生成與分鏡不在同一專案" });
      if (gen.sceneId !== scene.id) throw new TRPCError({ code: "BAD_REQUEST", message: "這筆生成沒有綁這一鏡，不能 Adopt" });
      const adopted = await adoptGenerationCurrent({ auth, generationId });
      const [verified] = await db.select({
        id: schema.scenes.id,
        assetId: schema.scenes.assetId,
      }).from(schema.scenes).where(eq(schema.scenes.id, adopted.shotId));
      return {
        sceneId: adopted.shotId,
        assetId: adopted.assetId,
        adopted: true,
        verified: verified?.assetId === adopted.assetId,
      };
    }
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, assetId!), isNull(schema.assets.deletedAt)));
    if (!asset || asset.projectId !== scene.projectId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "素材不存在或不在同一專案" });
    }
    const replacesApprovedVisual = scene.reviewStatus === "approved" && scene.assetId !== asset.id;
    if (replacesApprovedVisual && args.acknowledgeApproved !== true) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "這一鏡已通過審核，不會被外部工具直接換掉畫面。請帶 acknowledgeApproved=true 或走單格工作室。",
      });
    }
    const [updated] = await db
      .update(schema.scenes)
      .set({
        assetId: asset.id,
        ...(replacesApprovedVisual ? { reviewStatus: "changes" } : {}),
      })
      .where(eq(schema.scenes.id, sceneId))
      .returning();
    return { sceneId: updated.id, assetId: updated.assetId, adopted: false };
  }

  if (name === "generate_into_scene") {
    const sceneId = String(args.sceneId ?? "");
    const modelId = String(args.modelId ?? "");
    if (!modelId) throw new TRPCError({ code: "BAD_REQUEST", message: "請指定 modelId" });
    const [scene] = await db
      .select()
      .from(schema.scenes)
      .where(and(eq(schema.scenes.id, sceneId), isNull(schema.scenes.deletedAt)));
    if (!scene) throw new TRPCError({ code: "NOT_FOUND", message: "找不到分鏡" });
    const [genProject] = await db.select().from(schema.projects).where(eq(schema.projects.id, scene.projectId));
    if (!genProject) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, genProject.groupId);
    await assertProjectEditable(auth, genProject);
    const prompt = (typeof args.prompt === "string" && args.prompt.trim()
      ? args.prompt
      : scene.prompt ?? scene.title ?? "").trim();
    if (!prompt) throw new TRPCError({ code: "BAD_REQUEST", message: "分鏡沒有提示詞，請先 update_scene 或傳 prompt" });
    const cards = resolveSceneCards(scene, null);
    const gen = await executeGenerationCommand({
      auth,
      source: "mcp",
      id: typeof args.client_request_id === "string" ? args.client_request_id : undefined,
      projectId: scene.projectId,
      modelId,
      prompt: prompt.slice(0, MAX_PROMPT),
      sceneId: scene.id,
      characterIds: cards.characterIds,
      scenePresetIds: cards.scenePresetIds,
      propIds: cards.propIds,
      lookIds: scene.lookIds ?? undefined,
      shotDirection: { camera: scene.camera, performance: scene.performance, action: scene.action },
      preserveScenePointer: true,
      reasonPrefix: "MCP 分鏡格生成",
    });
    return {
      generationId: gen.id,
      status: gen.status,
      points: gen.pointsEst,
      sceneId: scene.id,
      note: gen.status === "awaiting_approval" ? "已達成本門檻，等組長核准後才會送出" : undefined,
    };
  }

  // ── 世界觀 ──
  if (name === "update_worldview") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, project.groupId);
    await assertProjectEditable(auth, project);
    const current = worldviewSchema.parse(project.worldview ?? {});
    const merged = {
      ...current,
      ...(typeof args.logline === "string" ? { logline: args.logline.slice(0, 500) } : {}),
      ...(typeof args.message === "string" ? { message: args.message.slice(0, 500) } : {}),
      ...(typeof args.audience === "string" ? { audience: args.audience.slice(0, 500) } : {}),
      ...(Array.isArray(args.themes) ? { themes: args.themes.map(String).slice(0, 30) } : {}),
      ...(Array.isArray(args.tones) ? { tones: args.tones.map(String).slice(0, 30) } : {}),
      ...(Array.isArray(args.styles) ? { styles: args.styles.map(String).slice(0, 30) } : {}),
      ...(Array.isArray(args.taboos) ? { taboos: args.taboos.map(String).slice(0, 30) } : {}),
      ...(Array.isArray(args.people) ? { people: args.people.map(String).slice(0, 30) } : {}),
      ...(Array.isArray(args.references) ? { references: args.references.map(String).slice(0, 30) } : {}),
    };
    const parsed = worldviewSchema.parse(merged);
    try {
      await applyWithRevision({
        entity: "project",
        table: schema.projects,
        idColumn: schema.projects.id,
        revColumn: schema.projects.rev,
        row: project,
        patch: { worldview: parsed },
        bookkeeping: { updatedAt: new Date() },
        expectedRev: project.rev,
        baseline: { worldview: current },
        reload: async () => {
          const [fresh] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
          return fresh;
        },
        updatedAtField: "updatedAt",
      });
    } catch (err) {
      if (isRevisionConflictError(err)) throw revisionConflictTrpcError(err.conflict);
      throw err;
    }
    return { projectId, worldview: parsed, note: "世界觀已更新——之後生成會自動注入。" };
  }

  // ── 素材 ──
  if (name === "rename_asset") {
    const assetId = String(args.assetId ?? "");
    const title = String(args.title ?? "").trim();
    if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "請填新名稱" });
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, assetId), isNull(schema.assets.deletedAt)));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    requireGroup(auth, asset.groupId);
    await assertProjectEditable(auth, { id: asset.projectId, groupId: asset.groupId });
    const [updated] = await db
      .update(schema.assets)
      .set({ title: title.slice(0, 120) })
      .where(eq(schema.assets.id, assetId))
      .returning();
    return { assetId: updated.id, title: updated.title };
  }

  if (name === "set_asset_lock") {
    const assetId = String(args.assetId ?? "");
    const locked = args.locked === true || args.locked === "true";
    const [asset] = await db
      .select()
      .from(schema.assets)
      .where(and(eq(schema.assets.id, assetId), isNull(schema.assets.deletedAt)));
    if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材" });
    requireGroup(auth, asset.groupId);
    await assertProjectEditable(auth, { id: asset.projectId, groupId: asset.groupId });
    const [updated] = await db
      .update(schema.assets)
      .set({ locked })
      .where(eq(schema.assets.id, assetId))
      .returning();
    return { assetId: updated.id, locked: updated.locked };
  }

  // ── 角色／場景卡／道具卡 ──
  if (name === "add_character") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, project.groupId);
    await assertProjectEditable(auth, project);
    const nameStr = String(args.name ?? "").trim();
    const appearance = String(args.appearance ?? "").trim();
    if (!nameStr || !appearance) throw new TRPCError({ code: "BAD_REQUEST", message: "請填角色名與外觀" });
    if (typeof args.referenceAssetId === "string") {
      await assertReferenceImage(args.referenceAssetId, project.groupId, project.id);
    }
    const [row] = await db
      .insert(schema.characters)
      .values({
        projectId: project.id,
        groupId: project.groupId,
        name: nameStr.slice(0, 80),
        appearance: appearance.slice(0, 2000),
        notes: typeof args.notes === "string" ? args.notes.slice(0, 2000) : null,
        referenceAssetId: typeof args.referenceAssetId === "string" ? args.referenceAssetId : null,
        createdBy: auth.user.id,
      })
      .returning();
    const [verified] = await db.select({
      id: schema.characters.id,
      name: schema.characters.name,
      projectId: schema.characters.projectId,
    }).from(schema.characters).where(eq(schema.characters.id, row.id));
    return {
      characterId: verified?.id ?? row.id,
      name: verified?.name ?? row.name,
      projectId: verified?.projectId ?? project.id,
      verified: Boolean(verified && verified.projectId === project.id && verified.name === nameStr.slice(0, 80)),
    };
  }

  if (name === "update_character") {
    const id = String(args.characterId ?? "");
    const [row] = await db.select().from(schema.characters).where(eq(schema.characters.id, id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到角色卡" });
    requireGroup(auth, row.groupId);
    await assertProjectEditable(auth, { id: row.projectId, groupId: row.groupId });
    assertMcpProjectScope(row.projectId, args.projectId, "角色卡");
    const patch: Record<string, unknown> = {};
    if (typeof args.name === "string" && args.name.trim()) patch.name = args.name.trim().slice(0, 80);
    if (typeof args.appearance === "string" && args.appearance.trim()) patch.appearance = args.appearance.trim().slice(0, 2000);
    if (typeof args.notes === "string") patch.notes = args.notes.slice(0, 2000);
    if (args.referenceAssetId === null) patch.referenceAssetId = null;
    else if (typeof args.referenceAssetId === "string") {
      await assertReferenceImage(args.referenceAssetId, row.groupId, row.projectId);
      patch.referenceAssetId = args.referenceAssetId;
    }
    if (Object.keys(patch).length === 0) return mcpUnchanged({ characterId: row.id, name: row.name });
    const [updated] = await db.update(schema.characters).set(patch).where(eq(schema.characters.id, id)).returning();
    await refreshShotContextStalenessSafely({
      auth,
      projectId: row.projectId,
      changed: { kind: "character", id: row.id },
    });
    return { characterId: updated.id, name: updated.name };
  }

  if (name === "add_scene_preset") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, project.groupId);
    await assertProjectEditable(auth, project);
    const nameStr = String(args.name ?? "").trim();
    const palette = String(args.palette ?? "").trim();
    if (!nameStr || !palette) throw new TRPCError({ code: "BAD_REQUEST", message: "請填場景名與色板" });
    if (typeof args.referenceAssetId === "string") {
      await assertReferenceImage(args.referenceAssetId, project.groupId, project.id);
    }
    const [row] = await db
      .insert(schema.scenePresets)
      .values({
        projectId: project.id,
        groupId: project.groupId,
        name: nameStr.slice(0, 80),
        palette: palette.slice(0, 500),
        lighting: typeof args.lighting === "string" ? args.lighting.slice(0, 500) : null,
        referenceAssetId: typeof args.referenceAssetId === "string" ? args.referenceAssetId : null,
        createdBy: auth.user.id,
      })
      .returning();
    return { presetId: row.id, name: row.name };
  }

  if (name === "update_scene_preset") {
    const id = String(args.presetId ?? "");
    const [row] = await db.select().from(schema.scenePresets).where(eq(schema.scenePresets.id, id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到場景設定卡" });
    requireGroup(auth, row.groupId);
    await assertProjectEditable(auth, { id: row.projectId, groupId: row.groupId });
    assertMcpProjectScope(row.projectId, args.projectId, "場景設定卡");
    const patch: Record<string, unknown> = {};
    if (typeof args.name === "string" && args.name.trim()) patch.name = args.name.trim().slice(0, 80);
    if (typeof args.palette === "string" && args.palette.trim()) patch.palette = args.palette.trim().slice(0, 500);
    if (typeof args.lighting === "string") patch.lighting = args.lighting.slice(0, 500);
    if (args.referenceAssetId === null) patch.referenceAssetId = null;
    else if (typeof args.referenceAssetId === "string") {
      await assertReferenceImage(args.referenceAssetId, row.groupId, row.projectId);
      patch.referenceAssetId = args.referenceAssetId;
    }
    if (Object.keys(patch).length === 0) return mcpUnchanged({ presetId: row.id, name: row.name });
    const [updated] = await db.update(schema.scenePresets).set(patch).where(eq(schema.scenePresets.id, id)).returning();
    await refreshShotContextStalenessSafely({
      auth,
      projectId: row.projectId,
      changed: { kind: "scene_preset", id: row.id },
    });
    return { presetId: updated.id, name: updated.name };
  }

  if (name === "add_prop") {
    const projectId = String(args.projectId ?? "");
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
    requireGroup(auth, project.groupId);
    await assertProjectEditable(auth, project);
    const nameStr = String(args.name ?? "").trim();
    const appearance = String(args.appearance ?? "").trim();
    if (!nameStr || !appearance) throw new TRPCError({ code: "BAD_REQUEST", message: "請填素材名與外觀" });
    if (typeof args.referenceAssetId === "string") {
      await assertReferenceImage(args.referenceAssetId, project.groupId, project.id);
    }
    const [row] = await db
      .insert(schema.props)
      .values({
        projectId: project.id,
        groupId: project.groupId,
        name: nameStr.slice(0, 80),
        appearance: appearance.slice(0, 2000),
        notes: typeof args.notes === "string" ? args.notes.slice(0, 2000) : null,
        referenceAssetId: typeof args.referenceAssetId === "string" ? args.referenceAssetId : null,
        createdBy: auth.user.id,
      })
      .returning();
    return { propId: row.id, name: row.name };
  }

  if (name === "update_prop") {
    const id = String(args.propId ?? "");
    const [row] = await db.select().from(schema.props).where(eq(schema.props.id, id));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到素材設定卡" });
    requireGroup(auth, row.groupId);
    await assertProjectEditable(auth, { id: row.projectId, groupId: row.groupId });
    assertMcpProjectScope(row.projectId, args.projectId, "素材設定卡");
    const patch: Record<string, unknown> = {};
    if (typeof args.name === "string" && args.name.trim()) patch.name = args.name.trim().slice(0, 80);
    if (typeof args.appearance === "string" && args.appearance.trim()) patch.appearance = args.appearance.trim().slice(0, 2000);
    if (typeof args.notes === "string") patch.notes = args.notes.slice(0, 2000);
    if (args.referenceAssetId === null) patch.referenceAssetId = null;
    else if (typeof args.referenceAssetId === "string") {
      await assertReferenceImage(args.referenceAssetId, row.groupId, row.projectId);
      patch.referenceAssetId = args.referenceAssetId;
    }
    if (Object.keys(patch).length === 0) return mcpUnchanged({ propId: row.id, name: row.name });
    const [updated] = await db.update(schema.props).set(patch).where(eq(schema.props.id, id)).returning();
    await refreshShotContextStalenessSafely({
      auth,
      projectId: row.projectId,
      changed: { kind: "prop", id: row.id },
    });
    return { propId: updated.id, name: updated.name };
  }

  // ── 生成後處理 ──
  if (name === "rename_generation") {
    const generationId = String(args.generationId ?? "");
    const nameStr = String(args.name ?? "").trim();
    if (!nameStr) throw new TRPCError({ code: "BAD_REQUEST", message: "請填名稱" });
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, generationId));
    if (!gen) throw new TRPCError({ code: "NOT_FOUND", message: "找不到生成" });
    requireGroup(auth, gen.groupId);
    await assertProjectEditable(auth, { id: gen.projectId, groupId: gen.groupId });
    const [updated] = await db
      .update(schema.generations)
      .set({ name: nameStr.slice(0, 80) })
      .where(eq(schema.generations.id, generationId))
      .returning();
    return { generationId: updated.id, name: updated.name };
  }

  if (name === "retry_generation") {
    const generationId = String(args.generationId ?? "");
    const [gen] = await db.select().from(schema.generations).where(eq(schema.generations.id, generationId));
    if (!gen) throw new TRPCError({ code: "NOT_FOUND", message: "找不到生成" });
    requireGroup(auth, gen.groupId);
    if (gen.status !== "failed") throw new TRPCError({ code: "BAD_REQUEST", message: "只有失敗的生成可以重試" });
    await assertProjectEditable(auth, { id: gen.projectId, groupId: gen.groupId });
    // 與 generation.retry 共用同一份重試輸入（#725 P1-4）。
    // 這裡原本是退化版重複實作，少帶 sceneRole（重試失敗的旁白 → 音訊寫進主畫面槽）、
    // preserveScenePointer（重試失敗的變體 → 變成會移動指標的生成）與全部卡片錨點。
    const newGen = await executeGenerationCommand({
      auth,
      source: "mcp",
      ...buildRetryGenerationInput(gen),
      reasonPrefix: "MCP 重試生成",
    });
    return {
      generationId: newGen.id,
      status: newGen.status,
      points: newGen.pointsEst,
      retriedFrom: generationId,
    };
  }

  // ── Adobe ──
  if (name === "adobe_status") {
    const view = await adobeConnectionView(auth.user.id);
    return {
      connected: view.connected,
      email: view.email,
      mode: view.mode,
      status: view.status,
      capabilities: view.capabilities,
      note: view.connected
        ? "已連結。修圖使用你自己的 Adobe 配額，不扣站內點數。"
        : "尚未連結——請到網站「整合連接」頁連結 Adobe。",
    };
  }

  if (name === "adobe_list_assets") {
    try {
      return await listAdobeAssets(auth.user.id, {
        query: typeof args.query === "string" ? args.query : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
    } catch (err) {
      adobeErr(err);
    }
  }

  if (name === "adobe_edit_photo") {
    try {
      const job = await startAdobePhotoEdit(auth.user.id, {
        assetId: String(args.assetId ?? ""),
        operations: (args.operations as never) ?? [],
        outputFormat: (args.outputFormat as "png" | "jpeg" | "webp") ?? "png",
        outputName: typeof args.outputName === "string" ? args.outputName : undefined,
      });
      return { jobId: job.id, status: job.status, note: "用 adobe_job 輪詢到 succeeded。" };
    } catch (err) {
      adobeErr(err);
    }
  }

  if (name === "adobe_job") {
    try {
      const job = await getAdobeJob(auth.user.id, String(args.jobId ?? ""));
      return {
        id: job.id,
        status: job.status,
        progress: job.progress,
        resultAsset: job.resultAsset ?? null,
        error: job.error ?? null,
      };
    } catch (err) {
      adobeErr(err);
    }
  }

  if (name === "adobe_export_timeline") {
    const timeline = parseTimelineArg(args.timeline);
    const bundle = exportAdobeTimelineFormats(timeline, {
      pathPrefix: typeof args.pathPrefix === "string" ? args.pathPrefix : undefined,
      width: timeline.width,
      height: timeline.height,
    });
    return {
      name: timeline.name,
      durationSec: bundle.durationSec,
      sceneCount: bundle.sceneCount,
      fcpxml: bundle.fcpxml,
      xmeml: bundle.xmeml,
      edl: bundle.edl,
    };
  }

  if (name === "adobe_render_timeline") {
    try {
      const job = await startAdobeTimelineRender(auth.user.id, parseTimelineArg(args.timeline));
      return { jobId: job.id, status: job.status, note: "用 adobe_job 輪詢。" };
    } catch (err) {
      adobeErr(err);
    }
  }

  return null;
}
