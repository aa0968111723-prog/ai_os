import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { lockSceneOrder } from "./locks";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";

export const SCENE_DRAFT_REPLAY_MS = 120_000;
const SCENE_TITLE_MAX = 80;

type SceneRow = typeof schema.scenes.$inferSelect;

/**
 * 新增一格草稿分鏡。Agent 帶 effect id 時以主鍵重播；網站／MCP 無 id 時，
 * 同一專案、同一標題＋提示詞＋旁白＋秒數、仍是未生成草稿、2 分鐘內的列視為重試。
 * 沒有 createdBy 欄，所以身分是「這格內容」而不是人——兩分鐘內複製同一格草稿幾乎一定是雙擊。
 */
export async function addSceneDraftOnce(input: {
  projectId: string;
  title: string;
  prompt?: string | null;
  voiceover?: string | null;
  durationSec?: number;
  id?: string;
}): Promise<SceneRow> {
  const title = input.title.trim();
  if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "分鏡標題不能是空白" });
  const clippedTitle = title.slice(0, SCENE_TITLE_MAX);
  const prompt = input.prompt?.trim() || null;
  const voiceover = input.voiceover?.trim() || null;
  const durationSec = input.durationSec != null
    ? Math.max(1, Math.min(60, Math.round(input.durationSec)))
    : 5;

  return db.transaction(async (tx) => {
    await lockSceneOrder(tx, input.projectId);
    if (input.id) {
      const [existing] = await tx
        .select()
        .from(schema.scenes)
        .where(and(eq(schema.scenes.id, input.id), eq(schema.scenes.projectId, input.projectId)));
      if (existing) return existing;
    } else {
      const [recent] = await tx
        .select()
        .from(schema.scenes)
        .where(and(
          eq(schema.scenes.projectId, input.projectId),
          eq(schema.scenes.title, clippedTitle),
          prompt ? eq(schema.scenes.prompt, prompt) : isNull(schema.scenes.prompt),
          voiceover ? eq(schema.scenes.voiceover, voiceover) : isNull(schema.scenes.voiceover),
          eq(schema.scenes.durationSec, durationSec),
          eq(schema.scenes.status, "todo"),
          isNull(schema.scenes.assetId),
          isNull(schema.scenes.deletedAt),
          gte(schema.scenes.createdAt, new Date(Date.now() - SCENE_DRAFT_REPLAY_MS)),
        ))
        .orderBy(desc(schema.scenes.createdAt))
        .limit(1);
      if (recent) return recent;
    }
    const [{ maxOrder }] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${schema.scenes.orderIndex}), 0)` })
      .from(schema.scenes)
      .where(and(eq(schema.scenes.projectId, input.projectId), isNull(schema.scenes.deletedAt)));
    const [row] = await tx
      .insert(schema.scenes)
      .values({
        id: input.id,
        projectId: input.projectId,
        orderIndex: Number(maxOrder) + 1,
        title: clippedTitle,
        prompt: prompt ?? undefined,
        voiceover: voiceover ?? undefined,
        durationSec,
        status: "todo",
      })
      .returning();
    if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "新增分鏡失敗" });
    return row;
  });
}

/**
 * 將同一專案的一批分鏡移入回收桶。一般單格刪除與 Agent Undo 共用這個守門，
 * 避免直接執行路徑另外長出一套權限判斷。
 */
export async function softDeleteScenesCore(
  auth: AuthState,
  projectId: string,
  sceneIds: string[],
): Promise<{ ok: true; count: number }> {
  const ids = [...new Set(sceneIds)];
  if (!ids.length || ids.length > 12) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "需指定 1–12 個分鏡" });
  }
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) throw new TRPCError({ code: "NOT_FOUND", message: "找不到專案" });
  requireGroup(auth, project.groupId);
  assertProjectNotArchived(project);
  await assertProjectEditable(auth, project);
  const rows = await db
    .select({ id: schema.scenes.id })
    .from(schema.scenes)
    .where(and(
      eq(schema.scenes.projectId, project.id),
      inArray(schema.scenes.id, ids),
      isNull(schema.scenes.deletedAt),
    ));
  if (rows.length !== ids.length) {
    throw new TRPCError({ code: "NOT_FOUND", message: "部分分鏡不存在、已刪除或不屬於這個專案" });
  }
  await db
    .update(schema.scenes)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.scenes.projectId, project.id), inArray(schema.scenes.id, ids), isNull(schema.scenes.deletedAt)));
  return { ok: true, count: ids.length };
}
