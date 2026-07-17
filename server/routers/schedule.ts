import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { addScheduleItemCore, listScheduleForGroup } from "../services/scheduleCore";

/**
 * 排程（需求 10）：組行事曆（會議、交付死線…）。
 * Google 日曆整合以 .ics 匯出達成（GET /api/schedule/:groupId/calendar.ics，見 server/index.ts）
 * ——不做 OAuth 雙向同步（成本/價值評估見優化評估報告）。
 */

/** ISO 字串 → Date（zod 驗證過再轉；壞值擋在輸入層） */
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "時間格式不正確");

async function getItemChecked(auth: Parameters<typeof requireGroup>[0], id: string) {
  const [row] = await db.select().from(schema.scheduleItems).where(eq(schema.scheduleItems.id, id));
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "找不到這筆行程" });
  requireGroup(auth, row.groupId);
  return row;
}

export const scheduleRouter = router({
  /**
   * 清單：預設只回「未來與最近 24 小時內」；includePast 回全部。startsAt 升冪。
   * from/to（ISO 字串，可選）：以 startsAt 界定視窗——月曆翻月／知識地圖用它把查詢綁在
   * 可見範圍內，避免 asc+limit(300) 在忙碌組別悄悄截掉未來行程。
   */
  list: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      includePast: z.boolean().optional(),
      from: isoDate.optional(),
      to: isoDate.optional(),
    }))
    .query(({ ctx, input }) =>
      listScheduleForGroup(ctx.auth, input.groupId, input.includePast ?? false, undefined, {
        from: input.from ? new Date(input.from) : undefined,
        to: input.to ? new Date(input.to) : undefined,
      }),
    ),

  add: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      title: z.string().min(1, "請填標題").max(120),
      startsAt: isoDate,
      endsAt: isoDate.optional(),
      note: z.string().max(500).optional(),
      ownerId: z.string().uuid().optional(),
      // 由留言「轉待辦」建立時帶來源留言 id（供 Planner 反向跳回）；@提及同組成員
      sourceMessageId: z.string().uuid().optional(),
      mentions: z.array(z.string().uuid()).max(20).optional(),
    }))
    .mutation(({ ctx, input }) => addScheduleItemCore({ auth: ctx.auth, ...input })),

  update: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(120).optional(),
      startsAt: isoDate.optional(),
      endsAt: isoDate.nullable().optional(),
      note: z.string().max(500).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const row = await getItemChecked(ctx.auth, input.id);
      const patch: Partial<typeof schema.scheduleItems.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title.trim();
      if (input.startsAt !== undefined) patch.startsAt = new Date(input.startsAt);
      if (input.endsAt !== undefined) patch.endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (input.note !== undefined) patch.note = input.note?.trim() || null;
      const startsAt = patch.startsAt ?? row.startsAt;
      const endsAt = patch.endsAt === undefined ? row.endsAt : patch.endsAt;
      if (endsAt && endsAt <= startsAt) throw new TRPCError({ code: "BAD_REQUEST", message: "結束時間要在開始之後" });
      if (Object.keys(patch).length === 0) return row;
      const [updated] = await db.update(schema.scheduleItems).set(patch).where(eq(schema.scheduleItems.id, row.id)).returning();
      return updated;
    }),

  /** 刪除：建立者本人或組長以上 */
  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const row = await getItemChecked(ctx.auth, input.id);
    const role = requireGroup(ctx.auth, row.groupId);
    if (row.createdBy !== ctx.auth.user.id && role === "member") {
      throw new TRPCError({ code: "FORBIDDEN", message: "只有建立者本人或組長以上可以刪除行程" });
    }
    await db.delete(schema.scheduleItems).where(eq(schema.scheduleItems.id, row.id));
    return { ok: true };
  }),
});

/**
 * RFC 5545 §3.1 內容行折疊：一行以 75 octet 為界，超過就插入 CRLF＋一個空格續行。
 * 中文（CJK）在 UTF-8 是 3 bytes/字，120 字標題的 SUMMARY 行約 360 octet、500 字備註的
 * DESCRIPTION 行約 1500 octet，遠超上限——不折疊的話 Outlook 等嚴格解析器會靜默丟棄整個事件
 * （稽核缺陷 #3）。折疊一律以「UTF-8 位元組邊界」切，續行 byte（0b10xxxxxx）不可被切斷，
 * 否則多位元組字被腰斬成亂碼。
 */
export function foldIcsLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  let limit = 75; // 首行 75 octet；續行有一個前導空格，實際內容上限 74 octet（前導空格佔 1）
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // 不切在多位元組字中間：續行 byte 形如 10xxxxxx（0x80–0xBF），往回退到字元邊界
    if (end < bytes.length) {
      while (end > start && (bytes[end] & 0xc0) === 0x80) end--;
    }
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
    limit = 74;
  }
  return parts.join("\r\n ");
}

/**
 * .ics（iCalendar）內容產生：供 server/index.ts 的匯出端點使用。
 * 極簡 VCALENDAR/VEVENT：UTC 時間（Z 結尾）、UID=id@aidirector-os、無結束時間以 1 小時計;
 * 文字欄位跳脫（\ ; , 換行）後再逐行折疊至 75 octet。匯入 Google 日曆/Apple/Outlook 皆可讀。
 */
export function buildIcs(groupName: string, items: Array<{ id: string; title: string; startsAt: Date; endsAt: Date | null; note: string | null }>): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  // 換行一律轉義：CRLF、單獨 CR、單獨 LF 都要處理——單獨 \r 若漏掉，某些 iCalendar 解析器會把它
  // 當成行邊界，讓欄位值裡的 "\rSUMMARY:..." 被當成偽造屬性注入（ICS injection）。
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Director OS//schedule//ZH-TW",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${esc(`${groupName}・組排程`)}`,
  ];
  const stamp = fmt(new Date());
  for (const it of items) {
    const end = it.endsAt ?? new Date(it.startsAt.getTime() + 60 * 60 * 1000);
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.id}@aidirector-os`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${fmt(it.startsAt)}`,
      `DTEND:${fmt(end)}`,
      `SUMMARY:${esc(it.title)}`,
      ...(it.note ? [`DESCRIPTION:${esc(it.note)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  // 每一行（含結構行與屬性行）都過折疊；結構行短，折疊為 no-op；長的 CJK 屬性行才真正被折。
  return lines.map(foldIcsLine).join("\r\n");
}
