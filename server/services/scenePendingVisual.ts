/**
 * 「這一格正在生成畫面嗎」——就地生成／修正共用的伺服器端防抖。
 * 兩顆鈕都直接扣點、沒有二次確認，快速雙擊或兩人同時按會重複送出、重複扣點。
 * （catch 常見雙擊；非強一致鎖）
 *
 * generateInto / generateVariants / refine 早已走這支。MCP generate_into_scene
 * 曾略過，外部工具連打同一鏡會重複扣點。抽出來讓 MCP 共用，不另寫一份閘。
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";

export async function assertNoPendingVisual(sceneId: string): Promise<void> {
  const [pendingVisual] = await db
    .select({ id: schema.generations.id })
    .from(schema.generations)
    .where(and(
      eq(schema.generations.sceneId, sceneId),
      sql`(${schema.generations.sceneRole} is null or ${schema.generations.sceneRole} = 'visual')`,
      // awaiting_approval：超額待核也算「在途」，防連點堆多筆待核
      inArray(schema.generations.status, ["queued", "running", "awaiting_approval"]),
    ))
    .limit(1);
  if (pendingVisual) throw new TRPCError({ code: "CONFLICT", message: "這一格正在生成或待核准中，請稍候再生成" });
}
