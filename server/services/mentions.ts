/**
 * @提及共用校驗(留言／筆記／排程共用):把輸入的 userId 陣列限縮到「真的是同組成員」,
 * 名單外的一律拒絕(不靜默過濾——壞輸入要看得見)。回傳去重後的 id 陣列或 undefined。
 */
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { parseMentionedNames } from "../../shared/mentions";

/** 同組成員的 id 與名字（解析 @名字 要用名字，驗證要用 id） */
async function groupMemberDirectory(groupId: string): Promise<Array<{ userId: string; name: string }>> {
  return db
    .select({ userId: schema.groupMembers.userId, name: schema.users.name })
    .from(schema.groupMembers)
    .innerJoin(schema.users, eq(schema.users.id, schema.groupMembers.userId))
    .where(eq(schema.groupMembers.groupId, groupId));
}

export async function validateMentions(groupId: string, mentions: string[] | undefined): Promise<string[] | undefined> {
  if (!mentions?.length) return undefined;
  const members = await groupMemberDirectory(groupId);
  const memberIds = new Set(members.map((m) => m.userId));
  for (const uid of mentions) {
    if (!memberIds.has(uid)) throw new TRPCError({ code: "BAD_REQUEST", message: "只能提及同組夥伴" });
  }
  return [...new Set(mentions)];
}

/**
 * 送出留言時決定「誰真的被 @ 到了」＝ 前端傳來的 id ∪ 伺服器自己從內文解析出來的。
 *
 * 為什麼不能只信前端：前端是拿 `roles.data?.members ?? []` 算的，而那份名單是非同步載入的。
 * 打開專案後**立刻**打字送出，名單還沒回來，算出來的 mentions 就是空的——那則留言的
 * mentions 落庫成 null，伺服器從頭到尾不看 body，於是被 @ 的人**永遠不會收到通知**。
 * 沒有任何後續流程會補算它，訊息就這樣消失了。
 *
 * 取聯集而不是「以伺服器為準」：前端送 id 是精確的（使用者從選單點的），而內文解析
 * 是補網——同名、改名、名字含特殊字元時解析可能漏，不該把前端已經確定的那幾個蓋掉。
 *
 * 名字比對沿用 shared/mentions 的長名優先規則（同一份純函式前後端共用），
 * 否則「@阿明師兄」會連「阿明」一起命中而誤發通知。
 */
export async function resolveMentions(
  groupId: string,
  explicit: string[] | undefined,
  body: string,
): Promise<string[] | undefined> {
  const members = await groupMemberDirectory(groupId);
  const memberIds = new Set(members.map((m) => m.userId));
  for (const uid of explicit ?? []) {
    if (!memberIds.has(uid)) throw new TRPCError({ code: "BAD_REQUEST", message: "只能提及同組夥伴" });
  }
  const byName = new Map(members.map((m) => [m.name, m.userId]));
  const parsed = parseMentionedNames(body, [...byName.keys()])
    .map((name) => byName.get(name))
    .filter((id): id is string => !!id);
  const all = [...new Set([...(explicit ?? []), ...parsed])];
  return all.length ? all : undefined;
}
