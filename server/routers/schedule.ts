import { z } from "zod";
import { router, authedProcedure } from "../trpc";
import {
  getScheduleItemChecked,
  listScheduleForGroup,
  updateScheduleItemCore,
  removeScheduleItemCore,
} from "../services/scheduleCore";
import { executeScheduleCommand } from "../services/scheduleCommand";
import { importIcsEvents } from "../services/scheduleImport";

/**
 * 排程（需求 10）：組行事曆（會議、交付死線…）。
 * Google 日曆整合＝OAuth 直連同步（services/googleCalendar：增刪改自動推送到已連結成員的
 * 專屬 Google 日曆＋每 15 分鐘對帳）；.ics 匯出（GET /api/schedule/:groupId/calendar.ics）保留為後備。
 * .ics 匯入：schedule.importIcs（組代理與 UI 皆可呼叫）。
 *
 * 備註標注代辦（v1）：在 note 前加上「[代辦] 」前綴即可在列表／月曆顯示代辦標籤；
 * 後續可升格為正式 isTodo 欄位或連結人類任務。
 */

/** ISO 字串 → Date（zod 驗證過再轉；壞值擋在輸入層） */
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "時間格式不正確");

/** 代辦前綴（備註標注代辦 v1 約定） */
export const TODO_NOTE_PREFIX = "[代辦] ";

export function isTodoNote(note: string | null | undefined): boolean {
  return !!note && note.startsWith(TODO_NOTE_PREFIX);
}

export function withTodoPrefix(note: string | null | undefined, asTodo: boolean): string | null {
  const body = (note ?? "").replace(/^\[代辦\]\s*/, "").trim();
  if (asTodo) return body ? `${TODO_NOTE_PREFIX}${body}` : TODO_NOTE_PREFIX.trimEnd();
  return body || null;
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
      /** 標為代辦：在備註前加上 [代辦] 前綴，列表與月曆可顯示代辦標籤 */
      isTodo: z.boolean().optional(),
      ownerId: z.string().uuid().optional(),
      // 由留言「轉待辦」建立時帶來源留言 id（供 Planner 反向跳回）；@提及同組成員
      sourceMessageId: z.string().uuid().optional(),
      mentions: z.array(z.string().uuid()).max(20).optional(),
    }))
    .mutation(({ ctx, input }) => {
      const { isTodo, note, ...rest } = input;
      const finalNote = withTodoPrefix(note, !!isTodo) ?? undefined;
      return executeScheduleCommand({
        auth: ctx.auth,
        source: "web",
        ...rest,
        note: finalNote,
      });
    }),

  /**
   * 匯入 .ics 日曆檔到組排程。
   * 供 UI「匯入 .ics」按鈕與組代理（agents.step.import_calendar）使用。
   * 解析 VEVENT → 去重（標題＋開始時間 1 分鐘內）→ 批量寫入。
   */
  importIcs: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      icsContent: z.string().min(20, "日曆內容太短，請確認是完整的 .ics 檔").max(2_000_000),
      defaultProjectId: z.string().uuid().optional(),
    }))
    .mutation(({ ctx, input }) =>
      importIcsEvents({
        auth: ctx.auth,
        groupId: input.groupId,
        icsContent: input.icsContent,
        defaultProjectId: input.defaultProjectId ?? null,
        source: "web",
      }),
    ),

  update: authedProcedure
    .input(z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(120).optional(),
      startsAt: isoDate.optional(),
      endsAt: isoDate.nullable().optional(),
      note: z.string().max(500).nullable().optional(),
      /** 更新時可切換代辦標注 */
      isTodo: z.boolean().optional(),
      ownerId: z.string().uuid().nullable().optional(),
      mentions: z.array(z.string().uuid()).max(20).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { isTodo, note, ...rest } = input;
      let finalNote = note;
      if (isTodo !== undefined) {
        // 若有傳 isTodo，以它為準重新套用前綴；若同時有 note 則用新 note，否則讀現有
        let base = note;
        if (base === undefined) {
          const row = await getScheduleItemChecked(ctx.auth, input.id);
          base = row.note;
        }
        finalNote = withTodoPrefix(base, isTodo);
      }
      return updateScheduleItemCore({
        auth: ctx.auth,
        ...rest,
        note: finalNote,
      });
    }),

  /** 刪除：建立者本人或組長以上；專案綁定行程另擋檢視者／封存 */
  remove: authedProcedure.input(z.object({ id: z.string().uuid() })).mutation(async ({ ctx, input }) => {
    return removeScheduleItemCore(ctx.auth, input.id);
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
 * 文字欄位跳脫（\\ ; , 換行）＋ 75-octet 行折疊（RFC 5545）。匯入 Google 日曆/Apple 行事曆皆可讀。
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
  // 換行一律轉義：CRLF、單獨 CR、單獨 LF 都要處理——單獨 \\r 若漏掉，某些 iCalendar 解析器會把它
  // 當成行邊界，讓欄位值裡的 "\\rSUMMARY:..." 被當成偽造屬性注入（ICS injection）。
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
