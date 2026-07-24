/**
 * 排程核心積木（自 routers/schedule.ts 抽出，行為不變）：
 * 讓 tRPC 路由與「tRPC 之外的入口」（MCP 介面）共用同一批守門（組隔離、專案／留言歸屬校驗、
 * @提及校驗、時間合法性）——與 generationCore／agentCore 同一設計理由，防護不分岔。
 */
import { and, asc, eq, gte, isNull, or, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db, schema } from "../db";
import { requireGroup } from "../trpc";
import type { AuthState } from "./auth";
import { assertProjectNotArchived } from "./projectAcl";
import { validateMentions } from "./mentions";
import { queueGroupSync } from "./googleCalendar";

export type ScheduleRow = typeof schema.scheduleItems.$inferSelect;

function parseDate(s: string, label: string): Date {
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new TRPCError({ code: "BAD_REQUEST", message: `${label}時間格式不正確` });
  return new Date(t);
}

/**
 * 清單（組行事曆）：預設只回「未來與最近 24 小時內」；includePast 回全部。startsAt 升冪。
 * 帶負責人名稱（owner join）。呼叫端先 requireGroup（此處也再保險擋一次）。
 */
export async function listScheduleForGroup(
  auth: AuthState,
  groupId: string,
  includePast = false,
  projectId?: string | null,
): Promise<Array<{
  id: string; projectId: string | null; title: string; startsAt: Date; endsAt: Date | null;
  note: string | null; ownerId: string | null; ownerName: string | null; createdBy: string;
  sourceMessageId: string | null; mentions: string[] | null;
}>> {
  requireGroup(auth, groupId);
  const conds: SQL[] = [eq(schema.scheduleItems.groupId, groupId)];
  if (!includePast) conds.push(gte(schema.scheduleItems.startsAt, new Date(Date.now() - 24 * 60 * 60 * 1000)));
  // 專案視角：只回該專案的行程＋整組共用（未掛專案）的行程，避免 300 筆上限被別的專案吃掉。
  if (projectId) conds.push(or(eq(schema.scheduleItems.projectId, projectId), isNull(schema.scheduleItems.projectId))!);
  return db
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
      sourceMessageId: schema.scheduleItems.sourceMessageId,
      mentions: schema.scheduleItems.mentions,
    })
    .from(schema.scheduleItems)
    .leftJoin(schema.users, eq(schema.users.id, schema.scheduleItems.ownerId))
    .where(and(...conds))
    .orderBy(asc(schema.scheduleItems.startsAt))
    .limit(300);
}

/**
 * 新增一筆行程（會議／交付死線…）。時間收 ISO 字串、核心內解析＋校驗，兩端（tRPC／MCP）一致。
 * 校驗：專案／來源留言須屬同組、結束須晚於開始、@提及須同組成員。
 */
export async function addScheduleItemCore(input: {
  auth: AuthState;
  groupId: string;
  projectId?: string | null;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  note?: string | null;
  ownerId?: string | null;
  sourceMessageId?: string | null;
  mentions?: string[];
}): Promise<ScheduleRow> {
  const { auth } = input;
  requireGroup(auth, input.groupId);
  // 傳輸無關的輸入守門（MCP add_schedule_item 直呼本核心，繞過 router 的 zod）：與 router 同上限
  const title = input.title.trim();
  if (!title) throw new TRPCError({ code: "BAD_REQUEST", message: "請填標題" });
  if (title.length > 120) throw new TRPCError({ code: "BAD_REQUEST", message: "標題太長（最多 120 字）" });
  const note = input.note?.trim() || null;
  if (note && note.length > 500) throw new TRPCError({ code: "BAD_REQUEST", message: "備註太長（最多 500 字）" });

  if (input.projectId) {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId));
    if (!project || project.groupId !== input.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "專案不存在或不屬於此組" });
    assertProjectNotArchived(project); // 封存專案不接受新排程（MCP 舊 projectId 亦擋）
  }
  if (input.sourceMessageId) {
    const [m] = await db.select({ groupId: schema.messages.groupId }).from(schema.messages).where(eq(schema.messages.id, input.sourceMessageId));
    if (!m || m.groupId !== input.groupId) throw new TRPCError({ code: "BAD_REQUEST", message: "來源留言不屬於此組" });
  }
  const mentions = await validateMentions(input.groupId, input.mentions);
  const startsAt = parseDate(input.startsAt, "開始");
  const endsAt = input.endsAt ? parseDate(input.endsAt, "結束") : null;
  if (endsAt && endsAt <= startsAt) throw new TRPCError({ code: "BAD_REQUEST", message: "結束時間要在開始之後" });

  const [row] = await db
    .insert(schema.scheduleItems)
    .values({
      groupId: input.groupId,
      projectId: input.projectId ?? null,
      title,
      startsAt,
      endsAt,
      note,
      ownerId: input.ownerId ?? null,
      createdBy: auth.user.id,
      sourceMessageId: input.sourceMessageId ?? null,
      mentions: mentions ?? null,
    })
    .returning();
  queueGroupSync(input.groupId); // Google 日曆直連同步：把該組已連結成員的個人日曆排進推送佇列（fire-and-forget）
  return row;
}
