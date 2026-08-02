/**
 * 彈性點數制（定案：不鎖死，組長/管理員可調）。
 * - 全域設定存 DB（settings 單列），管理員隨時改；null/0＝不限。
 * - 額度層級：個人覆寫 → 組設定 → 全域預設；一律空＝不限。
 * - 扣退模式不變：先扣預估、失敗全額退回（帳本可查）。
 * - 方案 C：Fal 台幣等值硬上限（即時動態，見 falCeiling.ts）。
 */
import { and, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { settlePoints } from "../../shared/llmPricing";
import { falCeilingReason } from "./falCeiling";

export interface PointsSettings {
  totalBudgetPoints: number | null;
  defaultWeeklyPoints: number | null;
  defaultDailyPoints: number | null;
  /** 資料庫文件每人儲存配額 GB（null＝預設 5；0＝不限）——開發者可調 */
  fileQuotaGb: number | null;
}

/** 讀全域設定（無列則以環境預設建立：5000／300／不限，之後全由管理員在系統內調） */
export async function getSettings(): Promise<PointsSettings> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, "global"));
  if (row) {
    return {
      totalBudgetPoints: row.totalBudgetPoints,
      defaultWeeklyPoints: row.defaultWeeklyPoints,
      defaultDailyPoints: row.defaultDailyPoints,
      fileQuotaGb: row.fileQuotaGb,
    };
  }
  const seeded = {
    totalBudgetPoints: Number(process.env.TOTAL_BUDGET_POINTS ?? 5000) || null,
    defaultWeeklyPoints: Number(process.env.WEEKLY_QUOTA_POINTS ?? 300) || null,
    defaultDailyPoints: Number(process.env.DAILY_QUOTA_POINTS ?? 0) || null, // 預設不限日
    fileQuotaGb: null, // null＝用程式預設 5GB（見 services/databaseFiles）
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

/**
 * 累計預算判定（純函式，守門與測試共用）：回傳 null＝通過；字串＝拒絕原因。
 * cap 為 null 視為不限。邊界語意：used + points === cap（恰好用完）仍放行，只有 > cap 才擋。
 * 集中在此一處，讓 checkQuota（顯示）與 reserveQuota（原子守門）訊息與邊界永遠一致。
 */
export function budgetReason(scope: "group" | "member", used: number, points: number, cap: number | null): string | null {
  if (cap == null || used + points <= cap) return null;
  return scope === "group"
    ? `本組點數已用完（已用 ${used}／${cap} 點）——請管理員增加組預算`
    : `你的點數已用完（已用 ${used}／${cap} 點）——可請組長增加你的分配`;
}

/** 週界以台北時間（UTC+8，無夏令時）計算——部署容器預設 UTC，用本地 getDay/setHours 會把週界推到台北週一 08:00 */
function weekStart(): Date {
  const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;
  const tpe = new Date(Date.now() + TPE_OFFSET_MS); // 平移後用 UTC 欄位讀出的就是台北牆鐘時間
  const day = tpe.getUTCDay() === 0 ? 6 : tpe.getUTCDay() - 1; // 週一起算
  tpe.setUTCDate(tpe.getUTCDate() - day);
  tpe.setUTCHours(0, 0, 0, 0); // 台北週一 00:00
  return new Date(tpe.getTime() - TPE_OFFSET_MS); // 平移回真正的 UTC 時刻
}

/** 日界以台北時間（UTC+8）計算——同 weekStart 的理由，避免用 UTC 讓「今天」跳到台北早上 8 點 */
function dayStart(): Date {
  const TPE_OFFSET_MS = 8 * 60 * 60 * 1000;
  const tpe = new Date(Date.now() + TPE_OFFSET_MS);
  tpe.setUTCHours(0, 0, 0, 0); // 台北當日 00:00
  return new Date(tpe.getTime() - TPE_OFFSET_MS);
}

/** 個人今日已用（口徑同 usedThisWeek：退點跟隨生成建立日） */
export async function usedToday(userId: string): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
    .from(schema.costLedger)
    .leftJoin(schema.generations, eq(schema.costLedger.generationId, schema.generations.id))
    .where(and(
      eq(schema.costLedger.userId, userId),
      gte(sql`coalesce(${schema.generations.createdAt}, ${schema.costLedger.createdAt})`, dayStart()),
    ));
  return Number(row?.used ?? 0);
}

/** 每人每日上限（v1 為全域設定；null＝不限） */
export function effectiveDailyQuota(settings: PointsSettings): number | null {
  return noLimit(settings.defaultDailyPoints) ? null : settings.defaultDailyPoints;
}

