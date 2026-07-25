/**
 * 排程核心積木（自 routers/schedule.ts 抽出，行為不變）：
 * 讓 tRPC 路由與「tRPC 之外的入口」（MCP 介面）共用同一批守門（組隔離、專案／留言歸屬校驗、
 * @提及校驗、時間合法性）——與 generationCore／agentCore 同一設計理由，防護不分岔。
 */
import { and, asc, eq, gt, gte, isNull, lte, or, type SQL } from "drizzle-orm";
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

/** 排程清單單頁上限：超過以 truncated 明示（QA-017：不再靜默截斷讓使用者以為只有這些） */
const SCHEDULE_LIST_LIMIT = 300;

export interface ScheduleListItem {
  id: string; projectId: string | null; title: string; startsAt: Date; endsAt: Date | null;
  note: string | null; ownerId: string | null; ownerName: string | null; createdBy: string;
  sourceMessageId: string | null; mentions: string[] | null;
}

/**
 * 清單（組行事曆）：預設只回「未來與最近 24 小時內」；includePast 回全部。startsAt 升冪。
 * 帶負責人名稱（owner join）。呼叫端先 requireGroup（此處也再保險擋一次）。
 *
 * 回 { items, truncated }（QA-017）：多取一筆探測——超過單頁上限時 truncated=true，
 * 呼叫端（UI/MCP）必須把「還有更多未顯示」讓使用者看見，不得默默當成全部。
 * range（可選，供月曆／知識地圖用）：以 startsAt 明確界定 [from, to] 視窗；給了 from 就以它為下界
 * （覆蓋 includePast 的預設 24h 下界），月曆翻到任一月份都拿得到「那個月」的行程（稽核 #2／#5）。
 */
export async function listScheduleForGroup(
  auth: AuthState,
  groupId: string,
  includePast = false,
  projectId?: string | null,
  range?: { from?: Date; to?: Date },
): Promise<{ items: ScheduleListItem[]; truncated: boolean }> {
  requireGroup(auth, groupId);
  const conds: SQL[] = [eq(schema.scheduleItems.groupId, groupId)];
  if (range?.from) {
    // range.from 明確下界（月曆／知識地圖）：覆蓋 includePast 的預設 24h 下界
    conds.push(gte(schema.scheduleItems.startsAt, range.from));
  } else if (!includePast) {
    // overlap 條件（QA-017）：不能只看 startsAt——開始超過 24 小時前、但「還沒結束」的長行程
    //（跨日會議、多日營隊）也必須出現。判準：startsAt 在窗內，或 endsAt 還在未來（仍進行中）。
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    conds.push(or(gte(schema.scheduleItems.startsAt, cutoff), gt(schema.scheduleItems.endsAt, new Date()))!);
  }
  if (range?.to) conds.push(lte(schema.scheduleItems.startsAt, range.to));
  // 專案視角：只回該專案的行程＋整組共用（未掛專案）的行程，避免單頁上限被別的專案吃掉。
  if (projectId) conds.push(or(eq(schema.scheduleItems.projectId, projectId), isNull(schema.scheduleItems.projectId))!);
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
      sourceMessageId: schema.scheduleItems.sourceMessageId,
      mentions: schema.scheduleItems.mentions,
    })
    .from(schema.scheduleItems)
    .leftJoin(schema.users, eq(schema.users.id, schema.scheduleItems.ownerId))
    .where(and(...conds))
    .orderBy(asc(schema.scheduleItems.startsAt))
    .limit(SCHEDULE_LIST_LIMIT + 1);
  const truncated = rows.length > SCHEDULE_LIST_LIMIT;
  return { items: truncated ? rows.slice(0, SCHEDULE_LIST_LIMIT) : rows, truncated };
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
  // 修 R5-IDOR-01：負責人必須是本組成員——原本 ownerId 直接落庫，可把組行程負責人指派給組外/別團隊任意使用者
  // 並經 owner join 洩漏其顯示名稱。與 projectId/sourceMessageId/mentions 同一歸屬校驗口徑。
  if (input.ownerId) {
    const [om] = await db
      .select({ id: schema.groupMembers.id })
      .from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.groupId, input.groupId), eq(schema.groupMembers.userId, input.ownerId)))
      .limit(1);
    if (!om) throw new TRPCError({ code: "BAD_REQUEST", message: "負責人必須是本組成員" });
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
