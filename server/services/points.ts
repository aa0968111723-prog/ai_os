/**
 * 點數帳本與額度守門（成本管理是 5,000 元預算的守門員）。
 * 1 點 ≈ NT$1。先扣預估 → 完成對實際 → 失敗全額退回。
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db";

export const TOTAL_BUDGET = Number(process.env.TOTAL_BUDGET_POINTS ?? 5000);
export const WEEKLY_QUOTA_PER_USER = Number(process.env.WEEKLY_QUOTA_POINTS ?? 300);

function weekStart(): Date {
  const now = new Date();
  const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // 週一起算
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function usedTotal(): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
    .from(schema.costLedger);
  return Number(row?.used ?? 0);
}

export async function usedThisWeek(userId: string): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
    .from(schema.costLedger)
    .where(and(eq(schema.costLedger.userId, userId), gte(schema.costLedger.createdAt, weekStart())));
  return Number(row?.used ?? 0);
}

/** 額度檢查：超支保護（預設開）。回傳 null=可扣，字串=拒絕原因 */
export async function checkQuota(userId: string, points: number): Promise<string | null> {
  const [total, weekly] = await Promise.all([usedTotal(), usedThisWeek(userId)]);
  if (total + points > TOTAL_BUDGET) return `總預算不足（已用 ${total}／${TOTAL_BUDGET} 點）`;
  if (weekly + points > WEEKLY_QUOTA_PER_USER) return `本週額度不足（已用 ${weekly}／${WEEKLY_QUOTA_PER_USER} 點）`;
  return null;
}

export async function deduct(userId: string, groupId: string, points: number, reason: string, generationId?: string): Promise<void> {
  await db.insert(schema.costLedger).values({ userId, groupId, delta: -points, reason, generationId });
}

export async function refund(userId: string, groupId: string, points: number, reason: string, generationId?: string): Promise<void> {
  await db.insert(schema.costLedger).values({ userId, groupId, delta: points, reason, generationId });
}