export async function usedTotal(): Promise<number> {
  const [row] = await db.select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` }).from(schema.costLedger);
  return Number(row?.used ?? 0);
}

/** 組累計淨消耗（組預算守門用；退點抵銷、口徑同 usedTotal，不做週歸屬——累計上限無週界） */
export async function usedByGroup(groupId: string): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
    .from(schema.costLedger)
    .where(eq(schema.costLedger.groupId, groupId));
  return Number(row?.used ?? 0);
}

/** 組員在某組的累計淨消耗（個人預算守門用）：一律綁 groupId，避免跨組帳本互相污染分配額 */
export async function usedByMember(userId: string, groupId: string): Promise<number> {
  const [row] = await db
    .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
    .from(schema.costLedger)
    .where(and(eq(schema.costLedger.userId, userId), eq(schema.costLedger.groupId, groupId)));
  return Number(row?.used ?? 0);
}

/** 組預算（累計上限；null＝不限）——開發者/團隊管理員分配給組的點數池 */
export async function groupBudget(groupId: string): Promise<number | null> {
  const [group] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  return noLimit(group?.budgetPoints) ? null : group!.budgetPoints;
}

/** 組員個人預算（累計上限；null＝不限）——組長從組預算再分配給組員 */
export async function memberBudget(userId: string, groupId: string): Promise<number | null> {
  const [member] = await db
    .select()
    .from(schema.groupMembers)
    .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId)));
  return noLimit(member?.budgetPoints) ? null : member!.budgetPoints;
}

export async function usedThisWeek(userId: string, groupId?: string): Promise<number> {
  // 週歸屬：退點列跟隨其生成的建立週（coalesce 回退帳本列自身時間），
  // 避免上週扣點、本週才失敗退點時，退點灌進新週把用量算成負值。
  // groupId（給定時）：週額度是「每人每週在這一組」的上限（effectiveWeeklyQuota 可依組/組員覆寫），
  // 用量也只能算這一組——否則多組使用者的跨組總用量會被拿去比單組上限而誤擋，且守門與顯示口徑須一致。
  const [row] = await db
    .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
    .from(schema.costLedger)
    .leftJoin(schema.generations, eq(schema.costLedger.generationId, schema.generations.id))
    .where(and(
      eq(schema.costLedger.userId, userId),
      groupId ? eq(schema.costLedger.groupId, groupId) : undefined,
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

/**
 * 一次讀齊額度組態（全域設定＋組員列＋組列），純導出所有上限與門檻。
 * 取代 getSettings／effectiveWeeklyQuota／groupBudget／memberBudget 各自重讀同幾列的冗餘往返
 * ——舊版一趟守門最多讀 settings×2＋member×2＋group×2 共 6 次 round-trip，其實只需 3 種列。
 * 三筆彼此獨立、在任何交易「之外」完成即釋放連線（pool max=10），與 reserveQuota 交易內
 * 單連線序列化限制正交，不觸及其死鎖面；故可安全並行。
 */
export interface QuotaConfig {
  settings: PointsSettings;
  weeklyQuota: number | null; // 個人生效週額度（覆寫→組→全域；口徑同 effectiveWeeklyQuota）
  dailyQuota: number | null;
  groupBudget: number | null; // 組累計上限（null＝不限）
  memberBudget: number | null; // 組員累計上限（null＝不限）
  approvalThreshold: number | null; // 成本審核門檻（null＝不啟用；供 quota.my 顯示用）
}

export async function loadQuotaConfig(userId: string, groupId: string): Promise<QuotaConfig> {
  const [settings, memberRows, groupRows] = await Promise.all([
    getSettings(),
    db
      .select()
      .from(schema.groupMembers)
      .where(and(eq(schema.groupMembers.groupId, groupId), eq(schema.groupMembers.userId, userId))),
    db.select().from(schema.groups).where(eq(schema.groups.id, groupId)),
  ]);
  const member = memberRows[0];
  const group = groupRows[0];
  // 週額度：個人覆寫 → 組設定 → 全域預設（與 effectiveWeeklyQuota 逐級 noLimit 判定完全一致）
  const weeklyQuota =
    member && member.weeklyPointsOverride != null
      ? noLimit(member.weeklyPointsOverride)
        ? null
        : member.weeklyPointsOverride
      : group && group.weeklyPointsPerUser != null
        ? noLimit(group.weeklyPointsPerUser)
          ? null
          : group.weeklyPointsPerUser
        : noLimit(settings.defaultWeeklyPoints)
          ? null
          : settings.defaultWeeklyPoints;
  const th = group?.approvalThresholdPoints;
  return {
    settings,
    weeklyQuota,
    dailyQuota: effectiveDailyQuota(settings),
    groupBudget: noLimit(group?.budgetPoints) ? null : group!.budgetPoints,
    memberBudget: noLimit(member?.budgetPoints) ? null : member!.budgetPoints,
    approvalThreshold: th != null && th > 0 ? th : null,
  };
}

/** 額度守門：null=可扣；字串=拒絕原因 */
export async function checkQuota(userId: string, groupId: string, points: number): Promise<string | null> {
  const cfg = await loadQuotaConfig(userId, groupId); // 組態一次讀齊（取代四個各自重讀的呼叫）
  const settings = cfg.settings;
  if (!noLimit(settings.totalBudgetPoints)) {
    const total = await usedTotal();
    if (total + points > settings.totalBudgetPoints!) return `總預算不足（已用 ${total}／${settings.totalBudgetPoints} 點）——請管理員調整`;
  }
  // 分配樹（累計上限）：組預算 → 組員個人預算。與週/日「速率上限」正交，兩套並存各自守門。
  const gBudget = cfg.groupBudget;
  if (gBudget != null) {
    const groupReason = budgetReason("group", await usedByGroup(groupId), points, gBudget);
    if (groupReason) return groupReason;
  }
  const mBudget = cfg.memberBudget;
  if (mBudget != null) {
    const memberReason = budgetReason("member", await usedByMember(userId, groupId), points, mBudget);
    if (memberReason) return memberReason;
  }
  const quota = cfg.weeklyQuota;
  if (quota != null) {
    const weekly = await usedThisWeek(userId, groupId); // 週額度是每人每週在這一組的上限——用量只算本組
    if (weekly + points > quota) return `本週額度不足（已用 ${weekly}／${quota} 點）——可請組長調整`;
  }
  const daily = cfg.dailyQuota;
  if (daily != null) {
    const today = await usedToday(userId);
    if (today + points > daily) return `今天的額度用完了（已用 ${today}／${daily} 點）——明天會重置`;
  }
  // 方案 C：Fal 台幣等值硬上限（即時動態對應 fal.ai 餘額；fail-open）
  const falReason = await falCeilingReason(points);
  if (falReason) return falReason;
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
  // 0 點＝免費呼叫（NVIDIA NIM 免費額度的 LLM 類）：直接放行——
  // 不寫 0 元帳本列（雜訊）、不進交易搶 advisory lock（省鎖競爭）、不受額度守門（免費不佔額度）
  if (points <= 0) return null;
  // 關鍵：設定與額度「先在交易外」讀好——交易內不可再向連線池借第二條連線，
  // 否則交易已佔一條連線＋持有序列化鎖時再借連線，併發滿池會整池死鎖（需重啟才復原）。
  // 這些是穩定的組態/成員資料，非 TOCTOU 競態目標；真正要原子的只有「帳本 SUM＋扣點列」。
  // loadQuotaConfig 一次並行讀齊 settings＋組員列＋組列（三筆在交易前完成即釋放連線），
  // 取代舊版依序重讀同幾列的 6 次 round-trip。
  const cfg = await loadQuotaConfig(userId, groupId);
  const settings = cfg.settings;
  const quota = cfg.weeklyQuota;
  const daily = cfg.dailyQuota;
  const budgetCapped = !noLimit(settings.totalBudgetPoints);
  const gBudget = cfg.groupBudget;
  const mBudget = cfg.memberBudget;

  // 方案 C：交易外先查 Fal 上限（外部 API 不可進交易；fail-open）
  const falReason = await falCeilingReason(points);
  if (falReason) return falReason;

  return db.transaction(async (tx) => {
    // 鎖取得順序固定為 user → group → 全域總預算，全體呼叫端一致 → 無交錯死鎖。
    // 同一使用者一律序列化（週額度／個人預算）；組預算另上 per-group 鎖（class 1，與 user 的 class 0 區隔）；
    // 只有在「有總預算上限」時才另上全域鎖串行化總預算。沒設任何上限 → 零額外爭用。
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}), 0)`);
    if (mBudget != null) {
      // 個人預算：受既有 per-user 鎖序列化，不必再上新鎖。累計淨消耗（含退點抵銷）綁本組。
      const [m] = await tx
        .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
        .from(schema.costLedger)
        .where(and(eq(schema.costLedger.userId, userId), eq(schema.costLedger.groupId, groupId)));
      const memberReason = budgetReason("member", Number(m?.used ?? 0), points, mBudget);
      if (memberReason) return memberReason;
    }
    if (gBudget != null) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${groupId}), 1)`); // per-group 組預算閘（class 1）
      const [g] = await tx
        .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
        .from(schema.costLedger)
        .where(eq(schema.costLedger.groupId, groupId));
      const groupReason = budgetReason("group", Number(g?.used ?? 0), points, gBudget);
      if (groupReason) return groupReason;
    }
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
      // 週歸屬同 usedThisWeek：退點跟隨生成建立週，守門與顯示口徑一致。
      // groupId 過濾（關鍵）：週額度是「每人每週在這一組」的上限，用量也只能算這一組——否則多組
      // 使用者的跨組總用量會被拿去比單組上限而誤擋（在 A 組沒用完卻因 B 組的用量被擋在 A 組生成）。
      const [w] = await tx
        .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
        .from(schema.costLedger)
        .leftJoin(schema.generations, eq(schema.costLedger.generationId, schema.generations.id))
        .where(and(
          eq(schema.costLedger.userId, userId),
          eq(schema.costLedger.groupId, groupId),
          gte(sql`coalesce(${schema.generations.createdAt}, ${schema.costLedger.createdAt})`, weekStart()),
        ));
      const weekly = Number(w?.used ?? 0);
      if (weekly + points > quota) {
        return `本週額度不足（已用 ${weekly}／${quota} 點）——可請組長調整`;
      }
    }
    if (daily != null) {
      // 日上限同樣受既有 per-user advisory lock 序列化——不必再上新鎖（避免多鎖交錯的死鎖面）
      const [dRow] = await tx
        .select({ used: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)` })
        .from(schema.costLedger)
        .leftJoin(schema.generations, eq(schema.costLedger.generationId, schema.generations.id))
        .where(and(
          eq(schema.costLedger.userId, userId),
          gte(sql`coalesce(${schema.generations.createdAt}, ${schema.costLedger.createdAt})`, dayStart()),
        ));
      const today = Number(dRow?.used ?? 0);
      if (today + points > daily) {
        return `今天的額度用完了（已用 ${today}／${daily} 點）——明天會重置`;
      }
    }
    await tx.insert(schema.costLedger).values({ userId, groupId, delta: -points, reason, generationId });
    return null;
  });
}

