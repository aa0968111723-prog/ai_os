import { and, eq, inArray, isNull } from "drizzle-orm";
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

/**
 * 生成路徑帶入定裝圖：有 id 才 assert（同組＋同專案＋是圖片）。
 * 空定裝／未勾選＝略過，不得 500。
 */
export async function assertOptionalReferenceImage(
  assetId: string | undefined,
  groupId: string,
  projectId: string,
): Promise<string | undefined> {
  const id = assetId?.trim();
  if (!id) return undefined;
  await assertReferenceImage(id, groupId, projectId);
  return id;
}

/**
 * 角色卡「生成時帶入」：只帶該角色自己的同專案定裝圖。
 * 已選 0/6、小華 0 refs、或明示一張無關的 1/50＝略過（文字錨點／粉橘短髮女孩白帽T），不得 500。
 * 不從 ensureXiaohua 自動補的 id 找圖——未勾選／沒有自己的定裝不得偷偷帶圖。
 */
export async function resolveHonoredCharacterSheet(opts: {
  projectId: string;
  groupId: string;
  /** 角色卡勾選／這一鏡自己的綁定，不是自動補的小華 */
  characterIds?: string[];
  /** 呼叫端明示的來源；必須是勾選角色自己的定裝圖，否則當 stray 丟掉 */
  explicitSourceAssetId?: string;
}): Promise<string | undefined> {
  if (!opts.characterIds?.length) return undefined;

  const ids = [...new Set(opts.characterIds)];
  const rows = await db
    .select({
      id: schema.characters.id,
      referenceAssetId: schema.characters.referenceAssetId,
    })
    .from(schema.characters)
    .innerJoin(
      schema.assets,
      and(
        eq(schema.assets.id, schema.characters.referenceAssetId),
        eq(schema.assets.projectId, opts.projectId),
        isNull(schema.assets.deletedAt),
        eq(schema.assets.kind, "image"),
      ),
    )
    .where(and(eq(schema.characters.projectId, opts.projectId), inArray(schema.characters.id, ids)));
  const owned = new Set(rows.map((row) => row.referenceAssetId).filter((id): id is string => Boolean(id)));
  const explicit = opts.explicitSourceAssetId?.trim();
  if (explicit && owned.has(explicit)) {
    return assertOptionalReferenceImage(explicit, opts.groupId, opts.projectId);
  }
  const byId = new Map(rows.map((row) => [row.id, row.referenceAssetId]));
  for (const id of opts.characterIds) {
    const assetId = byId.get(id);
    if (assetId && owned.has(assetId)) {
      return assertOptionalReferenceImage(assetId, opts.groupId, opts.projectId);
    }
  }
  return undefined;
}
