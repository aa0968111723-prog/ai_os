/**
 * @提及共用校驗(留言／筆記／排程共用):把輸入的 userId 陣列限縮到「真的是同組成員」,
 * 名單外的一律拒絕(不靜默過濾——壞輸入要看得見)。回傳去重後的 id 陣列或 undefined。
 */
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";

export async function validateMentions(groupId: string, mentions: string[] | undefined): Promise<string[] | undefined> {
  if (!mentions?.length) return undefined;
  const members = await db
    .select({ userId: schema.groupMembers.userId })
    .from(schema.groupMembers)
    .where(eq(schema.groupMembers.groupId, groupId));
  const memberIds = new Set(members.map((m) => m.userId));
  for (const uid of mentions) {
    if (!memberIds.has(uid)) throw new TRPCError({ code: "BAD_REQUEST", message: "只能提及同組夥伴" });
  }
  return [...new Set(mentions)];
}
