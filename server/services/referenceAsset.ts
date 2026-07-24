import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";

/**
 * 參考圖綁定驗證（角色定裝卡／場景設定卡共用）：
 * 素材要存在且不在回收桶、同組（擋跨組 IDOR，與 generationCore 對 sourceAssetId 一致）、且是圖片。
 */
export async function assertReferenceImage(assetId: string, groupId: string): Promise<void> {
  const [asset] = await db
    .select()
    .from(schema.assets)
    .where(and(eq(schema.assets.id, assetId), isNull(schema.assets.deletedAt)));
  if (!asset) throw new TRPCError({ code: "NOT_FOUND", message: "找不到參考素材（可能已在回收桶——先還原再綁定）" });
  if (asset.groupId !== groupId) throw new TRPCError({ code: "FORBIDDEN", message: "參考素材不屬於此專案的組" });
  if (asset.kind !== "image") throw new TRPCError({ code: "BAD_REQUEST", message: "參考素材要是圖片——請選圖片類素材" });
}
