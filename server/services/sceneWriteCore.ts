import { and, eq, inArray, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectEditable, assertProjectNotArchived } from "./projectAcl";

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
