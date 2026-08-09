import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { authedProcedure, requireGroup, router } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable, assertProjectNotArchived } from "../services/projectAcl";
import {
  cancelFolderImportSession,
  createFolderImportSession,
  ensureFolderImportBatch,
  folderImportSessionStatus,
  listFolderImportSessions,
  pendingFolderImportEntries,
} from "../services/folderImport";
import {
  FOLDER_IMPORT_MODES,
  FOLDER_IMPORT_SOURCE_TYPES,
  diffFolderManifest,
  folderTreeFromPaths,
  looksLikeAbsoluteLocalPath,
  normalizeRelativePath,
} from "../../shared/folderImport";

/**
 * Folder Import 2.0 router。
 *
 * ★ 這裡**不**收檔案內容——bytes 仍走既有的 `POST /api/upload`。
 *   這支只負責 manifest、差異比對、進度與續傳清單。
 *
 * ★ 隱私（§11）：任何看起來像本機絕對路徑的東西一律拒收。
 *   server 只需要「顯示名 + 相對路徑」，完整路徑留在使用者的電腦上。
 */

const manifestEntrySchema = z.object({
  relativePath: z.string().min(1).max(1_024),
  filename: z.string().min(1).max(300),
  parentPath: z.string().max(1_024).default(""),
  size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  lastModified: z.number().int().nullable().default(null),
  mime: z.string().max(200).nullable().default(null),
});

/** 絕對路徑在 zod 就擋掉，不進 service、不進 DB、不進 AI context。 */
function assertNoAbsolutePaths(entries: readonly { relativePath: string }[]): void {
  for (const entry of entries) {
    if (looksLikeAbsoluteLocalPath(entry.relativePath) || !normalizeRelativePath(entry.relativePath)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "資料夾清單只接受相對路徑——本機完整路徑不會送到伺服器",
      });
    }
  }
}

async function loadSessionForActor(auth: Parameters<typeof requireGroup>[0], sessionId: string) {
  const [session] = await db.select().from(schema.folderImportSessions)
    .where(eq(schema.folderImportSessions.id, sessionId));
  if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這次匯入" });
  requireGroup(auth, session.groupId);
  return session;
}

async function loadProject(auth: Parameters<typeof requireGroup>[0], projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  return project;
}

