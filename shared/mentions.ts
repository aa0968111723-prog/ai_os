/**
 * @提及文字解析(前後端共用純函式,無 DB/無網路)。
 * 從留言內文與「同組成員名單」推出被 @ 到的名字集合——比對規則與留言區的高亮一致:
 * 名字含正則特殊字元先跳脫;長名優先(長度由大到小排),避免「阿明」吃掉「阿明師兄」的錯配。
 *
 * 為什麼要共用:送出留言時要把「@名字」換算成 userId(通知/未讀徽章依此),
 * 之前用 body.includes("@"+name) 判斷——當某成員名是另一成員名的前綴時(阿明 vs 阿明師兄),
 * 「@阿明師兄」會連「阿明」也被 includes 命中而誤發通知。這裡用與高亮相同的長名優先比對修掉。
 */

/** 把字串中的正則特殊字元跳脫,才能安全放進 RegExp 的字元類/交替式 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 建立「@(長名優先交替)」的比對式。給定成員名單,回傳可重複 exec 的全域 RegExp;
 * 名單為空回 null(呼叫端據此略過)。捕捉群組 1 即被 @ 到的名字。
 */
export function buildMentionRegExp(memberNames: string[]): RegExp | null {
  const names = memberNames.filter((n) => n.length > 0);
  if (!names.length) return null;
  const alts = [...names]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  return new RegExp(`@(${alts})`, "g");
}

/**
 * 解析內文中真正被 @ 到的成員名字(去重、保留首次出現順序)。
 * 長名優先確保「@阿明師兄」只算成「阿明師兄」,不會同時把「阿明」也算進去。
 */
export function parseMentionedNames(body: string, memberNames: string[]): string[] {
  const re = buildMentionRegExp(memberNames);
  if (!re) return [];
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    found.add(m[1]);
    // 零寬度理論上不會發生(@ 後必有至少一字),但保險推進避免無限迴圈
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return [...found];
}
