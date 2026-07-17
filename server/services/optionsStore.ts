/**
 * 每組自訂選項的資料層（R23）——lazy-seed 與讀取。
 * 首次讀取某組時，把 shared/options 的預設種子補進 group_options（冪等），之後由組長自行增修。
 */
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db";
import { OPTION_TYPES, defaultsFor, type OptionType } from "../../shared/options";

/**
 * 每組只 seed 一次（用 groups.optionsSeeded 旗標判定，非「現存列數」）：
 * 一旦 seed 過，即使組長把某類選項全部刪光也不會復活——刪光＝刻意清空，要能維持。
 *
 * 併發首讀防護（核心缺陷審查:兩請求同時讀到 seeded=false 會各灌一整套預設）：
 * 交易內用 UPDATE … WHERE options_seeded=false RETURNING「原子認領」——第二個併發交易會
 * 卡在該 groups 列鎖上等第一個 commit，醒來後認領不到列就直接返回，同組永遠只有一個交易能 seed。
 * 另有 ensure.ts 開機建立的 (group_id,type,value) 唯一索引當 DB 層保底（onConflictDoNothing 因此真正生效）。
 */
export async function ensureGroupOptions(groupId: string): Promise<void> {
  // 快路徑：已 seed 的組零額外寫入（絕大多數請求走這裡）
  const [group] = await db.select({ seeded: schema.groups.optionsSeeded }).from(schema.groups).where(eq(schema.groups.id, groupId));
  if (!group || group.seeded) return;

  const rows: (typeof schema.groupOptions.$inferInsert)[] = [];
  for (const type of OPTION_TYPES) {
    defaultsFor(type).forEach((d, i) => {
      rows.push({ groupId, type: d.type, value: d.value, label: d.label, format: d.format ?? null, sortOrder: i });
    });
  }
  await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.groups)
      .set({ optionsSeeded: true })
      .where(and(eq(schema.groups.id, groupId), eq(schema.groups.optionsSeeded, false)))
      .returning({ id: schema.groups.id });
    if (!claimed.length) return; // 另一請求已認領（或已完成）seed
    if (rows.length) await tx.insert(schema.groupOptions).values(rows).onConflictDoNothing();
  });
}

/** 讀某組的選項（可選單一類型）；依 type 再 sortOrder 排 */
export async function getGroupOptions(groupId: string, type?: OptionType) {
  const where = type
    ? and(eq(schema.groupOptions.groupId, groupId), eq(schema.groupOptions.type, type))
    : eq(schema.groupOptions.groupId, groupId);
  return db
    .select()
    .from(schema.groupOptions)
    .where(where)
    .orderBy(schema.groupOptions.type, schema.groupOptions.sortOrder);
}
