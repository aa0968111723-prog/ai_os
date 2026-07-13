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
 * group_options 沒有 DB unique constraint（開機卡死修復拿掉了），防重複全靠旗標：
 * 交易內先「搶旗標」（conditional update），搶到的那個請求才插種子——
 * 併發首讀時輸家的 update 會等贏家 commit、看到旗標已立即放棄，不會重複 seed。
 */
export async function ensureGroupOptions(groupId: string): Promise<void> {
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
    if (!claimed.length) return;
    if (rows.length) await tx.insert(schema.groupOptions).values(rows);
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
