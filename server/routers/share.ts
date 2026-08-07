/**
 * 專案分享連結：建立／列出／撤銷（需登入）＋唯讀公開檢視（不需登入）。
 *
 * ★ 管理面與公開面刻意放同一支檔案：全庫唯一的免登入內容出口就是底下那支 view，
 *   審查「對外到底公開了什麼」時只要讀這一頁，不必翻遍所有 router。
 */
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { Request } from "express";
import { router, authedProcedure, publicProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { assertProjectEditable } from "../services/projectAcl";
import type { AuthState } from "../services/auth";
import {
  SHARE_MAX_EXPIRES_DAYS,
  SHARE_PATH_PREFIX,
  buildSharedProjectView,
  generateShareToken,
  hashShareToken,
  recordShareView,
  resolveShareLink,
} from "../services/projectShare";
import { RATE_LIMIT_POLICIES, RATE_LIMIT_SCOPES, consumeRateLimit } from "../services/rateLimit";

/** 各種「連結不能用」的人話（公開頁直接顯示；一律不透露專案是否存在） */
const REJECTION_MESSAGE = {
  "not-found": "這個分享連結無效——可能已被刪除，或網址被截斷了",
  revoked: "這個分享連結已被建立者收回",
  expired: "這個分享連結已過期——請向分享的人索取新連結",
  "project-gone": "這個分享連結指向的專案已不存在",
} as const;

/** 取用戶端 IP 供公開端點限流：一律走 Express 的 req.ip（index.ts 已設 trust proxy），
 *  不讀可偽造的 X-Forwarded-For——否則攻擊者每次換一個假 IP，限流形同虛設。 */
function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

/** 專案取用＋組隔離；分享連結是專案級動作，沿用「可編輯者」這把尺（檢視者不能對外開連結） */
async function loadEditableProject(auth: AuthState, projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  await assertProjectEditable(auth, project);
  return project;
}

export const shareRouter = router({
  /** 本專案的分享連結清單（不含 token 原文——原文只在建立當下回一次，之後誰都拿不回來） */
  list: authedProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
      if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
      requireGroup(ctx.auth, project.groupId);
      return db
        .select({
          id: schema.projectShareLinks.id,
          label: schema.projectShareLinks.label,
          createdBy: schema.projectShareLinks.createdBy,
          createdAt: schema.projectShareLinks.createdAt,
          expiresAt: schema.projectShareLinks.expiresAt,
          revokedAt: schema.projectShareLinks.revokedAt,
          lastViewedAt: schema.projectShareLinks.lastViewedAt,
          viewCount: schema.projectShareLinks.viewCount,
        })
        .from(schema.projectShareLinks)
        .where(eq(schema.projectShareLinks.projectId, input.projectId))
        .orderBy(desc(schema.projectShareLinks.createdAt));
    }),

  /**
   * 建立一條分享連結。回傳的 url 是相對路徑（前端補上當下的來源），token 原文只此一次。
   * expiresInDays 省略＝不設期限；建立者要自己記得撤銷。
   */
  create: authedProcedure
    .input(z.object({
      projectId: z.string().uuid(),
      label: z.string().trim().max(60).optional(),
      expiresInDays: z.number().int().min(1).max(SHARE_MAX_EXPIRES_DAYS).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await loadEditableProject(ctx.auth, input.projectId);
      const token = generateShareToken();
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 3600_000)
        : null;
      const [link] = await db
        .insert(schema.projectShareLinks)
        .values({
          projectId: project.id,
          groupId: project.groupId,
          tokenHash: hashShareToken(token),
          label: input.label || null,
          createdBy: ctx.auth.user.id,
          expiresAt,
        })
        .returning();
      return { id: link.id, url: `${SHARE_PATH_PREFIX}${token}`, expiresAt };
    }),

  /** 撤銷（軟撤銷、保留稽核歸屬）：連結立刻失效，已撤銷的再撤一次是 no-op */
  revoke: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [link] = await db
        .select()
        .from(schema.projectShareLinks)
        .where(eq(schema.projectShareLinks.id, input.id));
      if (!link) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這條分享連結" });
      await loadEditableProject(ctx.auth, link.projectId);
      await db
        .update(schema.projectShareLinks)
        .set({ revokedAt: new Date() })
        .where(and(eq(schema.projectShareLinks.id, link.id), isNull(schema.projectShareLinks.revokedAt)));
      return { ok: true };
    }),

  /**
   * ★ 公開唯讀檢視（不需登入）——全庫唯一的免登入內容出口。
   *
   * 守衛順序刻意如此：先限流（擋掃描）→ 再解析 token（形狀不對連 DB 都不打）→
   * 才組資料。回傳內容全部由 buildSharedProjectView 決定，這裡不另外查任何東西。
   */
  view: publicProcedure
    .input(z.object({ token: z.string().max(200) }))
    .query(async ({ ctx, input }) => {
      const decision = await consumeRateLimit(
        RATE_LIMIT_SCOPES.shareViewIp,
        clientIp(ctx.req),
        RATE_LIMIT_POLICIES.shareView,
      );
      if (!decision.allowed) {
        throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "開啟太頻繁，請稍候再試" });
      }

      const resolved = await resolveShareLink(input.token);
      if (!resolved.ok) {
        throw new TRPCError({ code: "NOT_FOUND", message: REJECTION_MESSAGE[resolved.reason] });
      }

      const view = await buildSharedProjectView(resolved.link.projectId);
      if (!view) {
        throw new TRPCError({ code: "NOT_FOUND", message: REJECTION_MESSAGE["project-gone"] });
      }

      await recordShareView(resolved.link.id);
      return view;
    }),
});