/**
 * 用量型呼叫（LLM 規劃）的結算：預留多了退回、少了補扣，回傳最終實扣點數。
 *
 * 生成類是「估點即扣、失敗全退」就夠了——單價在送出前就知道。LLM 不是：計費量是 token，
 * 跑完才知道。少了這道結算，預留高估＝永久超收使用者、預留低估＝平台白付差額。
 *
 * 補扣刻意用 deduct 而非 reserveQuota：呼叫已經跑完、錢已經花掉，這時再去擋額度只會讓
 * 帳本少一筆該記的支出（額度守門的位置在「預留」那一刻，不是在事後對帳）。
 */
export async function settleUsagePoints(input: {
  userId: string;
  groupId: string;
  reserved: number;
  actual: number;
  reason: string;
}): Promise<number> {
  const { refund: back, extra } = settlePoints(input.reserved, input.actual);
  if (back > 0) await refund(input.userId, input.groupId, back, `${input.reason}（實際低於預留退回）`);
  if (extra > 0) await deduct(input.userId, input.groupId, extra, `${input.reason}（實際高於預留補扣）`);
  return Math.max(0, Math.round(input.actual));
}

export async function refund(userId: string, groupId: string, points: number, reason: string, generationId?: string): Promise<void> {
  // 0 點免費呼叫本來就沒扣過（reserveQuota 直接放行），沒東西可退——直接返回，不寫 0 元帳本列
  if (points <= 0) return;
  // 退點是「已扣款」後的補償：一旦寫入失敗點數即永久蒸發，故包交易＋重試 3 次。
  // 最終仍失敗只印 CRITICAL 供人工對帳補點、不往外拋——呼叫端多在失敗收尾路徑，
  // 再拋錯會蓋掉原始錯誤且無法自動補救。
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await db.transaction(async (tx) => {
        // 冪等退點（防重試雙倍退）：commit 成功但驅動在收到 ack 前斷線時，本迴圈會 attempt 2 重插一列
        // 相同 +points → 使用者被退兩倍點。故對「有 generationId」的退點先在同交易內查是否已有正額退點列，
        // 有就跳過（每筆生成至多一列自動退點；charge 為 -delta、refund 為 +delta，正額即退點）。
        if (generationId) {
          const [existing] = await tx
            .select({ n: sql<number>`count(*)` })
            .from(schema.costLedger)
            .where(and(eq(schema.costLedger.generationId, generationId), gt(schema.costLedger.delta, 0)));
          if (Number(existing?.n ?? 0) > 0) return;
        }
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

/**
 * 陳屍生成的「原子＋冪等」收斂：把「CAS(queued/running→failed) ＋ 退點帳本列」寫在**同一交易**。
 * 為什麼要同交易（修 sweep-refund-non-atomic）：舊版三處 sweeper 先 commit failed(pointsRefunded=deducted)
 * 再另起交易呼叫 refund()——若在兩者之間當機/重佈/OOM，列已是終局 failed 而退點列從未寫入，之後所有
 * sweeper 只掃 queued/running 永不再碰它 → 使用者被扣的點永久蒸發。包進同交易後：全有或全無，中途當機
 * 整筆 rollback、列留在 queued/running 交下輪重試。退點金額＝該生成帳本淨額絕對值（負淨額＝有扣過才退；
 * 0＝從未扣點不退，免對沒扣過的列憑空加點灌鬆總預算閘）。退點列對同一 generation 冪等（已有正額退點列
 * 就不再插），與 CAS 一起杜絕重複退。回傳本次是否真的把列推進成 failed（呼叫端據此決定推播等後續）。
 */
export async function failStaleGenerationTx(
  genId: string,
  baseError: string,
  refundReason: string,
): Promise<{ updated: boolean; refunded: number }> {
  return db.transaction(async (tx) => {
    const [ledger] = await tx
      .select({ net: sql<number>`coalesce(sum(${schema.costLedger.delta}), 0)` })
      .from(schema.costLedger)
      .where(eq(schema.costLedger.generationId, genId));
    const deducted = Math.max(0, -Number(ledger?.net ?? 0)); // 已扣的點數（>0 才要退）
    const rows = await tx
      .update(schema.generations)
      .set({
        status: "failed",
        error: baseError + (deducted > 0 ? "，點數已退回" : ""),
        pointsRefunded: deducted,
        updatedAt: new Date(),
      })
      .where(and(eq(schema.generations.id, genId), inArray(schema.generations.status, ["queued", "running"])))
      .returning();
    if (rows.length === 0) return { updated: false, refunded: 0 }; // 已被別處推進到終局
    if (deducted > 0) {
      // 冪等退點：同 generation 已有正額退點列就不再插（防併發/重試雙倍退）
      const [existing] = await tx
        .select({ n: sql<number>`count(*)` })
        .from(schema.costLedger)
        .where(and(eq(schema.costLedger.generationId, genId), gt(schema.costLedger.delta, 0)));
      if (Number(existing?.n ?? 0) === 0) {
        await tx.insert(schema.costLedger).values({
          userId: rows[0].userId,
          groupId: rows[0].groupId,
          delta: deducted,
          reason: refundReason,
          generationId: genId,
        });
      }
    }
    return { updated: true, refunded: deducted };
  });
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

/**
 * 多組一次查（通訊錄用）：以 (groupId, userId) 分組彙總本週/累計淨消耗，避免逐組各打一次
 * （超管一次看全站數十組時的 N+1／連線池飽和）。口徑與 groupUsage 完全一致。
 */
export async function groupUsageMany(
  groupIds: string[],
): Promise<Array<{ groupId: string; userId: string; weekly: number; total: number }>> {
  if (groupIds.length === 0) return [];
  const rows = await db
    .select({
      groupId: schema.costLedger.groupId,
      userId: schema.costLedger.userId,
      weekly: sql<number>`coalesce(-sum(${schema.costLedger.delta}) filter (where coalesce(${schema.generations.createdAt}, ${schema.costLedger.createdAt}) >= ${weekStart()}), 0)`,
      total: sql<number>`coalesce(-sum(${schema.costLedger.delta}), 0)`,
    })
    .from(schema.costLedger)
    .leftJoin(schema.generations, eq(schema.costLedger.generationId, schema.generations.id))
    .where(inArray(schema.costLedger.groupId, groupIds))
    .groupBy(schema.costLedger.groupId, schema.costLedger.userId);
  return rows.map((r) => ({ groupId: r.groupId as string, userId: r.userId, weekly: Number(r.weekly), total: Number(r.total) }));
}
