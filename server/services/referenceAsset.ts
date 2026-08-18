import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";

/**
 * 參考圖綁定驗證（角色定裝卡／場景設定卡／造型／道具／封面共用）：
 * 素材要存在且不在回收桶、同組、**同專案**（同組兩個「小華」不能互綁定裝圖）、且是圖片。
 * 與 generationCore 對 sourceAssetId 同一把尺——groupId 不夠，封面早已要求 projectId。
 */
export async function assertReferenceImage(assetId: string, groupId: string, projectId: string): Promise<void> {
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), isNull(schema.assets.deletedAt)));
  if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到參考素材（可能已在回收桶——先還原再綁定）" });
  if (asset.groupId !== groupId) throw new TRPCError({ code: "FORBIDDEN", message: "參考素材不屬於此專案的組" });
  if (asset.projectId !== projectId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "參考素材不屬於此專案（同組其他專案的圖不能當定裝）" });
  }
  if (asset.kind !== "image") throw new TRPCError({ code: "BAD_REQUEST", message: "參考素材要是圖片——請選圖片類素材" });
}
