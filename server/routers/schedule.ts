import { z } from "zod";
import { eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";
import {
  getScheduleItemChecked,
  listScheduleForGroup,
  scheduleWriteDenied,
  updateScheduleItemCore,
} from "../services/scheduleCore";
import { executeScheduleCommand } from "../services/scheduleCommand";
import { queueGroupSync } from "../services/googleCalendar";

/**
 * 排程（需求 10）：組行事曆（會議、交付死線…）。
 * Google 日曆整合＝OAuth 直連同步（services/googleCalendar：增刪改自動推送到已連結成員的
 * 專屬 Google 日曆＋每 15 分鐘對帳）；.ics 匯出（GET /api/schedule/:groupId/calendar.ics）保留為後備。
 */

/** ISO 字串 → Date（zod 驗證過再轉；壞值擋在輸入層） */
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "時間格式不正確");

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
    .mutation(({ ctx, input }) =>
      // Command：政策 schedule.create + 專案狀態機 write + addScheduleItemCore
      executeScheduleCommand({ auth: ctx.auth, source: "web", ...input }),
    ),

  update: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(120).optional(),
      startsAt: isoDate.optional(),
      endsAt: isoDate.nullable().optional(),
      note: z.string().max(500).nullable().optional(),
      ownerId: z.string().uuid().nullable().optional(),
      mentions: z.array(z.string().uuid()).max(20).optional(),
    }))
    .mutation(({ ctx, input }) => updateScheduleItemCore({ auth: ctx.auth, ...input })),

  /** 刪除：建立者本人或組長以上 */
  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    const row = await getScheduleItemChecked(ctx.auth, input.id);
    const role = requireGroup(ctx.auth, row.groupId);
    if (scheduleWriteDenied(row.createdBy, ctx.auth.user.id, role)) {
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
export function buildIcs(groupName: string, items: Array<{ id: string; title: string; startsAt: Date; endsAt: Date | null; note: string | null; allDayDate?: string }>): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  // 全天事件（修 R3-ICS-01）：純日期欄位應以 VALUE=DATE 輸出，不帶時間/時區——任何時區的訂閱者都顯示為該日全天，
  // 不再被合成成 09:00Z 定時事件（UTC-10 以西甚至落到前一天）。DTEND 取隔日（iCalendar 全天事件 DTEND 為排他）。
  const dateOnly = (ymd: string) => ymd.replace(/-/g, "");
  const nextDay = (ymd: string) => {
    const d = new Date(ymd + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10).replace(/-/g, "");
  };
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
    const dtLines =
      it.allDayDate && /^\d{4}-\d{2}-\d{2}$/.test(it.allDayDate)
        ? [`DTSTART;VALUE=DATE:${dateOnly(it.allDayDate)}`, `DTEND;VALUE=DATE:${nextDay(it.allDayDate)}`]
        : [`DTSTART:${fmt(it.startsAt)}`, `DTEND:${fmt(it.endsAt ?? new Date(it.startsAt.getTime() + 60 * 60 * 1000))}`];
    lines.push(
      "BEGIN:VEVENT",
      `UID:${it.id}@aidirector-os`,
      `DTSTAMP:${stamp}`,
      ...dtLines,
      `SUMMARY:${esc(it.title)}`,
      ...(it.note ? [`DESCRIPTION:${esc(it.note)}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n");
}
