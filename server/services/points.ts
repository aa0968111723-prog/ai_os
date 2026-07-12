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

/** 週界以台北時間（UTC+8，無夏令時）計算——Railway 容器預設 UTC，用本地 getDay/setHours 會把週界推到台北週一 08:00 */
function weekStart(): Date {
  const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;
  const tpe = new Date(Date.now() + TPE_OFFSET_MS); // 平移後用 UTC 欄位讀出的就是台北牆鐘時間
  const day = tpe.getUTCDay() === 0 ? 6 : tpe.getUTCDay() - 1; // 週一起算
  tpe.setUTCDate(tpe.getUTCDate() - day);
  tpe.setUTCHours(0, 0, 0, 0); // 台北週一 00:00
  return new Date(tpe.getTime() - TPE_OFFSET_MS); // 平移回真正的 UTC 時刻
}

export async function usedTotal(): Promise<number> {
  const [row] = await db.select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` }).from(schema.costLedger);
  return Number(row?.used ?? 0);
}

export async function usedThisWeek(userId: string): Promise<number> {
  // 週歸屬：退點列跟隨其生成的建立週（coalesce 回退帳本列自身時間），
  // 避免上週扣點、本週才失敗退點時，退點灌進新週把用量算成負值。
  const [row] = await db
    .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
    .from(schema.costLedger)
    .leftJoin(schema.generations, eq(schema.costLedger.generationId, schema.generations.id))
    .where(and(
      eq(schema.costLedger.userId, userId),
      gte(sql`coalesce(${schema.generations.createdAt}, ${schema.costLedger.createdAt})`, weekStart()),
    ));
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
      // 週歸屬同 usedThisWeek：退點跟隨生成建立週，守門與顯示口徑一致
      const [w] = await tx
        .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
        .from(schema.costLedger)
        .leftJoin(schema.generations, eq(schema.costLedger.generationId, schema.generations.id))
        .where(and(
          eq(schema.costLedger.userId, userId),
          gte(sql`coalesce(${schema.generations.createdAt}, ${schema.costLedger.createdAt})`, weekStart()),
        ));
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
  // 退點是「已扣款」後的補償：一旦寫入失敗點數即永久蒸發，故包交易＋重試 3 次。
  // 最終仍失敗只印 CRITICAL 供人工對帳補點、不往外拋——呼叫端多在失敗收尾路徑，
  // 再拋錯會蓋掉原始錯誤且無法自動補救。
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await db.transaction(async (tx) => {
        await tx.insert(schema.costLedger).values({ userId, groupId, delta: points, reason, generationId });
      });
      return;
    } catch (err) {
      if (attempt === 3) {
        console.error(
          `[CRITICAL] 退點失敗（已重試 3 次，需人工補點）：user=${userId} group=${groupId} points=${points} gen=${generationId ?? "-"} reason=${reason}`,
          err instanceof Error ? err.message : err,
        );
        return;
      }
      // 短暫等待再重試，讓瞬時性 DB 錯誤（連線抖動、failover）有機會恢復
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

/** 組用量彙總（組長/管理員儀表用）：每人本週＋累計 */
export async function groupUsage(groupId: string): Promise<Array<{ userId: string; weekly: number; total: number }>> {
  const rows = await db
    .select({
      userId: schema.costLedger.userId,
      // 週歸屬同 usedThisWeek：退點跟隨生成建立週（generations.id 為 PK，LEFT JOIN 不會 fan-out）
      weekly: sql<number>`coalesce(-sum(${schema.costLedger.delta}) filter (where coalesce(${schema.generations.createdAt}, ${schema.costLedger.createdAt}) >= ${weekStart()}), 0)`,
      total: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)`,
    })
    .from(schema.costLedger)
    .leftJoin(schema.generations, eq(schema.costLedger.generationId, schema.generations.id))
    .where(eq(schema.costLedger.groupId, groupId))
    .groupBy(schema.costLedger.userId);
  return rows.map((r) => ({ userId: r.userId, weekly: Number(r.weekly), total: Number(r.total) }));
}
