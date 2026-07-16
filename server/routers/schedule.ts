import { z } from "zod";
import { and, asc, eq, gte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { router, authedProcedure, requireGroup } from "../trpc";
import { db, schema } from "../db";

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
  /** 清單：預設只回「未來與最近 24 小時內」；includePast 回全部。startsAt 升冪。 */
  list: authedProcedure
    .input(z.object({ groupId: z.string().uuid(), includePast: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      const conds = [eq(schema.scheduleItems.groupId, input.groupId)];
      if (!input.includePast) conds.push(gte(schema.scheduleItems.startsAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
      const rows = await db
        .select({
          id: schema.scheduleItems.id,
          projectId: schema.scheduleItems.projectId,
          title: schema.scheduleItems.title,
          startsAt: schema.scheduleItems.startsAt,
          endsAt: schema.scheduleItems.endsAt,
          note: schema.scheduleItems.note,
          ownerId: schema.scheduleItems.ownerId,
          ownerName: schema.users.name,
          createdBy: schema.scheduleItems.createdBy,
        })
        .from(schema.scheduleItems)
        .leftJoin(schema.users, eq(schema.users.id, schema.scheduleItems.ownerId))
        .where(and(...conds))
        .orderBy(asc(schema.scheduleItems.startsAt))
        .limit(300);
      return rows;
    }),

  add: authedProcedure
    .input(z.object({
      groupId: z.string().uuid(),
      projectId: z.string().uuid().optional(),
      title: z.string().min(1, "請填標題").max(120),
      startsAt: isoDate,
      endsAt: isoDate.optional(),
      note: z.string().max(500).optional(),
      ownerId: z.string().uuid().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      requireGroup(ctx.auth, input.groupId);
      if (input.projectId) {
        const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
        if (!project || project.groupId !== input.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
      }
      const startsAt = new Date(input.startsAt);
      const endsAt = input.endsAt ? new Date(input.endsAt) : null;
      if (endsAt && endsAt <= startsAt) throw new TRPCError({ code: "BAD_REQUEST", message: "結束時間要在開始之後" });
      const [row] = await db
        .insert(schema.scheduleItems)
        .values({
          groupId: input.groupId,
          projectId: input.projectId ?? null,
          title: input.title.trim(),
          startsAt,
          endsAt,
          note: input.note?.trim() || null,
          ownerId: input.ownerId ?? null,
          createdBy: ctx.auth.user.id,
        })
        .returning();
      return row;
    }),

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
 * .ics（iCalendar）內容產生：供 server/index.ts 的匯出端點使用。
 * 極簡 VCALENDAR/VEVENT：UTC 時間（Z 結尾）、UID=id@aidirector-os、無結束時間以 1 小時計;
 * 文字欄位跳脫（\ ; , 換行）。匯入 Google 日曆/Apple 行事曆皆可讀。
 */
export function buildIcs(groupName: string, items: Array<{ id: string; title: string; startsAt: Date; endsAt: Date | null; note: string | null }>): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
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
  return lines.join("\r\n");
}