export const folderImportRouter = router({
  /**
   * 只比對、不建立 session（「再次匯入」的確認畫面用）。
   * 使用者看到「新增 20／修改 5／來源消失 3」之後才決定要不要真的匯入。
   */
  preview: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      displayName: z.string().trim().min(1).max(200),
      sourceRootId: z.string().trim().max(200).optional(),
      entries: z.array(manifestEntrySchema).max(20_000),
    }))
    .query(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      assertNoAbsolutePaths(input.entries);
      const [previous] = await db.select().from(schema.folderImportSessions).where(and(
        eq(schema.folderImportSessions.groupId, input.groupId),
        input.sourceRootId
          ? eq(schema.folderImportSessions.sourceRootId, input.sourceRootId)
          : eq(schema.folderImportSessions.displayName, input.displayName),
      )).orderBy(schema.folderImportSessions.createdAt).limit(1);
      const known = previous
        ? await db.select().from(schema.folderImportEntries)
          .where(eq(schema.folderImportEntries.sessionId, previous.id))
        : [];
      const diff = diffFolderManifest(
        known.map((entry) => ({
          relativePath: entry.relativePath,
          size: Number(entry.sizeBytes ?? 0),
          lastModified: entry.sourceLastModifiedAt ? entry.sourceLastModifiedAt.getTime() : null,
          checksum: entry.checksum,
          uploadStatus: entry.uploadStatus as "uploaded",
        })),
        input.entries,
      );
      return {
        counts: diff.counts,
        previousSessionId: previous?.id ?? null,
        tree: folderTreeFromPaths(input.entries.map((entry) => entry.relativePath)),
        // MISSING 只列出來給人看——這支永遠不會刪任何東西
        missing: diff.items.filter((item) => item.state === "MISSING").slice(0, 200).map((item) => item.relativePath),
      };
    }),

  /** 建立匯入 session（落 manifest、算差異、回這次真的要傳的檔案清單）。 */
  begin: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      displayName: z.string().trim().min(1).max(200),
      sourceType: z.enum(FOLDER_IMPORT_SOURCE_TYPES).default("web_directory"),
      sourceRootId: z.string().trim().max(200).optional(),
      mode: z.enum(FOLDER_IMPORT_MODES).default("import_once"),
      entries: z.array(manifestEntrySchema).min(1).max(20_000),
    }))
    .mutation(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      assertNoAbsolutePaths(input.entries);
      if (input.projectId) {
        const project = await loadProject(ctx.auth, input.projectId);
        if (project.groupId !== input.groupId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "專案與團隊不一致" });
        }
        assertProjectNotArchived(project);
        await assertProjectEditable(ctx.auth, project);
      }
      // 瀏覽器沒有辦法持續監看使用者的電腦——不接受它宣稱 watched（§9）
      const mode = input.sourceType === "web_directory" && input.mode === "watched" ? "manual_rescan" : input.mode;
      const result = await createFolderImportSession({
        groupId: input.groupId,
        projectId: input.projectId ?? null,
        displayName: input.displayName,
        sourceType: input.sourceType,
        sourceRootId: input.sourceRootId ?? null,
        mode,
        entries: input.entries,
        createdBy: ctx.auth.user.id,
      });
      const batchId = await ensureFolderImportBatch(result.session);
      return {
        sessionId: result.session.id,
        batchId,
        counts: result.counts,
        previousSessionId: result.previousSessionId,
        /** 只有這些要真的上傳；UNCHANGED 不重傳、不重跑 AI */
        uploadQueue: result.entries
          .filter((entry) => entry.uploadStatus === "pending")
          .map((entry) => ({ relativePath: entry.relativePath, sizeBytes: Number(entry.sizeBytes ?? 0) })),
      };
    }),

  /** 續傳清單：重新開啟 session 時，已完成的檔案不會出現在這裡（§7）。 */
  resume: authedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await loadSessionForActor(ctx.auth, input.sessionId);
      const pending = await pendingFolderImportEntries(session.id);
      return {
        sessionId: session.id,
        projectId: session.projectId,
        status: session.status,
        pending: pending.map((entry) => ({
          relativePath: entry.relativePath,
          sizeBytes: Number(entry.sizeBytes ?? 0),
          attempt: entry.attempt,
        })),
      };
    }),

  /**
   * 回報一個檔案「傳不上去」。
   *
   * 成功的那一條路由由 `/api/upload` 自己記（它才知道 asset id），
   * 但網路失敗只有瀏覽器知道——沒有這一支，session 會永遠停在「還在上傳」。
   * ★ 只接受 failed／skipped：成功與否由伺服器認定，前端不能自稱上傳成功。
   */
  reportFailure: authedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      relativePath: z.string().min(1).max(1_024),
      status: z.enum(["failed", "skipped"]).default("failed"),
      error: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await loadSessionForActor(ctx.auth, input.sessionId);
      assertNoAbsolutePaths([{ relativePath: input.relativePath }]);
      const { recordFolderImportEntryResult } = await import("../services/folderImport");
      const entry = await recordFolderImportEntryResult({
        sessionId: session.id,
        relativePath: input.relativePath,
        status: input.status,
        error: input.error ?? null,
      });
      return { ok: Boolean(entry) };
    }),

  /** 進度：上傳與 AI 理解**分開**回報，不合成一個假的整體百分比（§6）。 */
  status: authedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await loadSessionForActor(ctx.auth, input.sessionId);
      const status = await folderImportSessionStatus(session.id);
      if (!status) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這次匯入" });
      return status;
    }),

  list: authedProcedure
    .input(z.object({ projectId: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (input?.projectId) await loadProject(ctx.auth, input.projectId);
      return listFolderImportSessions({
        groupIds: [...new Set(ctx.auth.groups.map((group) => group.groupId))],
        projectId: input?.projectId ?? null,
        limit: input?.limit,
      });
    }),

  /** 原始資料夾結構（與智慧分類共用同一批資料，不是另一份副本）。 */
  tree: authedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const session = await loadSessionForActor(ctx.auth, input.sessionId);
      const entries = await db.select({
        relativePath: schema.folderImportEntries.relativePath,
        filename: schema.folderImportEntries.filename,
        parentPath: schema.folderImportEntries.parentPath,
        uploadStatus: schema.folderImportEntries.uploadStatus,
        diffState: schema.folderImportEntries.diffState,
        resourceKind: schema.folderImportEntries.resourceKind,
        resourceId: schema.folderImportEntries.resourceId,
        intelligenceId: schema.folderImportEntries.intelligenceId,
      }).from(schema.folderImportEntries)
        .where(eq(schema.folderImportEntries.sessionId, session.id))
        .limit(5_000);
      return {
        displayName: session.displayName,
        tree: folderTreeFromPaths(entries.map((entry) => entry.relativePath)),
        entries,
      };
    }),

  /**
   * 取消：只停掉還沒傳的，已經進站的資料完全不動
   * （與「中斷來源連線不刪已匯入內容」同一條原則）。
   */
  cancel: authedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const session = await loadSessionForActor(ctx.auth, input.sessionId);
      if (session.createdBy !== ctx.auth.user.id) {
        const role = requireGroup(ctx.auth, session.groupId);
        if (role === "member") throw new TRPCError({ code: "FORBIDDEN", message: "只有發起者或組長可以取消這次匯入" });
      }
      await cancelFolderImportSession(session.id);
      return { ok: true };
    }),
});
