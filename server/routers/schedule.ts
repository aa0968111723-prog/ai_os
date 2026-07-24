import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import { addScheduleItemCore, listScheduleForGroup } from "../services/scheduleCore";
import { queueGroupSync } from "../services/googleCalendar";

/**
 * 排程（需求 10）：組行事曆（會議、交付死線…）。
 * Google 日曆整合＝OAuth 直連同步（services/googleCalendar：增刪改自動推送到已連結成員的
 * 專屬 Google 日曆＋每 15 分鐘對帳）；.ics 匯出（GET /api/schedule/:groupId/calendar.ics）保留為後備。
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
      // 與 remove 同守衛：只有建立者本人或組長以上可改——否則一般組員可竄改他人（含組長）建立的組行程
      const role = requireGroup(ctx.auth, row.groupId);
      if (row.createdBy !== ctx.auth.user.id && role === "member") {
        throw new TRPCError({ code: "FORBIDDEN", message: "只有建立者本人或組長以上可以修改行程" });
      }
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
      queueGroupSync(row.groupId);
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
    queueGroupSync(row.groupId);
    return { ok: true };
  }),
});

/**
 * RFC 5545 3.1 行折疊：內容行超過 75 octets（UTF-8 位元組）要折行，續行以 CRLF+空格開頭。
 * 以「位元組」而非字元計——中文一字 3 bytes，且不可把多位元組字元從中切斷（逐字元累計位元組數）。
 * 匯出前逐行套用；解析器會把 CRLF+WSP 還原成原始行。
 */
export function foldIcsLine(line: string): string {
  const MAX_OCTETS = 75;
  if (Buffer.byteLength(line, "utf8") <= MAX_OCTETS) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  // 續行首的空格佔 1 octet，續行內容上限為 74——首行仍可用滿 75
  let limit = MAX_OCTETS;
  for (const ch of line) {
    const chBytes = Buffer.byteLength(ch, "utf8");
    if (curBytes + chBytes > limit) {
      out.push(cur);
      cur = "";
      curBytes = 0;
      limit = MAX_OCTETS - 1;
    }
    cur += ch;
    curBytes += chBytes;
  }
  if (cur) out.push(cur);
  return out.map((seg, i) => (i === 0 ? seg : " " + seg)).join("\r\n");
}

/**
 * .ics（iCalendar）內容產生：供 server/index.ts 的匯出端點使用。
 * 極簡 VCALENDAR/VEVENT：UTC 時間（Z 結尾）、UID=id@aidirector-os、無結束時間以 1 小時計;
 * 文字欄位跳脫（\ ; , 換行）＋ 75-octet 行折疊（RFC 5545）。匯入 Google 日曆/Apple 行事曆皆可讀。
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
  return lines.map(foldIcsLine).join("\r\n");
}
