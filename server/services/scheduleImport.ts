/**
 * .ics 匯入核心：讓組代理與 UI 都能把外部日曆檔寫進組排程。
 *
 * 設計原則：
 * - 不引入新依賴：手寫最小 VEVENT 解析，覆蓋 Google / Apple 常見匯出。
 * - 去重：優先比對 UID；沒有 UID 時用「標題 + 開始時間（1 分鐘內）」判斷。
 * - 不改既有 addScheduleItemCore 行為，只批量呼叫它。
 * - v1 不展開 RRULE（重複行程先當成單筆；後續可擴充）。
 */

import { and, eq, gte, lte } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import type { AuthState } from "./auth";
import { requireGroup } from "../trpc";
import { addScheduleItemCore, type ScheduleRow } from "./scheduleCore";

export type ParsedIcsEvent = {
  uid?: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  note?: string;
  allDay?: boolean;
};

export type ImportIcsResult = {
  imported: number;
  skipped: number;
  errors: string[];
  items: ScheduleRow[];
};

/** 解開 ICS 跳脫字元 */
function unescapeIcs(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

/** 把 DTSTART / DTEND 轉成 Date。支援 VALUE=DATE 與基本 UTC (Z)。 */
function parseIcsDate(raw: string, params: string): { date: Date; allDay: boolean } | null {
  const isDateOnly = /VALUE=DATE/i.test(params) || /^\d{8}$/.test(raw);
  if (isDateOnly) {
    const y = raw.slice(0, 4);
    const m = raw.slice(4, 6);
    const d = raw.slice(6, 8);
    if (!y || !m || !d) return null;
    // 全天：用當天 00:00 UTC 作為 startsAt，endsAt 由呼叫端決定
    const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) return null;
    return { date, allDay: true };
  }
  // 基本形式：20260914T015300Z 或 20260914T015300
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? "Z" : ""}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { date, allDay: false };
}

/**
 * 最小 VEVENT 解析器。
 * 只處理單層 BEGIN:VEVENT … END:VEVENT，忽略 VTIMEZONE / RRULE 展開。
 */
export function parseIcsToEvents(icsText: string): ParsedIcsEvent[] {
  if (!icsText || typeof icsText !== "string") return [];

  // 還原行折疊（RFC 5545）：CRLF + 空白/Tab 開頭的續行併回上一行
  const unfolded = icsText.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  const events: ParsedIcsEvent[] = [];
  let inEvent = false;
  let cur: {
    uid?: string;
    summary?: string;
    description?: string;
    dtstart?: { date: Date; allDay: boolean };
    dtend?: { date: Date; allDay: boolean };
  } = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.toUpperCase() === "BEGIN:VEVENT") {
      inEvent = true;
      cur = {};
      continue;
    }
    if (trimmed.toUpperCase() === "END:VEVENT") {
      if (inEvent && cur.summary && cur.dtstart) {
        const title = unescapeIcs(cur.summary).trim().slice(0, 120);
        if (title) {
          let endsAt: Date | null = cur.dtend?.date ?? null;
          if (cur.dtstart.allDay && !endsAt) {
            // 全天預設隔日 00:00（排他）
            endsAt = new Date(cur.dtstart.date.getTime() + 24 * 60 * 60 * 1000);
          }
          events.push({
            uid: cur.uid,
            title,
            startsAt: cur.dtstart.date,
            endsAt,
            note: cur.description ? unescapeIcs(cur.description).trim().slice(0, 500) : undefined,
            allDay: cur.dtstart.allDay,
          });
        }
      }
      inEvent = false;
      cur = {};
      continue;
    }
    if (!inEvent) continue;

    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    const left = trimmed.slice(0, colon);
    const value = trimmed.slice(colon + 1);
    const [name, ...paramParts] = left.split(";");
    const params = paramParts.join(";");
    const key = name.toUpperCase();

    if (key === "UID") cur.uid = value.trim();
    else if (key === "SUMMARY") cur.summary = value;
    else if (key === "DESCRIPTION") cur.description = value;
    else if (key === "DTSTART") {
      const parsed = parseIcsDate(value.trim(), params);
      if (parsed) cur.dtstart = parsed;
    } else if (key === "DTEND") {
      const parsed = parseIcsDate(value.trim(), params);
      if (parsed) cur.dtend = parsed;
    }
  }

  return events;
}

/**
 * 把解析後的事件寫入組排程，自動去重。
 */
export async function importIcsEvents(input: {
  auth: AuthState;
  groupId: string;
  icsContent: string;
  defaultProjectId?: string | null;
  source?: string;
}): Promise<ImportIcsResult> {
  const { auth, groupId, icsContent, defaultProjectId } = input;
  requireGroup(auth, groupId);

  const parsed = parseIcsToEvents(icsContent);
  if (parsed.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "日曆檔裡找不到可匯入的行程（需要至少一個含標題與開始時間的 VEVENT）",
    });
  }

  // 限制單次匯入量，避免一次塞爆
  if (parsed.length > 200) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "單次最多匯入 200 筆行程，請拆檔後再試",
    });
  }

  const result: ImportIcsResult = { imported: 0, skipped: 0, errors: [], items: [] };

  for (const ev of parsed) {
    try {
      // 去重：先找近 1 分鐘內同標題的既有行程
      const windowStart = new Date(ev.startsAt.getTime() - 60 * 1000);
      const windowEnd = new Date(ev.startsAt.getTime() + 60 * 1000);
      const existing = await db
        .select({ id: schema.scheduleItems.id, title: schema.scheduleItems.title })
        .from(schema.scheduleItems)
        .where(
          and(
            eq(schema.scheduleItems.groupId, groupId),
            eq(schema.scheduleItems.title, ev.title),
            gte(schema.scheduleItems.startsAt, windowStart),
            lte(schema.scheduleItems.startsAt, windowEnd),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        result.skipped += 1;
        continue;
      }

      const row = await addScheduleItemCore({
        auth,
        groupId,
        projectId: defaultProjectId ?? null,
        title: ev.title,
        startsAt: ev.startsAt.toISOString(),
        endsAt: ev.endsAt ? ev.endsAt.toISOString() : null,
        note: (() => {
          // 備註上限 500（與 addScheduleItemCore / router 一致）；UID 附註不可撐破
          const uidTag = ev.uid ? `[ICS UID: ${ev.uid}]` : "";
          const body = (ev.note ?? "").trim();
          if (!body && !uidTag) return null;
          if (!body) return uidTag.slice(0, 500);
          if (!uidTag) return body.slice(0, 500);
          const combined = `${body}\n\n${uidTag}`;
          return combined.length <= 500 ? combined : body.slice(0, 500);
        })(),
      });
      result.imported += 1;
      result.items.push(row);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`「${ev.title}」：${msg}`);
    }
  }

  return result;
}
