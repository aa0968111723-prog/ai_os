/**
 * 彈性點數制（定案：不鎖死，組長/管理員可調）。
 * - 全域設定存 DB（settings 單列），管理員隨時改；null/0＝不限。
 * - 額度層級：個人覆寫 → 組設定 → 全域預設；一律空＝不限。
 * - 扣退模式不變：先扣預估、失敗全額退回（帳本可查）。
 */
import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "../db";

export interface PointsSettings {
  totalBudgetPoints: number | null;
  defaultWeeklyPoints: number | null;
}

/** 讀全域設定（無列則以環境預設建立：5000／300，之後全由管理員在系統內調） */
export async function getSettings(): Promise<PointsSettings> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "global"));
  if (row) return { totalBudgetPoints: row.totalBudgetPoints, defaultWeeklyPoints: row.defaultWeeklyPoints };
  const seeded = {
    totalBudgetPoints: Number(process.env.TOTAL_BUDGET_POINTS ?? 5000) || null,
    defaultWeeklyPoints: Number(process.env.WEEKLY_QUOTA_POINTS ?? 300) || null,
  };
  await db.insert(schema.settings).values({ key: "global", ...seeded }).onConflictDoNothing();
  return seeded;
}

export async function updateSettings(patch: Partial<PointsSettings>): Promise<PointsSettings> {
  await getSettings(); // 確保有列
  await db.update(schema.settings).set({ ...patch, updatedAt: new Date() }).where(eq(schema.settings.key, "global"));
  return getSettings();
}

const noLimit = (v: number | null | undefined): boolean => v == null || v <= 0;

function weekStart(): Date {
  const now = new Date();
  const day = now.getDay() === 0 ? 6 : now.getDay() - 1; // 週一起算
  const start = new Date(now);
  start.setDate(now.getDate() - day);
  start.setHours(0, 0, 0, 0);
  return start;
}

export async function usedTotal(): Promise<number> {
  const [row] = await db.select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` }).from(schema.costLedger);
  return Number(row?.used ?? 0);
}

export async function usedThisWeek(userId: string): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
    .from(schema.costLedger)
    .where(and(eq(schema.costLedger.userId, userId), gte(schema.costLedger.createdAt, weekStart())));
  return Number(row?.used ?? 0);
}

/** 個人生效週額度：個人覆寫 → 組設定 → 全域預設（null＝不限） */
export async function effectiveWeeklyQuota(userId: string, groupId: string): Promise<number | null> {
  const [member] = await db
    .select()
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)));
  if (member && member.weeklyPointsOverride != null) return noLimit(member.weeklyPointsOverride) ? null : member.weeklyPointsOverride;
  const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  if (group && group.weeklyPointsPerUser != null) return noLimit(group.weeklyPointsPerUser) ? null : group.weeklyPointsPerUser;
  const settings = await getSettings();
  return noLimit(settings.defaultWeeklyPoints) ? null : settings.defaultWeeklyPoints;
}

/** 額度守門：null=可扣；字串=拒絕原因 */
export async function checkQuota(userId: string, groupId: string, points: number): Promise<string | null> {
  const settings = await getSettings();
  if (!noLimit(settings.totalBudgetPoints)) {
    const total = await usedTotal();
    if (total + points > settings.totalBudgetPoints!) return `總預算不足（已用 ${total}／${settings.totalBudgetPoints} 點）——請管理員調整`;
  }
  const quota = await effectiveWeeklyQuota(userId, groupId);
  if (quota != null) {
    const weekly = await usedThisWeek(userId);
    if (weekly + points > quota) return `本週額度不足（已用 ${weekly}／${quota} 點）——可請組長調整`;
  }
  return null;
}

export async function deduct(userId: string, groupId: string, points: number, reason: string, generationId?: string): Promise<void> {
  await db.insert(schema.costLedger).values({ userId, groupId, delta: -points, reason, generationId });
}

/**
 * 原子「守門＋扣點」：在單一交易內先取得 per-user advisory lock，再重算額度、寫扣點列。
 * 解決 TOCTOU——舊版 checkQuota 與 deduct 之間無鎖，併發送出（連點、多分頁、tRPC batch）
 * 會各自通過檢查後雙重扣款，突破週額度與總預算（真實模式＝真金白銀的 fal 帳單）。
 * 回傳：null=已扣點成功；字串=被拒原因（未扣點）。
 */
export async function reserveQuota(
  userId: string,
  groupId: string,
  points: number,
  reason: string,
  generationId?: string,
): Promise<string | null> {
  // 關鍵：設定與額度「先在交易外」讀好——交易內不可再向連線池借第二條連線，
  // 否則交易已佔一條連線＋持有序列化鎖時再借連線，併發滿池會整池死鎖（需重啟才復原）。
  // 這兩者是穩定的組態/成員資料，非 TOCTOU 競態目標；真正要原子的只有「帳本 SUM＋扣點列」。
  const settings = await getSettings();
  const quota = await effectiveWeeklyQuota(userId, groupId);
  const budgetCapped = !noLimit(settings.totalBudgetPoints);

  return db.transaction(async (tx) => {
    // 同一使用者一律序列化（週額度）；只有在「有總預算上限」時才另上全域鎖串行化總預算，
    // 沒設總預算就不上全域鎖 → 不同使用者可完全併行、零額外爭用。
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 0)`);
    if (budgetCapped) {
      await tx.execute(sql`select pg_advisory_xact_lock(864205, 0)`); // 固定鍵：全域總預算閘
      const [t] = await tx
        .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
        .from(schema.costLedger);
      const total = Number(t?.used ?? 0);
      if (total + points > settings.totalBudgetPoints!) {
        return `總預算不足（已用 ${total}／${settings.totalBudgetPoints} 點）——請管理員調整`;
      }
    }
    if (quota != null) {
      const [w] = await tx
        .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
        .from(schema.costLedger)
        .where(and(eq(schema.costLedger.userId, userId), gte(schema.costLedger.createdAt, weekStart())));
      const weekly = Number(w?.used ?? 0);
      if (weekly + points > quota) {
        return `本週額度不足（已用 ${weekly}／${quota} 點）——可請組長調整`;
      }
    }
    await tx.insert(schema.costLedger).values({ userId, groupId, delta: -points, reason, generationId });
    return null;
  });
}

export async function refund(userId: string, groupId: string, points: number, reason: string, generationId?: string): Promise<void> {
  await db.insert(schema.costLedger).values({ userId, groupId, delta: points, reason, generationId });
}

/** 組用量彙總（組長/管理員儀表用）：每人本週＋累計 */
export async function groupUsage(groupId: string): Promise<Array<{ userId: string; weekly: number; total: number }>> {
  const rows = await db
    .select({
      userId: schema.costLedger.userId,
      weekly: sql<number>`coalesce(-sum(${schema.costLedger.delta}) filter (where ${schema.costLedger.createdAt} >= ${weekStart()}), 0)`,
      total: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)`,
    })
    .from(schema.costLedger)
    .where(eq(schema.costLedger.groupId, groupId))
    .groupBy(schema.costLedger.userId);
  return rows.map((r) => ({ userId: r.userId, weekly: Number(r.weekly), total: Number(r.total) }));
}
